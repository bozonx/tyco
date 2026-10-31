//! Pure conversion and metering of microphone samples.
use cpal::Sample;

/// One second-order section of an IIR filter (RBJ cookbook, direct form I).
#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn low_pass(sample_rate_hz: f64, cutoff_hz: f64, q: f64) -> Self {
        let omega = std::f64::consts::TAU * cutoff_hz / sample_rate_hz;
        let alpha = omega.sin() / (2.0 * q);
        let cos = omega.cos();
        let a0 = 1.0 + alpha;
        Self {
            b0: ((1.0 - cos) / 2.0 / a0) as f32,
            b1: ((1.0 - cos) / a0) as f32,
            b2: ((1.0 - cos) / 2.0 / a0) as f32,
            a1: (-2.0 * cos / a0) as f32,
            a2: ((1.0 - alpha) / a0) as f32,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// Q of the two sections of a fourth-order Butterworth low-pass
const BUTTERWORTH_Q: [f64; 2] = [0.541_196_1, 1.306_563];
/// Where the low-pass sets in, as a share of the output rate: just under its
/// Nyquist rate, which is half of it
const CUTOFF_SHARE: f64 = 0.43;

/// Lowers the sample rate for speech recognition. A fourth-order low-pass
/// first removes what the new rate cannot hold: left in, sibilants above it
/// would fold back into the speech band as noise. Each window of the filtered
/// input then becomes one output sample.
pub(super) struct Downsampler {
    /// Input samples per output sample, at least 1.
    step: f64,
    phase: f64,
    sample_sum: f32,
    sample_count: u32,
    /// Empty when the rate stays as it is
    low_pass: Vec<Biquad>,
}

impl Downsampler {
    pub(super) fn new(input_sample_rate_hz: u32, output_sample_rate_hz: u32) -> Self {
        let step = (f64::from(input_sample_rate_hz) / f64::from(output_sample_rate_hz)).max(1.0);
        let low_pass = if step > 1.0 {
            let cutoff_hz = f64::from(output_sample_rate_hz) * CUTOFF_SHARE;
            BUTTERWORTH_Q
                .iter()
                .map(|&q| Biquad::low_pass(f64::from(input_sample_rate_hz), cutoff_hz, q))
                .collect()
        } else {
            Vec::new()
        };
        Self {
            step,
            phase: 0.0,
            sample_sum: 0.0,
            sample_count: 0,
            low_pass,
        }
    }

    pub(super) fn push(&mut self, sample: f32, output: &mut Vec<i16>) {
        let filtered = self
            .low_pass
            .iter_mut()
            .fold(sample, |value, section| section.process(value));
        self.sample_sum += filtered;
        self.sample_count += 1;
        self.phase += 1.0;
        if self.phase >= self.step {
            output.push(float_to_pcm16(self.sample_sum / self.sample_count as f32));
            self.phase -= self.step;
            self.sample_sum = 0.0;
            self.sample_count = 0;
        }
    }
}

pub(super) fn mix_frame<T>(frame: &[T]) -> f32
where
    T: Copy,
    f32: cpal::FromSample<T>,
{
    frame
        .iter()
        .map(|sample| f32::from_sample(*sample))
        .sum::<f32>()
        / frame.len() as f32
}

fn float_to_pcm16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    let value = if clamped < 0.0 {
        clamped * 32768.0
    } else {
        clamped * 32767.0
    };
    value.round() as i16
}

pub(super) fn pcm16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

pub fn compute_audio_level(samples: &[i16]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum_sq = 0.0_f32;
    let mut peak = 0.0_f32;
    for &sample in samples {
        let norm = (sample as f32 / 32768.0).abs();
        if norm > peak {
            peak = norm;
        }
        sum_sq += norm * norm;
    }
    let rms = (sum_sq / samples.len() as f32).sqrt();
    (rms.clamp(0.0, 1.0), peak.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_float_samples_without_overflow() {
        assert_eq!(float_to_pcm16(-2.0), i16::MIN);
        assert_eq!(float_to_pcm16(0.0), 0);
        assert_eq!(float_to_pcm16(2.0), i16::MAX);
    }

    #[test]
    fn mixes_every_channel_in_a_frame() {
        assert_eq!(mix_frame(&[1.0_f32, -1.0_f32]), 0.0);
        assert_eq!(mix_frame(&[0.5_f32, 0.5_f32]), 0.5);
    }

    /// RMS of a sine at `frequency_hz` after downsampling 48 kHz to 16 kHz
    fn downsampled_rms(frequency_hz: f64) -> f32 {
        let mut downsampler = Downsampler::new(48_000, 16_000);
        let mut output = Vec::new();
        for index in 0..48_000 {
            let time = f64::from(index) / 48_000.0;
            let sample = (std::f64::consts::TAU * frequency_hz * time).sin() as f32 * 0.5;
            downsampler.push(sample, &mut output);
        }
        // past the filter's settling
        compute_audio_level(&output[1_600..]).0
    }

    #[test]
    fn keeps_speech_and_removes_what_would_fold_back_when_downsampling() {
        let input_rms = 0.5 / std::f32::consts::SQRT_2;
        // speech passes nearly untouched
        assert!(downsampled_rms(1_000.0) > input_rms * 0.9);
        // 12 kHz would alias to 4 kHz at 16 kHz: it is damped far down
        assert!(downsampled_rms(12_000.0) < input_rms * 0.05);
    }

    #[test]
    fn keeps_a_constant_level_when_downsampling() {
        let mut downsampler = Downsampler::new(48_000, 16_000);
        let mut output = Vec::new();
        for _ in 0..4_800 {
            downsampler.push(0.5, &mut output);
        }
        assert_eq!(output.len(), 1_600);
        assert_eq!(*output.last().unwrap(), float_to_pcm16(0.5));
    }

    #[test]
    fn keeps_the_output_rate_for_fractional_ratios() {
        let mut downsampler = Downsampler::new(44_100, 16_000);
        let mut output = Vec::new();
        for _ in 0..44_100 {
            downsampler.push(0.0, &mut output);
        }
        // the step is not exact in binary, so one sample either way is fine
        assert!(output.len().abs_diff(16_000) <= 1);
    }

    #[test]
    fn passes_audio_through_at_or_below_the_target_rate() {
        let mut downsampler = Downsampler::new(8_000, 8_000);
        let mut output = Vec::new();
        downsampler.push(0.5, &mut output);
        downsampler.push(-0.5, &mut output);
        assert_eq!(output, vec![float_to_pcm16(0.5), float_to_pcm16(-0.5)]);
    }

    #[test]
    fn encodes_pcm16_little_endian() {
        assert_eq!(pcm16_to_le_bytes(&[1, -2]), vec![1, 0, 0xfe, 0xff]);
    }

    #[test]
    fn computes_audio_level_for_empty_slice() {
        assert_eq!(compute_audio_level(&[]), (0.0, 0.0));
    }

    #[test]
    fn computes_audio_level_for_silence_and_signals() {
        assert_eq!(compute_audio_level(&[0, 0, 0]), (0.0, 0.0));

        let (level, peak) = compute_audio_level(&[16_384, -16_384]);
        assert!((peak - 0.5).abs() < 1e-3);
        assert!((level - 0.5).abs() < 1e-3);
    }
}
