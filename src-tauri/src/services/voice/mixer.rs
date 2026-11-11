//! Mixes the streams of one application into one: a browser plays a stream
//! per tab, a messenger one per voice message.
use std::collections::{HashMap, VecDeque};

/// Mono samples of several streams summed in step. Each stream writes from
/// where it joined; what every stream has written goes out, and a stream
/// that falls too far behind is not waited for.
pub struct StreamMixer {
    buffer: VecDeque<f32>,
    /// The absolute position of `buffer[0]`.
    base: u64,
    /// Where each stream writes next, as an absolute position.
    cursors: HashMap<u32, u64>,
    max_lag_samples: u64,
}

impl StreamMixer {
    pub fn new(max_lag_samples: u64) -> Self {
        Self {
            buffer: VecDeque::new(),
            base: 0,
            cursors: HashMap::new(),
            max_lag_samples,
        }
    }

    fn head(&self) -> u64 {
        self.base + self.buffer.len() as u64
    }

    /// A stream joins at the present: the newest sample written so far.
    pub fn add_stream(&mut self, id: u32) {
        let head = self
            .cursors
            .values()
            .copied()
            .max()
            .unwrap_or_else(|| self.head());
        self.cursors.entry(id).or_insert(head);
    }

    pub fn remove_stream(&mut self, id: u32) {
        self.cursors.remove(&id);
    }

    #[cfg(test)]
    pub fn stream_count(&self) -> usize {
        self.cursors.len()
    }

    pub fn push(&mut self, id: u32, samples: &[f32]) {
        let Some(cursor) = self.cursors.get_mut(&id) else {
            return;
        };
        // a stream that lagged past what went out writes from the present
        let start = (*cursor).max(self.base);
        let end = start + samples.len() as u64;
        *cursor = end;
        let head = self.head();
        if end > head {
            self.buffer
                .extend(std::iter::repeat_n(0.0, (end - head) as usize));
        }
        for (offset, sample) in samples.iter().enumerate() {
            let index = (start - self.base) as usize + offset;
            self.buffer[index] += sample;
        }
    }

    /// The samples every stream has written, or that one stream got ahead
    /// of the others by more than the lag allows.
    pub fn finish(&mut self) -> Vec<f32> {
        self.cursors.clear();
        self.drain()
    }

    pub fn drain(&mut self) -> Vec<f32> {
        let head = self.head();
        let slowest = self.cursors.values().copied().min().unwrap_or(head);
        let ready_until = slowest.max(head.saturating_sub(self.max_lag_samples));
        let count = ready_until.saturating_sub(self.base) as usize;
        self.base += count as u64;
        self.buffer
            .drain(..count)
            .map(|sample| sample.clamp(-1.0, 1.0))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finishing_releases_the_tail_held_for_a_silent_stream() {
        let mut mixer = StreamMixer::new(3200);
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &vec![0.5; 16000]);
        assert_eq!(mixer.drain().len(), 12800);
        assert_eq!(mixer.finish(), vec![0.5; 3200]);
        assert!(mixer.finish().is_empty());
    }

    #[test]
    fn a_single_stream_passes_through() {
        let mut mixer = StreamMixer::new(1_000);
        mixer.add_stream(1);
        mixer.push(1, &[0.1, 0.2]);
        assert_eq!(mixer.drain(), vec![0.1, 0.2]);
        mixer.push(1, &[0.3]);
        assert_eq!(mixer.drain(), vec![0.3]);
    }

    #[test]
    fn two_streams_are_summed_in_step() {
        let mut mixer = StreamMixer::new(1_000);
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &[0.25, 0.25, 0.25]);
        // the second stream has not written yet: nothing is final
        assert!(mixer.drain().is_empty());
        mixer.push(2, &[0.5, 0.5]);
        assert_eq!(mixer.drain(), vec![0.75, 0.75]);
        mixer.push(2, &[0.5]);
        assert_eq!(mixer.drain(), vec![0.75]);
    }

    #[test]
    fn a_stalled_stream_is_not_waited_for() {
        let mut mixer = StreamMixer::new(2);
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &[0.1, 0.1, 0.1, 0.1]);
        assert_eq!(mixer.drain(), vec![0.1, 0.1]);
        // the stalled stream resumes in the present, not over what went out
        mixer.push(2, &[0.5, 0.5, 0.5]);
        mixer.remove_stream(1);
        assert_eq!(mixer.drain(), vec![0.6, 0.6, 0.5]);
    }

    #[test]
    fn a_stream_that_joins_later_starts_at_the_present() {
        let mut mixer = StreamMixer::new(1_000);
        mixer.add_stream(1);
        mixer.push(1, &[0.1, 0.1]);
        mixer.add_stream(2);
        mixer.push(2, &[0.2]);
        mixer.push(1, &[0.1]);
        assert_eq!(mixer.drain(), vec![0.1, 0.1, 0.3]);
    }

    #[test]
    fn the_sum_is_clipped() {
        let mut mixer = StreamMixer::new(1_000);
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &[0.8]);
        mixer.push(2, &[0.8]);
        assert_eq!(mixer.drain(), vec![1.0]);
    }

    #[test]
    fn a_removed_stream_releases_the_others() {
        let mut mixer = StreamMixer::new(1_000);
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &[0.1]);
        mixer.remove_stream(2);
        assert_eq!(mixer.drain(), vec![0.1]);
        assert_eq!(mixer.stream_count(), 1);
    }
}
