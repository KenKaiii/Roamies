// System audio (Record): what the PC plays, such as the other people in a Discord call, captured through
// WASAPI loopback (audio.rs open_loopback, or apploop.rs for chosen apps only) and cut into chunks of about 30 seconds. Each chunk is written as a 16 kHz mono
// 16-bit WAV file in the folder the app gave ({"cmd":"call","on":true,"dir":…}) and announced as
// {"type":"call_chunk","path":…,"at":<unix ms>,"secs":…}. The app (not this helper) sends the file to the speech-to-text
// service and deletes it afterwards. Off unless the user turned it on; never touches the microphone path or the talk
// session: no level events, no takes, no wake word. Chunks that are only silence are not written.

use crate::audio::{MicError, Sink, Source};
use crate::{Ev, RATE};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Length of a full chunk.
pub const CHUNK_SECS: usize = 30;
/// A last chunk shorter than this (when listening stops) is dropped: too short to say anything.
const MIN_SECS: f32 = 2.0;
/// About -54 dBFS over the whole chunk: quieter than this is silence or hiss, not a call.
const SILENT_RMS: f32 = 0.002;

/// One finished file.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub path: PathBuf,
    /// Unix milliseconds when the chunk's first sound arrived.
    pub at: u64,
    pub secs: f32,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The file name of a chunk: `call-<unix ms>.wav` (the app only accepts names of this form).
pub fn chunk_name(at: u64) -> String {
    format!("call-{at}.wav")
}

pub fn is_silent(samples: &[f32]) -> bool {
    if samples.is_empty() {
        return true;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt() < SILENT_RMS
}

/// Writes 16 kHz mono 16-bit PCM.
pub fn write_wav(path: &Path, samples: &[f32]) -> Result<(), String> {
    let spec = hound::WavSpec { channels: 1, sample_rate: RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for s in samples {
        w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

/// Cuts a 16 kHz stream into chunks of a fixed length.
pub struct Chunker {
    per: usize,
    samples: Vec<f32>,
    began: u64,
}

impl Chunker {
    pub fn new(secs: usize) -> Self {
        Chunker { per: RATE as usize * secs, samples: Vec::new(), began: 0 }
    }

    /// Adds sound; returns the chunks that are full now, each with the time it began.
    pub fn push(&mut self, new: &[f32], now: u64) -> Vec<(u64, Vec<f32>)> {
        let mut out = Vec::new();
        let mut rest = new;
        while !rest.is_empty() {
            if self.samples.is_empty() {
                // The sound that just arrived began a moment ago.
                self.began = now.saturating_sub(rest.len().min(self.per) as u64 * 1000 / RATE as u64);
            }
            let room = self.per - self.samples.len();
            let take = room.min(rest.len());
            self.samples.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.samples.len() >= self.per {
                out.push((self.began, std::mem::take(&mut self.samples)));
            }
        }
        out
    }

    /// What is left when listening stops (None if it's too short to matter).
    pub fn flush(&mut self) -> Option<(u64, Vec<f32>)> {
        let samples = std::mem::take(&mut self.samples);
        if (samples.len() as f32 / RATE as f32) < MIN_SECS {
            return None;
        }
        Some((self.began, samples))
    }

    pub fn reset(&mut self) {
        self.samples.clear();
    }
}

/// The capture, while it's on.
pub struct Call {
    buf: Arc<Mutex<Vec<f32>>>,
    source: Option<Source>,
    chunker: Chunker,
    tx: Sender<Ev>,
    dir: Option<PathBuf>,
    /// The processes heard; empty means everything the PC plays.
    apps: Vec<u32>,
}

impl Call {
    pub fn new(tx: Sender<Ev>) -> Self {
        Call { buf: Arc::new(Mutex::new(Vec::new())), source: None, chunker: Chunker::new(CHUNK_SECS), tx, dir: None, apps: Vec::new() }
    }

    pub fn is_on(&self) -> bool {
        self.source.is_some()
    }

    /// The processes heard right now (empty: everything).
    pub fn apps(&self) -> &[u32] {
        &self.apps
    }

    /// Starts listening; chunks go into `dir`. `apps` picks the processes to hear (None keeps the last choice).
    pub fn start(&mut self, dir: Option<PathBuf>, apps: Option<Vec<u32>>) -> Result<(), MicError> {
        if self.source.is_some() {
            return Ok(());
        }
        if let Some(d) = dir {
            self.dir = Some(d);
        }
        if let Some(a) = apps {
            self.apps = a;
        }
        let dir = self.dir.clone().ok_or_else(|| MicError::new("failed", "no folder for call audio"))?;
        std::fs::create_dir_all(&dir).map_err(|e| MicError::new("failed", &format!("can't make the call audio folder: {e}")))?;
        self.buf.lock().unwrap().clear();
        self.chunker.reset();
        let sink = Sink::call(self.buf.clone(), self.tx.clone());
        self.source = Some(if self.apps.is_empty() { crate::audio::open_loopback(sink)? } else { open_apps(&self.apps, sink)? });
        Ok(())
    }

    /// Stops listening. What was heard since the last full chunk is written too (when it's long enough to say something).
    pub fn stop(&mut self) -> Vec<Chunk> {
        if self.source.take().is_none() {
            return Vec::new();
        }
        let new = std::mem::take(&mut *self.buf.lock().unwrap());
        let mut done: Vec<(u64, Vec<f32>)> = self.chunker.push(&new, now_ms());
        done.extend(self.chunker.flush());
        self.chunker.reset();
        self.save(done)
    }

    /// Called often: writes the chunks that filled up. While `paused` (Roamies is speaking, and must not hear itself)
    /// the sound is thrown away.
    pub fn poll(&mut self, paused: bool) -> Vec<Chunk> {
        if self.source.is_none() {
            return Vec::new();
        }
        let new = std::mem::take(&mut *self.buf.lock().unwrap());
        if paused {
            return Vec::new();
        }
        let done = self.chunker.push(&new, now_ms());
        self.save(done)
    }

    fn save(&self, done: Vec<(u64, Vec<f32>)>) -> Vec<Chunk> {
        let Some(dir) = &self.dir else { return Vec::new() };
        let mut out = Vec::new();
        for (at, samples) in done {
            if is_silent(&samples) {
                continue;
            }
            let path = dir.join(chunk_name(at));
            match write_wav(&path, &samples) {
                Ok(()) => out.push(Chunk { path, at, secs: samples.len() as f32 / RATE as f32 }),
                Err(e) => crate::log(&format!("call audio: couldn't save a chunk: {e}")),
            }
        }
        out
    }
}

#[cfg(windows)]
fn open_apps(pids: &[u32], sink: Sink) -> Result<Source, MicError> {
    crate::apploop::open_app_loopback(pids, sink)
}

#[cfg(not(windows))]
fn open_apps(_pids: &[u32], _sink: Sink) -> Result<Source, MicError> {
    Err(MicError::new("failed", "hearing chosen apps is only available on Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32) -> Vec<f32> {
        (0..(RATE as f32 * secs) as usize).map(|i| (i as f32 * 0.2).sin() * 0.2).collect()
    }

    #[test]
    fn cuts_a_stream_into_thirty_second_chunks() {
        let mut c = Chunker::new(CHUNK_SECS);
        let mut got = Vec::new();
        // In odd-sized pieces, as the audio thread delivers them.
        for piece in tone(75.0).chunks(4410) {
            got.extend(c.push(piece, 1_000_000));
        }
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|(_, s)| s.len() == RATE as usize * 30));
        let rest = c.flush().expect("15 seconds is kept");
        assert_eq!(rest.1.len(), RATE as usize * 15);
        assert!(c.flush().is_none(), "nothing left twice");
    }

    #[test]
    fn a_tiny_tail_is_dropped_and_silence_is_detected() {
        let mut c = Chunker::new(CHUNK_SECS);
        c.push(&tone(1.0), 5);
        assert!(c.flush().is_none());
        assert!(is_silent(&vec![0.0; 16000]));
        assert!(is_silent(&[]));
        assert!(!is_silent(&tone(1.0)));
    }

    #[test]
    fn a_chunk_starts_when_its_first_sound_came() {
        let mut c = Chunker::new(CHUNK_SECS);
        let got = c.push(&tone(30.0), 100_000);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, 70_000, "30 s of sound that ended at 100 s began at 70 s");
        assert_eq!(chunk_name(got[0].0), "call-70000.wav");
    }

    #[test]
    fn the_wav_is_16khz_mono_16_bit() {
        let path = std::env::temp_dir().join(format!("roamies-call-test-{}.wav", std::process::id()));
        write_wav(&path, &tone(1.0)).unwrap();
        let r = hound::WavReader::open(&path).unwrap();
        let s = r.spec();
        assert_eq!((s.channels, s.sample_rate, s.bits_per_sample), (1, 16_000, 16));
        assert_eq!(r.len(), 16_000);
        let _ = std::fs::remove_file(&path);
    }
}
