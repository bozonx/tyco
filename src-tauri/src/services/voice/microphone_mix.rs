//! The microphone and the sound the computer plays as one stream, so that a
//! single transcription hears both sides of a call.
//!
//! Each source is brought to a common loudness first: a quiet microphone
//! next to a loud call, or the other way round, would otherwise leave one
//! side to the speech model as a murmur. The two are then summed in step by
//! `StreamMixer`, which does not wait for playback while nothing plays.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::audio_processing::compute_audio_level;
use super::mixer::StreamMixer;
use super::{OpenedCapture, StreamContext};
use crate::errors::AppError;
use crate::locks::MutexExt;

/// The loudness speech is brought to: about -22 dBFS, leaving headroom for
/// both sources speaking at once.
const TARGET_RMS: f32 = 0.08;
/// Below about -46 dBFS there is silence or room noise: the gain holds, so
/// that noise is not raised to the loudness of speech.
const GATE_RMS: f32 = 0.005;
/// A loud source is lowered at most this much...
const MIN_GAIN: f32 = 0.1;
/// ...and a quiet one raised at most this much, about +18 dB.
const MAX_GAIN: f32 = 8.0;
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

/// A one-pole smoothing coefficient for a time constant at a sample rate.
fn coefficient(time_s: f32, sample_rate_hz: u32) -> f32 {
    1.0 - (-1.0 / (time_s * sample_rate_hz as f32)).exp()
}

/// Brings speech to `TARGET_RMS` with a slowly moving gain.
pub(crate) struct LoudnessNormalizer {
    power: f32,
    speech_level: f32,
    gain: f32,
    power_coefficient: f32,
    rise_coefficient: f32,
    fall_coefficient: f32,
    gain_coefficient: f32,
}

impl LoudnessNormalizer {
    pub(crate) fn new(sample_rate_hz: u32) -> Self {
        Self {
            power: 0.0,
            // starts as if speech were at the target: unity gain
            speech_level: TARGET_RMS,
            gain: 1.0,
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
            if rms > GATE_RMS {
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
    microphone_loudness: LoudnessNormalizer,
    playback_loudness: LoudnessNormalizer,
}

impl Mix {
    fn new(microphone: StreamContext, playback: StreamContext, output: MixOutput) -> Self {
        let rate = playback.output_sample_rate_hz;
        let mut mixer = StreamMixer::new(u64::from(rate) * MAX_LAG_MS / 1_000);
        mixer.add_stream(MICROPHONE);
        mixer.add_stream(PLAYBACK);
        Self {
            upsampler: Upsampler::new(microphone.output_sample_rate_hz, rate),
            microphone,
            playback,
            output,
            mixer,
            microphone_loudness: LoudnessNormalizer::new(rate),
            playback_loudness: LoudnessNormalizer::new(rate),
        }
    }

    /// Mixes what is ready; `is_final` also lets out what waits for the
    /// other source.
    fn step(&mut self, is_final: bool) {
        let recorded = take_samples(&self.microphone.pending_pcm_samples);
        let mut microphone = Vec::with_capacity(recorded.len() * 2);
        self.upsampler.push(&recorded, &mut microphone);
        self.microphone_loudness.process(&mut microphone);
        self.mixer.push(MICROPHONE, &microphone);

        let mut playback = take_samples(&self.playback.pending_pcm_samples);
        self.playback_loudness.process(&mut playback);
        self.mixer.push(PLAYBACK, &playback);

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
        if mixed.is_empty() {
            return;
        }
        let samples: Vec<i16> = mixed
            .iter()
            .map(|sample| (sample * f32::from(i16::MAX)) as i16)
            .collect();
        {
            let (rms, peak) = compute_audio_level(&samples);
            let mut level = self.output.level.locked();
            *level = (level.0.max(rms), level.1.max(peak));
        }
        self.output.pending.locked().extend_from_slice(&samples);
    }
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
        status: Arc::clone(&playback.context.status),
    };
    let output = MixOutput {
        pending: Arc::clone(&context.pending_pcm_samples),
        level: Arc::clone(&context.current_level),
        stream_error: Arc::clone(&context.stream_error),
    };
    let mut mix = Mix::new(microphone.context, playback.context, output);
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

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    fn normalized_rms(amplitude: f32) -> f32 {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut samples = tone(amplitude, 8.0);
        normalizer.process(&mut samples);
        // once the level has settled
        rms(&samples[samples.len() - RATE as usize..])
    }

    #[test]
    fn quiet_and_loud_speech_come_out_alike() {
        let quiet = normalized_rms(0.02);
        let loud = normalized_rms(0.6);
        assert!((quiet - TARGET_RMS).abs() < TARGET_RMS * 0.15, "{quiet}");
        assert!((loud - TARGET_RMS).abs() < TARGET_RMS * 0.15, "{loud}");
    }

    #[test]
    fn silence_and_noise_are_not_raised() {
        let mut normalizer = LoudnessNormalizer::new(RATE);
        let mut noise = tone(0.001, 4.0);
        normalizer.process(&mut noise);
        assert!(rms(&noise) <= 0.001, "{}", rms(&noise));
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
        let pending: Arc<Mutex<Vec<i16>>> = Arc::default();
        let stream_error: Arc<Mutex<Option<String>>> = Arc::default();
        let output = MixOutput {
            pending: Arc::clone(&pending),
            level: Arc::default(),
            stream_error: Arc::clone(&stream_error),
        };
        (
            Mix::new(context(RATE), context(RATE), output),
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
        assert_eq!(mixed.len(), 1_600);
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
        assert_eq!(pending.locked().len(), 16_000 - lag);
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
        let opened = mix_captures(microphone, playback, &stop).unwrap();
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
        assert!(mix_captures(microphone, playback, &Arc::default()).is_err());
    }
}
