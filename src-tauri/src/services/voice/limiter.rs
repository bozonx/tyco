//! Keeps peaks under full scale without clipping them: a clipped word is
//! distorted for the speech model, a word lowered for a moment is not.
//!
//! The limiter looks a few milliseconds ahead: samples wait in a delay line,
//! and the gain is lowered while a peak is still on its way, so that it
//! arrives at the ceiling instead of past it. The gain then recovers slowly,
//! without pumping between syllables.
use std::collections::VecDeque;

/// The highest sample that leaves the limiter: about -1 dBFS.
const CEILING: f32 = 0.9;
/// How far the limiter looks ahead, and so how late its samples are.
const LOOKAHEAD_MS: u32 = 4;
/// How fast the gain comes back up after a peak.
const RELEASE_S: f32 = 0.08;

/// Limits one channel. Its output is `lookahead` samples behind its input;
/// `finish` lets out the rest.
pub(crate) struct PeakLimiter {
    delay: VecDeque<f32>,
    /// The gain each sample in `delay` needs on its own, in step with it.
    needed: VecDeque<f32>,
    lookahead: usize,
    gain: f32,
    attack_coefficient: f32,
    release_coefficient: f32,
}

impl PeakLimiter {
    pub(crate) fn new(sample_rate_hz: u32) -> Self {
        let lookahead = (sample_rate_hz * LOOKAHEAD_MS / 1_000).max(1) as usize;
        Self {
            delay: VecDeque::with_capacity(lookahead + 1),
            needed: VecDeque::with_capacity(lookahead + 1),
            lookahead,
            gain: 1.0,
            // the gain reaches nearly all the way down within the lookahead
            attack_coefficient: 1.0 - (-3.0 / lookahead as f32).exp(),
            release_coefficient: 1.0 - (-1.0 / (RELEASE_S * sample_rate_hz as f32)).exp(),
        }
    }

    #[cfg(test)]
    pub(crate) fn lookahead(&self) -> usize {
        self.lookahead
    }

    pub(crate) fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let mut output = Vec::with_capacity(input.len());
        for &sample in input {
            self.delay.push_back(sample);
            self.needed.push_back(needed_gain(sample));
            if self.delay.len() > self.lookahead {
                output.push(self.next());
            }
        }
        output
    }

    /// The samples still in the delay line: the capture is over.
    pub(crate) fn finish(&mut self) -> Vec<f32> {
        let mut output = Vec::with_capacity(self.delay.len());
        while !self.delay.is_empty() {
            output.push(self.next());
        }
        output
    }

    fn next(&mut self) -> f32 {
        // the lowest gain any sample up to the end of the lookahead needs
        let target = self.needed.iter().copied().fold(1.0, f32::min);
        let coefficient = if target < self.gain {
            self.attack_coefficient
        } else {
            self.release_coefficient
        };
        self.gain += coefficient * (target - self.gain);
        self.needed.pop_front();
        let sample = self.delay.pop_front().unwrap_or(0.0);
        // what the smoothed gain has not caught yet is cut at the ceiling
        (sample * self.gain).clamp(-CEILING, CEILING)
    }
}

fn needed_gain(sample: f32) -> f32 {
    let magnitude = sample.abs();
    if magnitude > CEILING {
        CEILING / magnitude
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn run(limiter: &mut PeakLimiter, input: &[f32]) -> Vec<f32> {
        let mut output = limiter.process(input);
        output.extend(limiter.finish());
        output
    }

    #[test]
    fn quiet_audio_passes_unchanged_and_in_full() {
        let mut limiter = PeakLimiter::new(RATE);
        let input: Vec<f32> = (0..1_000)
            .map(|index| (index as f32 * 0.01).sin() * 0.5)
            .collect();
        let output = limiter.process(&input);
        assert_eq!(output.len(), input.len() - limiter.lookahead());
        assert_eq!(output, input[..output.len()]);
        let mut all = output;
        all.extend(limiter.finish());
        assert_eq!(all, input);
    }

    #[test]
    fn a_loud_peak_stays_under_the_ceiling() {
        let mut limiter = PeakLimiter::new(RATE);
        let mut input = vec![0.3; 800];
        input.extend(vec![1.6; 400]);
        input.extend(vec![0.3; 800]);
        let output = run(&mut limiter, &input);
        assert_eq!(output.len(), input.len());
        assert!(output.iter().all(|sample| sample.abs() <= CEILING));
    }

    #[test]
    fn the_gain_is_lowered_before_the_peak_arrives() {
        let mut limiter = PeakLimiter::new(RATE);
        let mut input = vec![0.5; 400];
        input.push(1.8);
        input.extend(vec![0.5; 400]);
        let output = run(&mut limiter, &input);
        // the peak lands near the ceiling, smoothly reached, not cut flat
        assert!(output[400] > CEILING * 0.9, "{}", output[400]);
        assert!(output[399] < 0.5);
        // nothing changes before the lookahead reaches the peak
        assert_eq!(output[400 - limiter.lookahead() - 1], 0.5);
    }

    #[test]
    fn the_gain_recovers_after_a_peak() {
        let mut limiter = PeakLimiter::new(RATE);
        let mut input = vec![1.8; 100];
        input.extend(vec![0.5; RATE as usize]);
        let output = run(&mut limiter, &input);
        // half a second later the gain is back to unity
        assert!((output[RATE as usize / 2] - 0.5).abs() < 1e-3);
    }
}
