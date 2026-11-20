//! Keeps the far side of a call out of the microphone channel of a dialog.
//!
//! Without headphones the microphone hears the speakers: the words of the
//! other side would be transcribed a second time, as the user's. While the
//! computer plays speech, a block of the microphone that is clearly quieter
//! than playback and follows its envelope is an echo and is muted. The user
//! speaking over playback is louder and does not follow it, and passes.
//! Real echo cancellation (WebRTC AEC3) is a later step.
use std::collections::VecDeque;

/// The span the decision is made for.
const BLOCK_MS: u32 = 20;
/// How much of the envelope the comparison looks at: half a second.
const HISTORY_BLOCKS: usize = 25;
/// Fewer blocks say nothing about the envelope yet.
const MIN_HISTORY_BLOCKS: usize = 8;
/// How far the microphone may lag behind playback: the speakers, the room
/// and the two captures, up to 100 ms.
const MAX_ECHO_DELAY_BLOCKS: usize = 5;
/// Below about -40 dBFS playback is silence or noise: nothing to echo.
const SPEECH_RMS: f32 = 0.01;
/// An echo is at least about 6 dB quieter than what is played.
const ECHO_RATIO: f32 = 0.5;
/// How closely the microphone must follow playback to be its echo.
const MIN_CORRELATION: f32 = 0.6;
/// The tail of a word keeps the gate shut a little longer: 100 ms.
const HOLD_BLOCKS: usize = 5;

/// Mutes the echo of playback in the microphone, block by block. Both
/// channels go through it in step and come out in step, a block later.
pub(crate) struct EchoGate {
    block_samples: usize,
    microphone: Vec<f32>,
    playback: Vec<f32>,
    microphone_envelope: VecDeque<f32>,
    playback_envelope: VecDeque<f32>,
    hold_blocks: usize,
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

/// Pearson correlation of two equally long series; 0 when one is flat.
fn correlation(a: &[f32], b: &[f32]) -> f32 {
    let count = a.len().min(b.len());
    if count < 2 {
        return 0.0;
    }
    let (a, b) = (&a[..count], &b[..count]);
    let mean_a = a.iter().sum::<f32>() / count as f32;
    let mean_b = b.iter().sum::<f32>() / count as f32;
    let (mut covariance, mut variance_a, mut variance_b) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        covariance += (x - mean_a) * (y - mean_b);
        variance_a += (x - mean_a) * (x - mean_a);
        variance_b += (y - mean_b) * (y - mean_b);
    }
    let denominator = (variance_a * variance_b).sqrt();
    if denominator <= f32::EPSILON {
        return 0.0;
    }
    covariance / denominator
}

impl EchoGate {
    pub(crate) fn new(sample_rate_hz: u32) -> Self {
        Self {
            block_samples: (sample_rate_hz * BLOCK_MS / 1_000).max(1) as usize,
            microphone: Vec::new(),
            playback: Vec::new(),
            microphone_envelope: VecDeque::with_capacity(HISTORY_BLOCKS),
            playback_envelope: VecDeque::with_capacity(HISTORY_BLOCKS),
            hold_blocks: 0,
        }
    }

    /// Takes samples of both channels at the same moments, as many of each;
    /// hands out what is decided, `(microphone, playback)`.
    pub(crate) fn process(&mut self, microphone: &[f32], playback: &[f32]) -> (Vec<f32>, Vec<f32>) {
        self.microphone.extend_from_slice(microphone);
        self.playback.extend_from_slice(playback);
        let blocks = self.microphone.len().min(self.playback.len()) / self.block_samples;
        let count = blocks * self.block_samples;
        let mut microphone: Vec<f32> = self.microphone.drain(..count).collect();
        let playback: Vec<f32> = self.playback.drain(..count).collect();
        for block in 0..blocks {
            let range = block * self.block_samples..(block + 1) * self.block_samples;
            if self.is_echo(&microphone[range.clone()], &playback[range.clone()]) {
                microphone[range].fill(0.0);
            }
        }
        (microphone, playback)
    }

    /// What waits for a whole block, as it is: the capture is over.
    pub(crate) fn finish(&mut self) -> (Vec<f32>, Vec<f32>) {
        let count = self.microphone.len().min(self.playback.len());
        let mut microphone: Vec<f32> = self.microphone.drain(..count).collect();
        let playback: Vec<f32> = self.playback.drain(..count).collect();
        if self.hold_blocks > 0 {
            microphone.fill(0.0);
        }
        self.microphone.clear();
        self.playback.clear();
        (microphone, playback)
    }

    fn is_echo(&mut self, microphone: &[f32], playback: &[f32]) -> bool {
        let microphone_level = rms(microphone);
        let playback_level = rms(playback);
        for (envelope, level) in [
            (&mut self.microphone_envelope, microphone_level),
            (&mut self.playback_envelope, playback_level),
        ] {
            if envelope.len() == HISTORY_BLOCKS {
                envelope.pop_front();
            }
            envelope.push_back(level);
        }
        // the echo comes a little later than what is played: compared with
        // the loudest of playback over that delay
        let recent_playback = self
            .playback_envelope
            .iter()
            .rev()
            .take(MAX_ECHO_DELAY_BLOCKS + 1)
            .copied()
            .fold(0.0, f32::max);
        let is_quieter = microphone_level < recent_playback * ECHO_RATIO;
        let is_echo = recent_playback > SPEECH_RMS
            && is_quieter
            && self.microphone_envelope.iter().sum::<f32>()
                < self.playback_envelope.iter().sum::<f32>() * ECHO_RATIO
            && self.follows_playback();
        if is_echo {
            self.hold_blocks = HOLD_BLOCKS;
            return true;
        }
        if self.hold_blocks > 0 {
            self.hold_blocks -= 1;
            // the user who starts to speak opens the gate at once
            return is_quieter;
        }
        false
    }

    /// Whether the microphone's envelope repeats playback's, at some delay.
    fn follows_playback(&self) -> bool {
        let microphone: Vec<f32> = self.microphone_envelope.iter().copied().collect();
        let playback: Vec<f32> = self.playback_envelope.iter().copied().collect();
        if microphone.len() < MIN_HISTORY_BLOCKS {
            return false;
        }
        (0..=MAX_ECHO_DELAY_BLOCKS)
            .filter(|&delay| microphone.len() - delay >= MIN_HISTORY_BLOCKS)
            .any(|delay| {
                // the microphone at `delay` blocks after playback
                correlation(&microphone[delay..], &playback[..playback.len() - delay])
                    >= MIN_CORRELATION
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    /// Speech-like: a tone whose loudness rises and falls like syllables.
    fn speech(amplitude: f32, seconds: f32, syllable_hz: f32) -> Vec<f32> {
        (0..(RATE as f32 * seconds) as usize)
            .map(|index| {
                let time = index as f32 / RATE as f32;
                let envelope = 0.5 + 0.5 * (std::f32::consts::TAU * syllable_hz * time).sin();
                (std::f32::consts::TAU * 300.0 * time).sin() * amplitude * envelope
            })
            .collect()
    }

    fn delayed(samples: &[f32], delay_samples: usize, gain: f32) -> Vec<f32> {
        let mut output = vec![0.0; delay_samples];
        output.extend(samples.iter().map(|sample| sample * gain));
        output.truncate(samples.len());
        output
    }

    fn tail_rms(samples: &[f32]) -> f32 {
        rms(&samples[samples.len() / 2..])
    }

    #[test]
    fn the_echo_of_playback_is_muted() {
        let playback = speech(0.3, 3.0, 3.0);
        // the speakers heard 40 ms later, 12 dB quieter
        let microphone = delayed(&playback, 640, 0.25);
        let mut gate = EchoGate::new(RATE);
        let (gated, played) = gate.process(&microphone, &playback);
        assert_eq!(gated.len(), played.len());
        assert!(
            tail_rms(&gated) < tail_rms(&microphone) * 0.2,
            "{}",
            tail_rms(&gated)
        );
        // playback itself is never touched
        assert_eq!(played, playback[..played.len()]);
    }

    #[test]
    fn the_user_speaking_alone_passes() {
        let microphone = speech(0.2, 2.0, 4.0);
        let playback = vec![0.0; microphone.len()];
        let mut gate = EchoGate::new(RATE);
        let (gated, _) = gate.process(&microphone, &playback);
        assert_eq!(gated, microphone[..gated.len()]);
    }

    #[test]
    fn the_user_speaking_over_playback_passes() {
        let playback = speech(0.2, 3.0, 3.0);
        // louder than the far side and with a rhythm of its own
        let microphone = speech(0.4, 3.0, 5.3);
        let mut gate = EchoGate::new(RATE);
        let (gated, _) = gate.process(&microphone, &playback);
        assert!(tail_rms(&gated) > tail_rms(&microphone) * 0.9);
    }

    #[test]
    fn channels_stay_in_step_across_calls() {
        let mut gate = EchoGate::new(RATE);
        let (microphone, playback) = gate.process(&[0.1; 100], &[0.0; 100]);
        assert!(microphone.is_empty() && playback.is_empty());
        let (microphone, playback) = gate.process(&[0.1; 300], &[0.0; 300]);
        assert_eq!((microphone.len(), playback.len()), (320, 320));
        let (microphone, playback) = gate.finish();
        assert_eq!((microphone.len(), playback.len()), (80, 80));
    }
}
