//! Mixes the streams of one application into one: a browser plays a stream
//! per tab, a messenger one per voice message. With several lanes it keeps
//! sources apart instead, in step: the channels of a dialog.
use std::collections::{HashMap, VecDeque};

/// Where a stream writes next, and to which lane.
#[derive(Clone, Copy)]
struct Cursor {
    /// An absolute frame position.
    position: u64,
    lane: usize,
}

/// Samples of several streams in step. Each stream writes from where it
/// joined into its lane, summed with the other streams of that lane; what
/// every stream has written goes out, and a stream that falls too far behind
/// is not waited for. Frames of several lanes come out interleaved.
pub struct StreamMixer {
    /// Interleaved frames of `lanes` samples.
    buffer: VecDeque<f32>,
    /// The absolute frame position of the first frame of `buffer`.
    base: u64,
    cursors: HashMap<u32, Cursor>,
    lanes: usize,
    max_lag_samples: u64,
    /// Whether the sum is cut at full scale; off when a limiter follows.
    clips: bool,
}

impl StreamMixer {
    /// One lane: every stream is summed into it.
    pub fn new(max_lag_samples: u64) -> Self {
        Self::with_lanes(max_lag_samples, 1)
    }

    /// `lanes` channels kept apart; `max_lag_samples` counts frames.
    pub fn with_lanes(max_lag_samples: u64, lanes: usize) -> Self {
        Self {
            buffer: VecDeque::new(),
            base: 0,
            cursors: HashMap::new(),
            lanes: lanes.max(1),
            max_lag_samples,
            clips: true,
        }
    }

    /// Hands the sum on past full scale, for a limiter that follows.
    pub fn unclipped(mut self) -> Self {
        self.clips = false;
        self
    }

    fn head(&self) -> u64 {
        self.base + (self.buffer.len() / self.lanes) as u64
    }

    /// A stream joins at the present: the newest sample written so far.
    pub fn add_stream(&mut self, id: u32) {
        self.add_stream_to_lane(id, 0);
    }

    pub fn add_stream_to_lane(&mut self, id: u32, lane: usize) {
        let head = self
            .cursors
            .values()
            .map(|cursor| cursor.position)
            .max()
            .unwrap_or_else(|| self.head());
        self.cursors.entry(id).or_insert(Cursor {
            position: head,
            lane: lane.min(self.lanes - 1),
        });
    }

    pub fn remove_stream(&mut self, id: u32) {
        self.cursors.remove(&id);
    }

    #[cfg(test)]
    pub fn stream_count(&self) -> usize {
        self.cursors.len()
    }

    pub fn push(&mut self, id: u32, samples: &[f32]) {
        let head = self.head();
        let base = self.base;
        let Some(cursor) = self.cursors.get_mut(&id) else {
            return;
        };
        // a stream that lagged past what went out was silent, not late: it
        // resumes at the present, in step with the streams that kept time
        let start = if cursor.position < base {
            head
        } else {
            cursor.position
        };
        let end = start + samples.len() as u64;
        cursor.position = end;
        let lane = cursor.lane;
        if end > head {
            self.buffer
                .extend(std::iter::repeat_n(0.0, (end - head) as usize * self.lanes));
        }
        for (offset, sample) in samples.iter().enumerate() {
            let frame = (start - base) as usize + offset;
            self.buffer[frame * self.lanes + lane] += sample;
        }
    }

    /// The frames every stream has written, or that one stream got ahead
    /// of the others by more than the lag allows.
    pub fn finish(&mut self) -> Vec<f32> {
        self.cursors.clear();
        self.drain()
    }

    pub fn drain(&mut self) -> Vec<f32> {
        let head = self.head();
        let slowest = self
            .cursors
            .values()
            .map(|cursor| cursor.position)
            .min()
            .unwrap_or(head);
        let ready_until = slowest.max(head.saturating_sub(self.max_lag_samples));
        let count = ready_until.saturating_sub(self.base) as usize;
        self.base += count as u64;
        let clips = self.clips;
        self.buffer
            .drain(..count * self.lanes)
            .map(|sample| {
                if clips {
                    sample.clamp(-1.0, 1.0)
                } else {
                    sample
                }
            })
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
        // the stalled stream resumes at the present, after what the other
        // stream wrote, not over the samples still held for it
        mixer.push(2, &[0.5, 0.5, 0.5]);
        mixer.remove_stream(1);
        assert_eq!(mixer.drain(), vec![0.1, 0.1, 0.5, 0.5, 0.5]);
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
    fn an_unclipped_sum_goes_past_full_scale() {
        let mut mixer = StreamMixer::new(1_000).unclipped();
        mixer.add_stream(1);
        mixer.add_stream(2);
        mixer.push(1, &[0.8]);
        mixer.push(2, &[0.8]);
        assert_eq!(mixer.drain(), vec![1.6]);
    }

    #[test]
    fn lanes_stay_apart_and_in_step() {
        let mut mixer = StreamMixer::with_lanes(1_000, 2);
        mixer.add_stream_to_lane(1, 0);
        mixer.add_stream_to_lane(2, 1);
        mixer.push(1, &[0.1, 0.2, 0.3]);
        mixer.push(2, &[0.5, 0.6]);
        assert_eq!(mixer.drain(), vec![0.1, 0.5, 0.2, 0.6]);
        mixer.push(2, &[0.7]);
        assert_eq!(mixer.drain(), vec![0.3, 0.7]);
    }

    #[test]
    fn a_silent_lane_is_filled_with_silence_past_the_lag() {
        let mut mixer = StreamMixer::with_lanes(2, 2);
        mixer.add_stream_to_lane(1, 0);
        mixer.add_stream_to_lane(2, 1);
        mixer.push(1, &[0.1, 0.1, 0.1, 0.1]);
        assert_eq!(mixer.drain(), vec![0.1, 0.0, 0.1, 0.0]);
        // the silent lane resumes at the present, after what went out
        mixer.push(2, &[0.5]);
        mixer.push(1, &[0.2]);
        assert_eq!(mixer.finish(), vec![0.1, 0.0, 0.1, 0.0, 0.2, 0.5]);
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
