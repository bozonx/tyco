//! Pure conversion and metering of microphone samples.
use cpal::Sample;

/// Averages each window of input samples into one output sample. This box
/// filter only damps what lies above the new Nyquist rate, it does not remove
/// it; for speech recognition that is enough, for playback it would not be.
pub(super) struct Downsampler {
    /// Input samples per output sample, at least 1.
    step: f64,
    phase: f64,
    sample_sum: f32,
    sample_count: u32,
}

impl Downsampler {
    pub(super) fn new(input_sample_rate_hz: u32, output_sample_rate_hz: u32) -> Self {
        Self {
            step: (f64::from(input_sample_rate_hz) / f64::from(output_sample_rate_hz)).max(1.0),
            phase: 0.0,
            sample_sum: 0.0,
            sample_count: 0,
        }
    }

    pub(super) fn push(&mut self, sample: f32, output: &mut Vec<i16>) {
        self.sample_sum += sample;
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

    #[test]
    fn averages_each_window_when_downsampling() {
        let mut downsampler = Downsampler::new(48_000, 16_000);
        let mut output = Vec::new();
        for sample in [0.0, 0.3, 0.6, 1.0, 1.0, 1.0, -1.0] {
            downsampler.push(sample, &mut output);
        }
        assert_eq!(output, vec![float_to_pcm16(0.3), i16::MAX]);
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
