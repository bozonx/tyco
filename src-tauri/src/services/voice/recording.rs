//! A call recording: the dialog's capture encoded to Ogg/Opus while it runs.
//!
//! Nothing is buffered beyond a second: a page is flushed at least that
//! often, and Ogg pages stand on their own, so a crash leaves a file that
//! plays up to its last page even without the final end-of-stream page.
//!
//! A disk that falls behind can leave a gap of up to a minute: what could not be
//! queued becomes silence of the same length once the queue frees, so the
//! file keeps the call's timeline.
//!
//! The file is written aside, in the state folder, and joins the history
//! once closed, see `storage::recordings`.
//!
//! Granule positions follow RFC 7845: always counted at 48 kHz, whatever the
//! input rate, with the encoder’s pre-skip included in the final position.
use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;

use ogg::writing::{PacketWriteEndInfo, PacketWriter};

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::storage::recordings::{self, NewRecording};

/// What Opus counts its time in, whatever it encodes.
const GRANULE_RATE_HZ: u32 = 48_000;
const FRAME_MS: u32 = 20;
/// A page at least this often: what a crash may lose at most.
const PAGE_INTERVAL_MS: u32 = 1_000;
/// Large enough for a 20 ms frame at any bitrate used here.
const MAX_PACKET_BYTES: usize = 4_000;
const STEREO_BITRATE_BPS: i32 = 32_000;
const MONO_BITRATE_BPS: i32 = 24_000;
/// How many chunks of about 100 ms may wait for the disk.
const QUEUE_CHUNKS: usize = 100;
/// The longest gap of a stalled disk that is filled with silence.
const MAX_GAP_SECONDS: usize = 60;
const VENDOR: &str = "TyCo";

fn encoding_error(error: opus::Error) -> io::Error {
    io::Error::other(format!("Opus encoder: {error}"))
}

/// Writes interleaved PCM16 as an Ogg/Opus stream.
pub struct OggOpusWriter<W: Write> {
    packets: PacketWriter<'static, W>,
    encoder: opus::Encoder,
    serial: u32,
    channels: usize,
    /// Input samples per channel in one frame.
    frame_samples: usize,
    /// Input to granule: 3 for 16 kHz.
    granule_factor: u64,
    pre_skip: u64,
    /// Interleaved samples waiting for a whole frame.
    pending: Vec<i16>,
    /// Samples per channel encoded so far, at the input rate.
    encoded_samples: u64,
    frames_in_page: u32,
    frames_per_page: u32,
    packet: Vec<u8>,
}

impl OggOpusWriter<BufWriter<File>> {
    /// Creates the file, refusing to overwrite one; a file whose headers
    /// could not be written is removed.
    pub fn create(path: &Path, sample_rate_hz: u32, channels: u16) -> io::Result<Self> {
        let file = File::options().write(true).create_new(true).open(path)?;
        Self::new(BufWriter::new(file), sample_rate_hz, channels).inspect_err(|_| {
            let _ = std::fs::remove_file(path);
        })
    }
}

impl<W: Write> OggOpusWriter<W> {
    pub fn new(writer: W, sample_rate_hz: u32, channels: u16) -> io::Result<Self> {
        let (opus_channels, bitrate) = match channels {
            1 => (opus::Channels::Mono, MONO_BITRATE_BPS),
            2 => (opus::Channels::Stereo, STEREO_BITRATE_BPS),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "A recording has one or two channels",
                ))
            }
        };
        if sample_rate_hz == 0 || !GRANULE_RATE_HZ.is_multiple_of(sample_rate_hz) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("Opus does not encode {sample_rate_hz} Hz"),
            ));
        }
        let mut encoder =
            opus::Encoder::new(sample_rate_hz, opus_channels, opus::Application::Voip)
                .map_err(encoding_error)?;
        encoder
            .set_bitrate(opus::Bitrate::Bits(bitrate))
            .map_err(encoding_error)?;
        let granule_factor = u64::from(GRANULE_RATE_HZ / sample_rate_hz);
        let lookahead = encoder.get_lookahead().map_err(encoding_error)?;
        let pre_skip = u64::try_from(lookahead).unwrap_or(0) * granule_factor;
        let serial = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.subsec_nanos() ^ elapsed.as_secs() as u32)
            .unwrap_or(1);
        let mut writer = Self {
            packets: PacketWriter::new(writer),
            encoder,
            serial,
            channels: usize::from(channels),
            frame_samples: (sample_rate_hz * FRAME_MS / 1_000) as usize,
            granule_factor,
            pre_skip,
            pending: Vec::new(),
            encoded_samples: 0,
            frames_in_page: 0,
            frames_per_page: PAGE_INTERVAL_MS / FRAME_MS,
            packet: vec![0; MAX_PACKET_BYTES],
        };
        writer.write_headers(sample_rate_hz, channels)?;
        Ok(writer)
    }

    fn write_headers(&mut self, sample_rate_hz: u32, channels: u16) -> io::Result<()> {
        let mut head = Vec::with_capacity(19);
        head.extend_from_slice(b"OpusHead");
        head.push(1);
        head.push(channels as u8);
        head.extend_from_slice(&(self.pre_skip as u16).to_le_bytes());
        head.extend_from_slice(&sample_rate_hz.to_le_bytes());
        head.extend_from_slice(&0i16.to_le_bytes());
        // mapping family 0: mono or stereo, left then right
        head.push(0);
        self.packets
            .write_packet(head, self.serial, PacketWriteEndInfo::EndPage, 0)?;

        let mut tags = Vec::new();
        tags.extend_from_slice(b"OpusTags");
        tags.extend_from_slice(&(VENDOR.len() as u32).to_le_bytes());
        tags.extend_from_slice(VENDOR.as_bytes());
        tags.extend_from_slice(&0u32.to_le_bytes());
        self.packets
            .write_packet(tags, self.serial, PacketWriteEndInfo::EndPage, 0)?;
        self.packets.inner_mut().flush()
    }

    /// Takes interleaved samples; whole frames are encoded at once.
    pub fn push(&mut self, samples: &[i16]) -> io::Result<()> {
        self.pending.extend_from_slice(samples);
        let frame_len = self.frame_samples * self.channels;
        let mut offset = 0;
        while self.pending.len() - offset >= frame_len {
            let frame: Vec<i16> = self.pending[offset..offset + frame_len].to_vec();
            offset += frame_len;
            self.encode_frame(&frame, self.frame_samples, false)?;
        }
        self.pending.drain(..offset);
        Ok(())
    }

    /// `samples`: how many of the frame's samples per channel are real; the
    /// rest is padding the last granule trims.
    fn encode_frame(&mut self, frame: &[i16], samples: usize, is_last: bool) -> io::Result<()> {
        let size = self
            .encoder
            .encode(frame, &mut self.packet)
            .map_err(encoding_error)?;
        self.encoded_samples += samples as u64;
        self.frames_in_page += 1;
        let end = if is_last {
            PacketWriteEndInfo::EndStream
        } else if self.frames_in_page >= self.frames_per_page {
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        let granule = self.encoded_samples * self.granule_factor;
        self.packets
            .write_packet(self.packet[..size].to_vec(), self.serial, end, granule)?;
        if end != PacketWriteEndInfo::NormalPacket {
            self.frames_in_page = 0;
            self.packets.inner_mut().flush()?;
        }
        Ok(())
    }

    /// Encodes what is left, padded to a frame, and ends the stream.
    pub fn finish(mut self) -> io::Result<W> {
        let frame_len = self.frame_samples * self.channels;
        let mut frame = std::mem::take(&mut self.pending);
        let samples = frame.len() / self.channels;
        frame.resize(frame_len, 0);
        let pre_skip_samples = (self.pre_skip / self.granule_factor) as usize;
        let final_samples = samples + pre_skip_samples;
        let final_frame_samples = if final_samples > self.frame_samples {
            self.encode_frame(&frame, self.frame_samples, false)?;
            frame.fill(0);
            final_samples - self.frame_samples
        } else {
            final_samples
        };
        self.encode_frame(&frame, final_frame_samples, true)?;
        let mut writer = self.packets.into_inner();
        writer.flush()?;
        Ok(writer)
    }
}

/// A recording asked for, with how it is made, see
/// `models::user_config::DialogRecordingConfig`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordingRequest {
    pub target: NewRecording,
    /// Two channels go into the file as one, their sum.
    pub is_mixed_down: bool,
    /// The file gets what the speech recognition gets; otherwise the sound
    /// before the echo gate and the limiter, where the capture has it.
    pub is_processed: bool,
}

/// Two interleaved channels as one: their sum, which keeps each side as loud
/// as it was; the rare moment both speak loudly is clipped.
fn mix_down(interleaved: &[i16]) -> Vec<i16> {
    interleaved
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[left, right]| left.saturating_add(right))
        .collect()
}

/// A recording the capture loop feeds without waiting for the disk: the
/// encoder runs on a thread of its own. A failed write ends the recording
/// only; the capture goes on.
pub struct RecordingSink {
    /// The file name, the same in both places.
    name: String,
    /// Where the file is written.
    path: PathBuf,
    /// Where it goes once closed.
    destination: PathBuf,
    sender: Option<SyncSender<Vec<i16>>>,
    /// Interleaved samples that did not fit the queue, owed as silence.
    owed_samples: usize,
    max_owed_samples: usize,
    has_audio: bool,
    thread: Option<thread::JoinHandle<()>>,
    failure: Arc<Mutex<Option<String>>>,
    is_failed: Arc<AtomicBool>,
    is_failure_reported: bool,
    /// Stereo input written as mono.
    is_mixed_down: bool,
    is_processed: bool,
}

impl RecordingSink {
    /// `channels`: what the capture delivers; the file may have fewer, see
    /// `RecordingRequest::is_mixed_down`.
    pub fn start(
        request: RecordingRequest,
        sample_rate_hz: u32,
        channels: u16,
    ) -> Result<Self, AppError> {
        let RecordingRequest {
            target:
                NewRecording {
                    name,
                    active_path: path,
                    shared_path: destination,
                },
            is_mixed_down,
            is_processed,
        } = request;
        let is_mixed_down = is_mixed_down && channels == 2;
        let channels = if is_mixed_down { 1 } else { channels };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Failed(format!("Cannot create the recordings folder: {error}"))
            })?;
        }
        let file_path = path.clone();
        let mut writer = OggOpusWriter::create(&path, sample_rate_hz, channels)
            .map_err(|error| AppError::Failed(format!("Cannot create the recording: {error}")))?;
        let (sender, receiver) = mpsc::sync_channel::<Vec<i16>>(QUEUE_CHUNKS);
        let failure: Arc<Mutex<Option<String>>> = Arc::default();
        let is_failed = Arc::new(AtomicBool::new(false));
        let thread_failure = Arc::clone(&failure);
        let thread_is_failed = Arc::clone(&is_failed);
        let thread = thread::Builder::new()
            .name("tyco-call-recording".into())
            .spawn(move || {
                let fail = |error: io::Error| {
                    log::error!("The call recording failed: {error}");
                    *thread_failure.locked() = Some(error.to_string());
                    thread_is_failed.store(true, Ordering::SeqCst);
                };
                for samples in receiver.iter() {
                    if let Err(error) = writer.push(&samples) {
                        return fail(error);
                    }
                }
                if let Err(error) = writer.finish() {
                    fail(error);
                }
            })
            .map_err(|error| AppError::Failed(format!("Cannot start the recording: {error}")))?;
        log::info!("Recording the dialog to {}", path.display());
        recordings::begin_writing(&name);
        Ok(Self {
            name,
            path: file_path,
            destination,
            sender: Some(sender),
            owed_samples: 0,
            max_owed_samples: sample_rate_hz as usize * usize::from(channels) * MAX_GAP_SECONDS,
            has_audio: false,
            thread: Some(thread),
            failure,
            is_failed,
            is_failure_reported: false,
            is_mixed_down,
            is_processed,
        })
    }

    /// Whether the file takes the samples sent to the speech recognition
    /// rather than the unprocessed ones.
    pub fn is_processed(&self) -> bool {
        self.is_processed
    }

    /// Hands interleaved samples of the capture to the encoder; dropped once
    /// the recording failed.
    pub fn push(&mut self, samples: &[i16]) {
        if samples.is_empty() || self.is_failed.load(Ordering::SeqCst) {
            return;
        }
        let mixed;
        let samples = if self.is_mixed_down {
            mixed = mix_down(samples);
            mixed.as_slice()
        } else {
            samples
        };
        if self.owed_samples > 0 {
            if !self.send(vec![0; self.owed_samples]) {
                self.owe(samples.len());
                return;
            }
            log::info!("The call recording caught up with the disk");
            self.owed_samples = 0;
        }
        if !self.send(samples.to_vec()) {
            if self.owed_samples == 0 {
                log::warn!("The disk does not keep up with the call recording");
            }
            self.owe(samples.len());
        }
    }

    /// Whether the samples were queued; a full queue keeps them owed.
    fn send(&mut self, samples: Vec<i16>) -> bool {
        let Some(sender) = &self.sender else {
            return true;
        };
        match sender.try_send(samples) {
            Ok(()) => {
                self.has_audio = true;
                true
            }
            Err(TrySendError::Full(_)) => false,
            Err(TrySendError::Disconnected(_)) => {
                self.sender = None;
                true
            }
        }
    }

    /// A stall beyond the longest gap ends the recording as incomplete.
    fn owe(&mut self, samples: usize) {
        let total = self.owed_samples + samples;
        self.owed_samples = total.min(self.max_owed_samples);
        if total > self.max_owed_samples {
            let mut failure = self.failure.locked();
            failure.get_or_insert_with(|| "The recording queue stalled for too long".into());
            self.is_failed.store(true, Ordering::SeqCst);
        }
    }

    /// Why the recording stopped, once: the capture tells the webview.
    pub fn take_failure(&mut self) -> Option<String> {
        if self.is_failure_reported || !self.is_failed.load(Ordering::SeqCst) {
            return None;
        }
        self.is_failure_reported = true;
        Some(
            self.failure
                .locked()
                .clone()
                .unwrap_or_else(|| "The recording failed".into()),
        )
    }

    /// Encodes what is queued and closes the file. Why the recording
    /// stopped, when it failed after the last `take_failure`: the end of the
    /// file is missing.
    pub fn finish(mut self) -> Option<String> {
        self.close();
        self.take_failure()
    }

    /// A recording that got no audio, e.g. a dialog stopped while starting,
    /// or whose entry went meanwhile leaves no file; any other joins the
    /// history, also one that failed midway: it holds the beginning of the
    /// call.
    fn close(&mut self) {
        if let Some(sender) = self.sender.take() {
            if self.owed_samples > 0 {
                let _ = sender.send(vec![0; self.owed_samples]);
            }
        }
        if let Some(thread) = self.thread.take() {
            if thread.join().is_err() {
                let mut failure = self.failure.locked();
                failure.get_or_insert_with(|| "The recording writer stopped unexpectedly".into());
                self.is_failed.store(true, Ordering::SeqCst);
            }
            if let Err(error) = recordings::finish_writing(
                &self.name,
                &self.path,
                &self.destination,
                self.has_audio || self.owed_samples > 0,
            ) {
                log::warn!(
                    "Could not finalize the call recording {}: {error}",
                    self.name
                );
            }
        }
    }
}

impl Drop for RecordingSink {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn request(target: NewRecording) -> RecordingRequest {
        RecordingRequest {
            target,
            is_mixed_down: true,
            is_processed: true,
        }
    }

    #[test]
    fn two_channels_mix_down_to_their_sum() {
        assert_eq!(
            mix_down(&[100, 200, -30_000, -30_000, 32_000, 1_000]),
            vec![300, i16::MIN, i16::MAX]
        );
    }

    #[test]
    fn a_mixed_down_recording_has_one_channel() {
        let folder = temp_folder("mixed-down");
        let recording = target(&folder);
        let mut sink = RecordingSink::start(request(recording.clone()), 16_000, 2).unwrap();
        sink.push(&vec![100; 32_000]);
        assert!(sink.finish().is_none());
        let bytes = std::fs::read(&recording.shared_path).unwrap();
        assert_eq!(pages(&bytes)[0].body[9], 1);

        let recording = target(&folder.join("stereo"));
        let stereo = RecordingRequest {
            is_mixed_down: false,
            ..request(recording.clone())
        };
        let mut sink = RecordingSink::start(stereo, 16_000, 2).unwrap();
        sink.push(&vec![100; 32_000]);
        assert!(sink.finish().is_none());
        let bytes = std::fs::read(&recording.shared_path).unwrap();
        assert_eq!(pages(&bytes)[0].body[9], 2);
        let _ = std::fs::remove_dir_all(folder);
    }

    struct Page {
        header_type: u8,
        granule: u64,
        sequence: u32,
        body: Vec<u8>,
    }

    /// Splits a byte stream into pages without decoding the audio; stops at
    /// a page cut short.
    fn pages(bytes: &[u8]) -> Vec<Page> {
        let mut pages = Vec::new();
        let mut offset = 0;
        while offset + 27 <= bytes.len() {
            assert_eq!(&bytes[offset..offset + 4], b"OggS");
            let header_type = bytes[offset + 5];
            let granule = u64::from_le_bytes(bytes[offset + 6..offset + 14].try_into().unwrap());
            let sequence = u32::from_le_bytes(bytes[offset + 18..offset + 22].try_into().unwrap());
            let segments = usize::from(bytes[offset + 26]);
            let table_end = offset + 27 + segments;
            if table_end > bytes.len() {
                break;
            }
            let body_len: usize = bytes[offset + 27..table_end]
                .iter()
                .map(|&s| usize::from(s))
                .sum();
            if table_end + body_len > bytes.len() {
                break;
            }
            pages.push(Page {
                header_type,
                granule,
                sequence,
                body: bytes[table_end..table_end + body_len].to_vec(),
            });
            offset = table_end + body_len;
        }
        pages
    }

    fn record(channels: u16, seconds: f32) -> Vec<u8> {
        let mut writer = OggOpusWriter::new(Cursor::new(Vec::new()), 16_000, channels).unwrap();
        let total = (16_000.0 * seconds) as usize * usize::from(channels);
        let samples: Vec<i16> = (0..total)
            .map(|index| ((index as f32 * 0.05).sin() * 8_000.0) as i16)
            .collect();
        // in uneven chunks, as the capture delivers them
        for chunk in samples.chunks(1_234) {
            writer.push(chunk).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn the_headers_describe_the_stream() {
        let bytes = record(2, 0.5);
        let pages = pages(&bytes);
        let head = &pages[0].body;
        assert_eq!(&head[..8], b"OpusHead");
        assert_eq!(head[8], 1);
        assert_eq!(head[9], 2);
        assert_eq!(u32::from_le_bytes(head[12..16].try_into().unwrap()), 16_000);
        assert_eq!(pages[0].header_type & 0x02, 0x02, "begins the stream");
        assert_eq!(&pages[1].body[..8], b"OpusTags");
    }

    #[test]
    fn pages_follow_in_sequence_with_rising_granules() {
        let bytes = record(1, 3.3);
        let pages = pages(&bytes);
        for (index, page) in pages.iter().enumerate() {
            assert_eq!(page.sequence as usize, index);
        }
        let audio = &pages[2..];
        // a page a second at least
        assert!(audio.len() >= 4, "{} pages", audio.len());
        assert!(audio
            .windows(2)
            .all(|pair| pair[0].granule < pair[1].granule));
        let last = audio.last().unwrap();
        assert_eq!(last.header_type & 0x04, 0x04, "ends the stream");
        let head = &pages[0].body;
        let pre_skip = u64::from(u16::from_le_bytes(head[10..12].try_into().unwrap()));
        // trimmed to what was recorded, at 48 kHz
        assert_eq!(last.granule, pre_skip + (16_000.0 * 3.3) as u64 * 3);
    }

    #[test]
    fn the_final_packets_cover_the_input_and_encoder_delay() {
        let input_samples = 16_319;
        let mut writer = OggOpusWriter::new(Vec::new(), 16_000, 1).unwrap();
        writer.push(&vec![100; input_samples]).unwrap();
        let bytes = writer.finish().unwrap();
        let pages = pages(&bytes);
        assert_eq!(pages[2].granule, 48_000);
        let pre_skip = usize::from(u16::from_le_bytes(
            pages[0].body[10..12].try_into().unwrap(),
        ));
        let final_granule = pages.last().unwrap().granule as usize;
        assert_eq!(final_granule - pre_skip, input_samples * 3);

        let mut reader = ogg::PacketReader::new(Cursor::new(bytes));
        reader.read_packet_expected().unwrap();
        reader.read_packet_expected().unwrap();
        let mut decoder = opus::Decoder::new(48_000, opus::Channels::Mono).unwrap();
        let mut decoded = [0; 960];
        let mut decoded_samples = 0;
        while let Some(packet) = reader.read_packet().unwrap() {
            decoded_samples += decoder.decode(&packet.data, &mut decoded, false).unwrap();
        }
        assert!(decoded_samples >= final_granule);
        assert!(decoded_samples - final_granule < decoded.len());
    }

    #[test]
    fn a_truncated_file_keeps_its_whole_pages() {
        let bytes = record(2, 3.0);
        let whole = pages(&bytes).len();
        let cut = &bytes[..bytes.len() - 10];
        let kept = pages(cut);
        assert_eq!(kept.len(), whole - 1);
        assert!(kept.len() > 2);
    }

    #[test]
    fn three_channels_are_refused() {
        assert!(OggOpusWriter::new(Cursor::new(Vec::new()), 16_000, 3).is_err());
    }

    #[test]
    fn a_recording_sink_writes_a_file_and_never_overwrites() {
        let folder = std::env::temp_dir().join(format!(
            "tyco-recording-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let recording = target(&folder);
        let mut sink = RecordingSink::start(request(recording.clone()), 16_000, 1).unwrap();
        sink.push(&vec![100; 16_000]);
        assert!(sink.take_failure().is_none());
        assert!(sink.finish().is_none());
        assert!(!recording.active_path.exists());
        let bytes = std::fs::read(&recording.shared_path).unwrap();
        assert!(pages(&bytes).len() >= 3);
        std::fs::write(&recording.active_path, b"").unwrap();
        assert!(RecordingSink::start(request(recording), 16_000, 1).is_err());
        let _ = std::fs::remove_dir_all(folder);
    }

    /// A recording written in `folder/active` that goes to `folder/shared`.
    fn target(folder: &std::path::Path) -> NewRecording {
        // unique: the recordings being written are known by name process-wide
        let name = format!(
            "2026-11-21 10-00-00 {:06x}.opus",
            folder
                .to_string_lossy()
                .bytes()
                .fold(0u32, |hash, byte| hash
                    .wrapping_mul(31)
                    .wrapping_add(u32::from(byte)))
                & 0xff_ffff
        );
        NewRecording {
            active_path: folder.join("active").join(&name),
            shared_path: folder.join("shared").join(&name),
            name,
        }
    }

    fn temp_folder(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tyco-recording-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn a_recording_without_audio_leaves_no_file() {
        let folder = temp_folder("empty");
        let recording = target(&folder);
        let sink = RecordingSink::start(request(recording.clone()), 16_000, 1).unwrap();
        assert!(recording.active_path.exists());
        sink.finish();
        assert!(!recording.active_path.exists());
        assert!(!recording.shared_path.exists());
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_stalled_queue_owes_silence_instead_of_failing() {
        let folder = temp_folder("stall");
        let mut sink = RecordingSink::start(request(target(&folder)), 16_000, 1).unwrap();
        // the encoder is never this slow; a sender with no room stands for it
        let (sender, receiver) = mpsc::sync_channel::<Vec<i16>>(1);
        let real = sink.sender.replace(sender);
        sink.push(&[1; 100]);
        sink.push(&[2; 50]);
        sink.push(&[3; 30]);
        assert_eq!(sink.owed_samples, 80);
        assert!(sink.take_failure().is_none());
        assert_eq!(receiver.recv().unwrap(), vec![1; 100]);
        // the silence goes first, the queue fills again behind it
        sink.push(&[4; 10]);
        assert_eq!(receiver.recv().unwrap(), vec![0; 80]);
        assert_eq!(sink.owed_samples, 10);
        sink.sender = real;
        sink.finish();
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn stopping_writes_owed_silence_and_reports_an_overlong_stall() {
        let folder = temp_folder("stall-at-stop");
        let recording = target(&folder);
        let mut sink = RecordingSink::start(request(recording.clone()), 16_000, 1).unwrap();
        sink.push(&vec![100; 1_000]);
        sink.max_owed_samples = 600;
        sink.owe(700);
        assert!(sink.finish().is_some());

        let bytes = std::fs::read(recording.shared_path).unwrap();
        let pages = pages(&bytes);
        let pre_skip = u64::from(u16::from_le_bytes(
            pages[0].body[10..12].try_into().unwrap(),
        ));
        assert_eq!(pages.last().unwrap().granule - pre_skip, 1_600 * 3);
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_recording_whose_entry_went_is_removed_once_closed() {
        let folder = temp_folder("discarded");
        let recording = target(&folder);
        let mut sink = RecordingSink::start(request(recording.clone()), 16_000, 1).unwrap();
        sink.push(&vec![100; 16_000]);
        let dirs = recordings::RecordingDirs::in_folders(
            folder.join("shared"),
            &folder.join("unused-state"),
        );
        recordings::discard(&dirs, &recording.name).unwrap();
        assert!(recording.active_path.exists());
        assert!(sink.finish().is_none());
        assert!(!recording.active_path.exists());
        assert!(!recording.shared_path.exists());
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_failure_while_finishing_is_reported() {
        let folder = temp_folder("late-failure");
        let mut sink = RecordingSink::start(request(target(&folder)), 16_000, 1).unwrap();
        sink.push(&vec![100; 1_000]);
        // what the encoder thread records when its last write fails
        *sink.failure.locked() = Some("No space left on device".into());
        sink.is_failed.store(true, Ordering::SeqCst);
        assert_eq!(sink.finish().as_deref(), Some("No space left on device"));
        let _ = std::fs::remove_dir_all(folder);
    }
}
