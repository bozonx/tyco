//! A lossless copy of what a capture sends, for debugging speech
//! recognition: with `TYCO_DUMP_STT_AUDIO=<folder>` set, every capture also
//! writes a WAV of the very PCM16 bytes it hands the webview.
//!
//! The header's sizes are patched after every write, so a crash leaves a
//! file that plays up to its last chunk. A failed write only ends the dump.
use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const ENV_VAR: &str = "TYCO_DUMP_STT_AUDIO";
const HEADER_BYTES: u32 = 44;
/// Tells apart the dumps of captures started within the same second.
static NEXT_DUMP: AtomicU64 = AtomicU64::new(1);

/// Writes interleaved PCM16 as a WAV file.
pub(crate) struct WavDump<W: Write + Seek> {
    writer: W,
    data_bytes: u32,
}

impl WavDump<BufWriter<File>> {
    /// A dump in the folder `TYCO_DUMP_STT_AUDIO` names, if it is set.
    pub(crate) fn from_env(sample_rate_hz: u32, channels: u16) -> Option<Self> {
        let folder = std::env::var_os(ENV_VAR).filter(|value| !value.is_empty())?;
        let path = dump_path(
            Path::new(&folder),
            NEXT_DUMP.fetch_add(1, Ordering::Relaxed),
        );
        let opened = std::fs::create_dir_all(&folder)
            .and_then(|()| File::create(&path))
            .and_then(|file| Self::new(BufWriter::new(file), sample_rate_hz, channels));
        match opened {
            Ok(dump) => {
                log::info!("Dumping the capture's audio to {}", path.display());
                Some(dump)
            }
            Err(error) => {
                log::warn!(
                    "Cannot dump the capture's audio to {}: {error}",
                    path.display()
                );
                None
            }
        }
    }
}

fn dump_path(folder: &Path, index: u64) -> PathBuf {
    let local_time = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    folder.join(format!("{local_time} capture-{index}.wav"))
}

impl<W: Write + Seek> WavDump<W> {
    pub(crate) fn new(mut writer: W, sample_rate_hz: u32, channels: u16) -> io::Result<Self> {
        let block_align = channels * 2;
        let mut header = Vec::with_capacity(HEADER_BYTES as usize);
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&(HEADER_BYTES - 8).to_le_bytes());
        header.extend_from_slice(b"WAVEfmt ");
        header.extend_from_slice(&16u32.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes());
        header.extend_from_slice(&channels.to_le_bytes());
        header.extend_from_slice(&sample_rate_hz.to_le_bytes());
        header.extend_from_slice(&(sample_rate_hz * u32::from(block_align)).to_le_bytes());
        header.extend_from_slice(&block_align.to_le_bytes());
        header.extend_from_slice(&16u16.to_le_bytes());
        header.extend_from_slice(b"data");
        header.extend_from_slice(&0u32.to_le_bytes());
        writer.write_all(&header)?;
        writer.flush()?;
        Ok(Self {
            writer,
            data_bytes: 0,
        })
    }

    /// Appends little-endian PCM16 bytes, as sent.
    pub(crate) fn push(&mut self, bytes: &[u8]) -> io::Result<()> {
        if bytes.is_empty() {
            return Ok(());
        }
        self.writer.write_all(bytes)?;
        self.data_bytes = self
            .data_bytes
            .saturating_add(u32::try_from(bytes.len()).unwrap_or(u32::MAX));
        self.patch_sizes()
    }

    fn patch_sizes(&mut self) -> io::Result<()> {
        let end = self.writer.stream_position()?;
        self.writer.seek(SeekFrom::Start(4))?;
        self.writer.write_all(
            &(HEADER_BYTES - 8)
                .saturating_add(self.data_bytes)
                .to_le_bytes(),
        )?;
        self.writer.seek(SeekFrom::Start(40))?;
        self.writer.write_all(&self.data_bytes.to_le_bytes())?;
        self.writer.seek(SeekFrom::Start(end))?;
        self.writer.flush()
    }

    #[cfg(test)]
    fn into_inner(self) -> W {
        self.writer
    }
}

/// A dump that stops at its first failed write.
pub(crate) struct CaptureDump(Option<WavDump<BufWriter<File>>>);

impl CaptureDump {
    pub(crate) fn from_env(sample_rate_hz: u32, channels: u16) -> Self {
        Self(WavDump::from_env(sample_rate_hz, channels))
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) {
        let Some(dump) = self.0.as_mut() else {
            return;
        };
        if let Err(error) = dump.push(bytes) {
            log::warn!("The audio dump stopped: {error}");
            self.0 = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn the_file_holds_the_bytes_sent_with_matching_sizes() {
        let mut dump = WavDump::new(Cursor::new(Vec::new()), 16_000, 2).unwrap();
        dump.push(&[1, 0, 2, 0]).unwrap();
        dump.push(&[3, 0, 4, 0]).unwrap();
        let bytes = dump.into_inner().into_inner();
        assert_eq!(bytes.len(), 44 + 8);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 2);
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(
            u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
            64_000
        );
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 8);
        assert_eq!(&bytes[44..], &[1, 0, 2, 0, 3, 0, 4, 0]);
    }

    #[test]
    fn without_the_variable_nothing_is_dumped() {
        if std::env::var_os(ENV_VAR).is_none() {
            assert!(WavDump::from_env(16_000, 1).is_none());
        }
    }
}
