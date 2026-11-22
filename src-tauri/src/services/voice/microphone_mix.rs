//! The microphone and the sound the computer plays together, so that a
//! transcription hears both sides of a call.
//!
//! `StreamMixer` keeps the two in step and does not wait for playback while
//! nothing plays. They are then summed into one stream (`MixLayout::Summed`),
//! or kept apart as the two channels of a stereo stream
//! (`MixLayout::Separate`), the microphone first, with the echo of the
//! speakers lowered in the microphone, see `EchoGate`.
//!
//! Only a sum brings its sources to a common loudness first: a quiet
//! microphone next to a loud call, or the other way round, would otherwise
//! leave one side to the speech model as a murmur. Separate channels are
//! transcribed each on its own, as recorded, like a dictation. Either way a
//! `PeakLimiter` keeps the result from clipping.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::audio_processing::{compute_audio_level, float_to_pcm16};
use super::echo_gate::EchoGate;
use super::limiter::PeakLimiter;
use super::mixer::StreamMixer;
use super::{OpenedCapture, StreamContext};
use crate::errors::AppError;
use crate::locks::MutexExt;

/// The loudness speech is brought to: about -22 dBFS, leaving headroom for
/// both sources speaking at once.
const TARGET_RMS: f32 = 0.08;
/// Below about -40 dBFS there is silence or room noise (a fan, keys): the
/// gain holds, so that noise is not raised to the loudness of speech.
const GATE_RMS: f32 = 0.01;
/// Louder noise is told from speech by the noise floor: speech is at least
/// about 10 dB above it.
const SPEECH_OVER_NOISE: f32 = 3.16;
/// How fast the noise floor follows a quieter moment, a pause between
/// words...
const NOISE_FALL_S: f32 = 0.1;
/// ...and how slowly it rises with a louder one, in dB per second: speech
/// falls back to the floor between words long before it gets there.
const NOISE_RISE_DB_PER_S: f32 = 3.0;
/// A loud source is lowered at most this much...
const MIN_GAIN: f32 = 0.1;
/// ...and a quiet one raised at most this much, +12 dB: enough for a quiet
/// microphone without raising its noise far.
const MAX_GAIN: f32 = 4.0;
/// The window of the short-term loudness that is compared with the gate.
const POWER_WINDOW_S: f32 = 0.05;
/// How fast the speech level follows a louder voice...
const LEVEL_RISE_S: f32 = 0.4;
/// ...and how slowly a quieter one, so that pauses inside a sentence are no
/// reason to raise the gain.
const LEVEL_FALL_S: f32 = 1.5;
/// How fast the applied gain moves to a new value, so that it does not click.
const GAIN_SMOOTHING_S: f32 = 0.05;

/// How far one source may run ahead before the other is not waited for:
/// playback delivers nothing while nothing plays.
const MAX_LAG_MS: u64 = 300;
const PUMP_INTERVAL: Duration = Duration::from_millis(20);

const MICROPHONE: u32 = 0;
const PLAYBACK: u32 = 1;

/// How a mix hands the two sources on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MixLayout {
    /// Summed into one mono stream.
    Summed,
    /// Two interleaved channels: the microphone, then playback.
    Separate,
}

impl MixLayout {
    fn channel_count(self) -> u16 {
        match self {
            Self::Summed => 1,
            Self::Separate => 2,
        }
    }
}

/// A one-pole smoothing coefficient for a time constant at a sample rate.
fn coefficient(time_s: f32, sample_rate_hz: u32) -> f32 {
    1.0 - (-1.0 / (time_s * sample_rate_hz as f32)).exp()
}

/// Brings speech to `TARGET_RMS` with a slowly moving gain.
pub(crate) struct LoudnessNormalizer {
    power: f32,
    noise_floor: f32,
    speech_level: f32,
    gain: f32,
    power_coefficient: f32,
    rise_coefficient: f32,
    fall_coefficient: f32,
    gain_coefficient: f32,
    noise_fall_coefficient: f32,
    noise_rise_factor: f32,
}

impl LoudnessNormalizer {
    pub(crate) fn new(sample_rate_hz: u32) -> Self {
        Self {
            power: 0.0,
            // starts as if speech were at the target: unity gain
            speech_level: TARGET_RMS,
            // at first the fixed gate decides
            noise_floor: GATE_RMS / SPEECH_OVER_NOISE,
            gain: 1.0,
            noise_fall_coefficient: coefficient(NOISE_FALL_S, sample_rate_hz),
            noise_rise_factor: 10_f32.powf(NOISE_RISE_DB_PER_S / 20.0 / sample_rate_hz as f32),
            power_coefficient: coefficient(POWER_WINDOW_S, sample_rate_hz),
            rise_coefficient: coefficient(LEVEL_RISE_S, sample_rate_hz),
            fall_coefficient: coefficient(LEVEL_FALL_S, sample_rate_hz),
            gain_coefficient: coefficient(GAIN_SMOOTHING_S, sample_rate_hz),
        }
    }

    pub(crate) fn process(&mut self, samples: &mut [f32]) {
        for sample in samples {
            self.power += self.power_coefficient * (*sample * *sample - self.power);
            let rms = self.power.sqrt();
            if rms < self.noise_floor {
                self.noise_floor += self.noise_fall_coefficient * (rms - self.noise_floor);
            } else {
                self.noise_floor = (self.noise_floor * self.noise_rise_factor).min(rms);
            }
            // while it is not speech the level, and with it the gain, holds
            if rms > GATE_RMS.max(self.noise_floor * SPEECH_OVER_NOISE) {
                let rate = if rms > self.speech_level {
                    self.rise_coefficient
                } else {
                    self.fall_coefficient
                };
                self.speech_level += rate * (rms - self.speech_level);
            }
            let wanted = (TARGET_RMS / self.speech_level).clamp(MIN_GAIN, MAX_GAIN);
            self.gain += self.gain_coefficient * (wanted - self.gain);
            *sample *= self.gain;
        }
    }
}

/// Raises a lower microphone rate to the rate of playback by linear
/// interpolation: a headset in call mode may record at 8 kHz.
struct Upsampler {
    /// Input samples per output sample, at most 1.
    step: f64,
    /// Where the next output sample lies after `previous`, in input samples.
    position: f64,
    previous: f32,
}

impl Upsampler {
    fn new(input_sample_rate_hz: u32, output_sample_rate_hz: u32) -> Self {
        Self {
            step: (f64::from(input_sample_rate_hz) / f64::from(output_sample_rate_hz)).min(1.0),
            position: 0.0,
            previous: 0.0,
        }
    }

    fn push(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if self.step >= 1.0 {
            output.extend_from_slice(input);
            return;
        }
        for &sample in input {
            while self.position < 1.0 {
                let share = self.position as f32;
                output.push(self.previous + (sample - self.previous) * share);
                self.position += self.step;
            }
            self.position -= 1.0;
            self.previous = sample;
        }
    }
}

fn take_samples(pending: &Mutex<Vec<i16>>) -> Vec<f32> {
    std::mem::take(&mut *pending.locked())
        .into_iter()
        .map(|sample| f32::from(sample) / 32768.0)
        .collect()
}

/// The parts of the mixed stream's `StreamContext` the mixing writes to.
struct MixOutput {
    pending: Arc<Mutex<Vec<i16>>>,
    /// `MixLayout::Separate` only: the two channels before the echo gate
    /// and the limiters, for a call recording that is not processed.
    unprocessed: Option<Arc<Mutex<Vec<i16>>>>,
    level: Arc<Mutex<(f32, f32)>>,
    stream_error: Arc<Mutex<Option<String>>>,
}

/// Moves what both sources recorded to the mixed stream.
struct Mix {
    microphone: StreamContext,
    playback: StreamContext,
    output: MixOutput,
    mixer: StreamMixer,
    upsampler: Upsampler,
    /// Only for `MixLayout::Summed`.
    loudness: Option<(LoudnessNormalizer, LoudnessNormalizer)>,
    /// Only for `MixLayout::Separate`.
    echo_gate: Option<EchoGate>,
    /// One per channel of the output.
    limiters: Vec<PeakLimiter>,
}

impl Mix {
    fn new(
        microphone: StreamContext,
        playback: StreamContext,
        output: MixOutput,
        layout: MixLayout,
    ) -> Self {
        let rate = playback.output_sample_rate_hz;
        let max_lag = u64::from(rate) * MAX_LAG_MS / 1_000;
        let mut mixer =
            StreamMixer::with_lanes(max_lag, usize::from(layout.channel_count())).unclipped();
        match layout {
            MixLayout::Summed => {
                mixer.add_stream(MICROPHONE);
                mixer.add_stream(PLAYBACK);
            }
            MixLayout::Separate => {
                mixer.add_stream_to_lane(MICROPHONE, 0);
                mixer.add_stream_to_lane(PLAYBACK, 1);
            }
        }
        Self {
            upsampler: Upsampler::new(microphone.output_sample_rate_hz, rate),
            microphone,
            playback,
            output,
            mixer,
            loudness: (layout == MixLayout::Summed)
                .then(|| (LoudnessNormalizer::new(rate), LoudnessNormalizer::new(rate))),
            echo_gate: (layout == MixLayout::Separate).then(|| EchoGate::new(rate)),
            limiters: (0..layout.channel_count())
                .map(|_| PeakLimiter::new(rate))
                .collect(),
        }
    }

    /// Mixes what is ready; `is_final` also lets out what waits for the
    /// other source.
    fn step(&mut self, is_final: bool) {
        // playback first: when it resumes after silence it joins at the
        // present, which is where the microphone's batch of the same
        // moment begins
        let mut playback = take_samples(&self.playback.pending_pcm_samples);
        if let Some((_, loudness)) = self.loudness.as_mut() {
            loudness.process(&mut playback);
        }
        self.mixer.push(PLAYBACK, &playback);

        let recorded = take_samples(&self.microphone.pending_pcm_samples);
        let mut microphone = Vec::with_capacity(recorded.len() * 2);
        self.upsampler.push(&recorded, &mut microphone);
        if let Some((loudness, _)) = self.loudness.as_mut() {
            loudness.process(&mut microphone);
        }
        self.mixer.push(MICROPHONE, &microphone);

        // the microphone's errors are the mixed stream's own; playback's
        // are handed over
        if let Some(message) = self.playback.stream_error.locked().take() {
            self.output.stream_error.locked().get_or_insert(message);
        }

        let mixed = if is_final {
            self.mixer.finish()
        } else {
            self.mixer.drain()
        };
        if let Some(unprocessed) = &self.output.unprocessed {
            unprocessed
                .locked()
                .extend(mixed.iter().copied().map(float_to_pcm16));
        }
        let mixed = match self.echo_gate.as_mut() {
            None => limit(&mut self.limiters[0], &mixed, is_final),
            Some(gate) => {
                let (microphone, playback): (Vec<f32>, Vec<f32>) = mixed
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|&[microphone, playback]| (microphone, playback))
                    .unzip();
                let (mut microphone, mut playback) = gate.process(&microphone, &playback);
                if is_final {
                    let (microphone_tail, playback_tail) = gate.finish();
                    microphone.extend(microphone_tail);
                    playback.extend(playback_tail);
                }
                let microphone = limit(&mut self.limiters[0], &microphone, is_final);
                let playback = limit(&mut self.limiters[1], &playback, is_final);
                microphone
                    .into_iter()
                    .zip(playback)
                    .flat_map(|(microphone, playback)| [microphone, playback])
                    .collect()
            }
        };
        if mixed.is_empty() {
            return;
        }
        let samples: Vec<i16> = mixed.iter().copied().map(float_to_pcm16).collect();
        {
            let (rms, peak) = compute_audio_level(&samples);
            let mut level = self.output.level.locked();
            *level = (level.0.max(rms), level.1.max(peak));
        }
        self.output.pending.locked().extend_from_slice(&samples);
    }
}

fn limit(limiter: &mut PeakLimiter, samples: &[f32], is_final: bool) -> Vec<f32> {
    let mut limited = limiter.process(samples);
    if is_final {
        limited.extend(limiter.finish());
    }
    limited
}

/// Both captures and the thread that mixes them; dropping it stops the
/// captures and mixes what they recorded last.
pub(crate) struct MixedStream<M, P> {
    streams: Option<(M, P)>,
    quit: Arc<AtomicBool>,
    pump: Option<thread::JoinHandle<()>>,
}

impl<M, P> Drop for MixedStream<M, P> {
    fn drop(&mut self) {
        // no sample may arrive after the final mix
        drop(self.streams.take());
        self.quit.store(true, Ordering::SeqCst);
        if let Some(pump) = self.pump.take() {
            let _ = pump.join();
        }
    }
}

/// One capture of the microphone and playback together. The microphone
/// keeps time: it delivers silence too, so the mixed stream needs no gaps
/// filled, and a microphone that stops delivering ends the capture.
pub(crate) fn mix_captures<M, P>(
    microphone: OpenedCapture<M>,
    playback: OpenedCapture<P>,
    stop_flag: &Arc<AtomicBool>,
    layout: MixLayout,
) -> Result<OpenedCapture<MixedStream<M, P>>, AppError> {
    let rate = playback.output_sample_rate_hz;
    if microphone.output_sample_rate_hz > rate {
        return Err(AppError::Failed(
            "The microphone records at a higher rate than the computer sound".into(),
        ));
    }
    let context = StreamContext {
        pending_pcm_samples: Arc::default(),
        stream_error: Arc::clone(&microphone.context.stream_error),
        recoverable_error: Arc::clone(&microphone.context.recoverable_error),
        current_level: Arc::default(),
        callback_count: Arc::clone(&microphone.context.callback_count),
        stop_flag: Arc::clone(stop_flag),
        device_sample_rate_hz: rate,
        output_sample_rate_hz: rate,
        fills_gaps: false,
        channel_count: layout.channel_count(),
        status: Arc::clone(&playback.context.status),
        unprocessed_pcm_samples: (layout == MixLayout::Separate).then(Arc::default),
    };
    let output = MixOutput {
        pending: Arc::clone(&context.pending_pcm_samples),
        unprocessed: context.unprocessed_pcm_samples.clone(),
        level: Arc::clone(&context.current_level),
        stream_error: Arc::clone(&context.stream_error),
    };
    let mut mix = Mix::new(microphone.context, playback.context, output, layout);
    let quit = Arc::new(AtomicBool::new(false));
    let thread_quit = Arc::clone(&quit);
    let pump = thread::Builder::new()
        .name("tyco-microphone-mix".into())
        .spawn(move || {
            while !thread_quit.load(Ordering::SeqCst) {
                mix.step(false);
                thread::sleep(PUMP_INTERVAL);
            }
            mix.step(true);
        })
        .map_err(|error| AppError::Failed(format!("cannot start the mixing thread: {error}")))?;
    Ok(OpenedCapture {
        stream: MixedStream {
            streams: Some((microphone.stream, playback.stream)),
            quit,
            pump: Some(pump),
        },
        context,
        output_sample_rate_hz: rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn tone(amplitude: f32, seconds: f32) -> Vec<f32> {
        (0..(RATE as f32 * seconds) as usize)
            .map(|index| {
                let time = index as f32 / RATE as f32;
                (std::f32::consts::TAU * 440.0 * time).sin() * amplitude
            })
            .collect()
    }

    /// A tone whose loudness rises and falls like syllables, down to silence.
    fn syllables(amplitude: f32, seconds: f32) -> Vec<f32> {
        tone(amplitude, seconds)
            .into_iter()
            .enumerate()
            .map(|(index, sample)| {
                let time = index as f32 / RATE as f32;
                let envelope = (std::f32::consts::PI * 4.0 * time).sin().abs();
                sample * envelope
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    fn normalized_rms(amplitude: f32) -> f32 {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut samples = syllables(amplitude, 8.0);
        normalizer.process(&mut samples);
        // once the level has settled
        rms(&samples[samples.len() - RATE as usize..])
    }

    #[test]
    fn quiet_and_loud_speech_come_out_alike() {
        let quiet = normalized_rms(0.1);
        let loud = normalized_rms(0.6);
        // the level follows the loud parts of syllables: the average of
        // speech with its dips lies a little below the target
        assert!((quiet - loud).abs() < loud * 0.15, "{quiet} {loud}");
        assert!(loud > TARGET_RMS * 0.5 && loud < TARGET_RMS * 1.2, "{loud}");
    }

    #[test]
    fn silence_and_noise_are_not_raised() {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut noise = tone(0.001, 4.0);
        normalizer.process(&mut noise);
        assert!(rms(&noise) <= 0.001, "{}", rms(&noise));
    }

    #[test]
    fn room_noise_after_speech_is_not_raised() {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut speech = tone(0.1, 4.0);
        normalizer.process(&mut speech);
        // a fan at about -43 dBFS for long pauses
        let mut noise = tone(0.01, 6.0);
        let before = rms(&noise);
        normalizer.process(&mut noise);
        let after = rms(&noise[noise.len() - RATE as usize..]);
        // speech near the target keeps the gain near unity: the noise stays
        // far below speech instead of being raised towards it
        assert!(after < before * 1.3, "{after}");
    }

    #[test]
    fn room_noise_above_the_gate_is_not_raised() {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut speech = syllables(0.06, 4.0);
        normalizer.process(&mut speech);
        // a fan at about -35 dBFS, above the fixed gate, for a long pause
        let mut noise = tone(0.018, 8.0);
        let before = rms(&noise);
        normalizer.process(&mut noise);
        let after = rms(&noise[noise.len() - RATE as usize..]);
        // the gain of the quiet speech holds: the noise is not pulled up to
        // the loudness of speech
        assert!(after < TARGET_RMS * 0.6, "{after}");
        assert!(after < before * MAX_GAIN, "{after}");
    }

    #[test]
    fn a_loud_sum_is_limited_instead_of_clipped() {
        let (mut mix, pending, _) = mix();
        record(&mix.microphone, &[30_000; 1_600]);
        record(&mix.playback, &[30_000; 1_600]);
        mix.step(true);
        let mixed = std::mem::take(&mut *pending.locked());
        assert_eq!(mixed.len(), 1_600);
        assert!(mixed.iter().all(|&sample| sample <= float_to_pcm16(0.9)));
    }

    #[test]
    fn separate_channels_keep_their_loudness() {
        let (mut mix, pending, _) = mix_as(MixLayout::Separate);
        // a quiet microphone stays quiet: it is transcribed as recorded
        record(&mix.microphone, &[300; 16_000]);
        record(&mix.playback, &[0; 16_000]);
        mix.step(true);
        let frames = std::mem::take(&mut *pending.locked());
        assert!(frames
            .as_chunks::<2>()
            .0
            .iter()
            .all(|frame| frame[0] == 300));
    }

    #[test]
    fn playback_that_resumes_after_silence_stays_in_step_with_the_microphone() {
        let (mut mix, pending, _) = mix();
        // half a second of speech while nothing plays
        record(&mix.microphone, &[1_000; 8_000]);
        mix.step(false);
        // playback starts now: it belongs after the speech, not 300 ms into it
        record(&mix.playback, &[2_000; 1_600]);
        record(&mix.microphone, &[0; 1_600]);
        mix.step(true);
        let mixed = std::mem::take(&mut *pending.locked());
        assert_eq!(mixed.len(), 9_600);
        assert!(mixed[..8_000].iter().all(|&sample| sample < 1_500));
        assert!(mixed[8_000..].iter().all(|&sample| sample > 1_500));
    }

    #[test]
    fn a_whisper_is_raised_no_more_than_the_limit() {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut samples = tone(0.008, 4.0);
        let before = rms(&samples);
        normalizer.process(&mut samples);
        let after = rms(&samples[samples.len() - RATE as usize..]);
        assert!(after <= before * MAX_GAIN * 1.01, "{after}");
    }

    #[test]
    fn a_lower_microphone_rate_is_raised_to_the_playback_rate() {
        let mut upsampler = Upsampler::new(8_000, 16_000);
        let mut output = Vec::new();
        upsampler.push(&[0.2, 0.4], &mut output);
        upsampler.push(&[0.6], &mut output);
        assert_eq!(output.len(), 6);
        for (sample, expected) in output.iter().zip([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
            assert!((sample - expected).abs() < 1e-6, "{output:?}");
        }
    }

    #[test]
    fn an_equal_rate_passes_through() {
        let mut upsampler = Upsampler::new(RATE, RATE);
        let mut output = Vec::new();
        upsampler.push(&[0.1, 0.2], &mut output);
        assert_eq!(output, vec![0.1, 0.2]);
    }

    fn context(rate: u32) -> StreamContext {
        StreamContext::new(&Arc::default(), rate, rate)
    }

    type Samples = Arc<Mutex<Vec<i16>>>;
    type Error = Arc<Mutex<Option<String>>>;

    fn mix() -> (Mix, Samples, Error) {
        mix_as(MixLayout::Summed)
    }

    fn mix_as(layout: MixLayout) -> (Mix, Samples, Error) {
        let pending: Arc<Mutex<Vec<i16>>> = Arc::default();
        let stream_error: Arc<Mutex<Option<String>>> = Arc::default();
        let output = MixOutput {
            pending: Arc::clone(&pending),
            unprocessed: None,
            level: Arc::default(),
            stream_error: Arc::clone(&stream_error),
        };
        (
            Mix::new(context(RATE), context(RATE), output, layout),
            pending,
            stream_error,
        )
    }

    fn record(context: &StreamContext, samples: &[i16]) {
        context
            .pending_pcm_samples
            .locked()
            .extend_from_slice(samples);
    }

    #[test]
    fn both_sources_are_heard_in_one_stream() {
        let (mut mix, pending, _) = mix();
        record(&mix.microphone, &[8_000; 1_600]);
        record(&mix.playback, &[-4_000; 1_600]);
        mix.step(false);
        let mixed = std::mem::take(&mut *pending.locked());
        let lookahead = PeakLimiter::new(RATE).lookahead();
        assert_eq!(mixed.len(), 1_600 - lookahead);
        // both start at unity gain: the sum of the two
        assert!((i32::from(mixed[0]) - 4_000).abs() < 50, "{}", mixed[0]);
    }

    #[test]
    fn the_microphone_is_not_held_back_while_nothing_plays() {
        let (mut mix, pending, _) = mix();
        // a second of speech and no playback at all
        record(&mix.microphone, &[1_000; 16_000]);
        mix.step(false);
        let lag = (RATE as u64 * MAX_LAG_MS / 1_000) as usize;
        let lookahead = PeakLimiter::new(RATE).lookahead();
        assert_eq!(pending.locked().len(), 16_000 - lag - lookahead);
        mix.step(true);
        assert_eq!(pending.locked().len(), 16_000);
    }

    #[test]
    fn a_playback_failure_ends_the_mixed_stream() {
        let (mut mix, _, stream_error) = mix();
        *mix.playback.stream_error.locked() = Some("PipeWire capture failed".into());
        mix.step(false);
        assert_eq!(
            stream_error.locked().as_deref(),
            Some("PipeWire capture failed")
        );
    }

    #[test]
    fn dropping_the_stream_mixes_what_was_recorded_last() {
        let stop = Arc::new(AtomicBool::new(false));
        let microphone = OpenedCapture {
            stream: (),
            context: context(RATE),
            output_sample_rate_hz: RATE,
        };
        let playback = OpenedCapture {
            stream: (),
            context: context(RATE),
            output_sample_rate_hz: RATE,
        };
        let microphone_pending = Arc::clone(&microphone.context.pending_pcm_samples);
        let opened = mix_captures(microphone, playback, &stop, MixLayout::Summed).unwrap();
        microphone_pending.locked().extend_from_slice(&[500; 100]);
        let output = Arc::clone(&opened.context.pending_pcm_samples);
        drop(opened.stream);
        assert_eq!(output.locked().len(), 100);
    }

    #[test]
    fn a_microphone_faster_than_playback_is_refused() {
        let microphone = OpenedCapture {
            stream: (),
            context: context(48_000),
            output_sample_rate_hz: 48_000,
        };
        let playback = OpenedCapture {
            stream: (),
            context: context(RATE),
            output_sample_rate_hz: RATE,
        };
        assert!(mix_captures(microphone, playback, &Arc::default(), MixLayout::Summed).is_err());
    }

    #[test]
    fn separate_channels_are_interleaved_microphone_first() {
        let (mut mix, pending, _) = mix_as(MixLayout::Separate);
        record(&mix.microphone, &[8_000; 1_600]);
        record(&mix.playback, &[-4_000; 1_600]);
        mix.step(true);
        let frames = std::mem::take(&mut *pending.locked());
        assert_eq!(frames.len(), 3_200);
        // not summed: each channel keeps its own sign
        assert!(frames
            .as_chunks::<2>()
            .0
            .iter()
            .all(|frame| frame[0] > 0 && frame[1] < 0));
    }

    #[test]
    fn separate_channels_are_also_held_aside_unprocessed() {
        let (mut mix, pending, _) = mix_as(MixLayout::Separate);
        let unprocessed: Samples = Arc::default();
        mix.output.unprocessed = Some(Arc::clone(&unprocessed));
        // the microphone hears the speakers: the gate would lower it
        record(&mix.microphone, &[4_000; 1_600]);
        record(&mix.playback, &[8_000; 1_600]);
        mix.step(true);
        let raw = std::mem::take(&mut *unprocessed.locked());
        assert_eq!(raw.len(), 3_200);
        assert!(raw
            .as_chunks::<2>()
            .0
            .iter()
            .all(|frame| frame[0].abs_diff(4_000) <= 1 && frame[1].abs_diff(8_000) <= 1));
        assert_eq!(pending.locked().len(), raw.len());
    }

    #[test]
    fn separate_channels_stay_aligned_when_playback_resumes() {
        let (mut mix, pending, _) = mix_as(MixLayout::Separate);
        record(&mix.microphone, &[1_000; 8_000]);
        mix.step(false);
        record(&mix.playback, &[2_000; 1_600]);
        record(&mix.microphone, &[0; 1_600]);
        mix.step(true);
        let frames = std::mem::take(&mut *pending.locked());
        assert_eq!(frames.len(), 2 * 9_600);
        let playback: Vec<i16> = frames
            .as_chunks::<2>()
            .0
            .iter()
            .map(|frame| frame[1])
            .collect();
        assert!(playback[..8_000].iter().all(|&sample| sample == 0));
        assert!(playback[8_000..].iter().all(|&sample| sample > 1_500));
    }

    #[test]
    fn a_separate_capture_reports_two_channels() {
        let microphone = OpenedCapture {
            stream: (),
            context: context(RATE),
            output_sample_rate_hz: RATE,
        };
        let playback = OpenedCapture {
            stream: (),
            context: context(RATE),
            output_sample_rate_hz: RATE,
        };
        let opened =
            mix_captures(microphone, playback, &Arc::default(), MixLayout::Separate).unwrap();
        assert_eq!(opened.context.channel_count, 2);
    }
}
