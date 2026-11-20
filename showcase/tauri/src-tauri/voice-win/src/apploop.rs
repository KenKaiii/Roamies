// Sound from chosen apps only ("Record" with "Only the apps I pick"): one WASAPI process-loopback capture per app,
// mixed into one 16 kHz mono stream for the call chunker. Windows asks the audio engine to convert each app's sound
// to 16 kHz mono, so no resampling happens here. Needs Windows 10 build 20348 or later; on older builds opening fails
// and the app says so.
//
// The mixer is plain Rust so its tests run on any OS.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::VecDeque;

/// Never keep more than this many samples waiting per app (2 s): an app whose capture runs ahead is trimmed.
const MAX_BACKLOG: usize = crate::RATE as usize * 2;

/// One queue of samples per app, drained in step by the mixing thread.
#[derive(Default)]
pub struct Mixer {
    lanes: Vec<VecDeque<f32>>,
}

impl Mixer {
    pub fn new(lanes: usize) -> Self {
        Mixer { lanes: (0..lanes).map(|_| VecDeque::new()).collect() }
    }

    /// Sound captured from app `lane`.
    pub fn push(&mut self, lane: usize, samples: &[f32]) {
        let Some(q) = self.lanes.get_mut(lane) else { return };
        q.extend(samples.iter().copied());
        let over = q.len().saturating_sub(MAX_BACKLOG);
        q.drain(..over);
    }

    /// The next `n` samples of the mix. An app with nothing waiting (it is quiet) adds silence.
    pub fn take(&mut self, n: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; n];
        for q in &mut self.lanes {
            for (o, s) in out.iter_mut().zip(q.drain(..n.min(q.len()))) {
                *o += s;
            }
        }
        for o in &mut out {
            *o = o.clamp(-1.0, 1.0);
        }
        out
    }
}

#[cfg(windows)]
pub use capture::open_app_loopback;

#[cfg(windows)]
mod capture {
    use super::Mixer;
    use crate::audio::{MicError, Sink, Source};
    use crate::RATE;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

    /// How often the mix is handed to the chunker.
    const STEP: Duration = Duration::from_millis(50);

    /// Starts capturing the sound of each process tree in `pids`. Fails only when none of them could be opened.
    pub fn open_app_loopback(pids: &[u32], mut sink: Sink) -> Result<Source, MicError> {
        if pids.is_empty() {
            return Err(MicError::new("failed", "no apps chosen"));
        }
        let stop = Arc::new(AtomicBool::new(false));
        let mixer = Arc::new(Mutex::new(Mixer::new(pids.len())));
        let mut opened = 0;
        let mut last_error = String::new();
        for (lane, &pid) in pids.iter().enumerate() {
            let (ready_tx, ready_rx) = std::sync::mpsc::channel();
            let (stop2, mixer2) = (stop.clone(), mixer.clone());
            thread::spawn(move || capture_app(pid, lane, &mixer2, &stop2, &ready_tx));
            match ready_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(())) => opened += 1,
                Ok(Err(e)) => last_error = format!("app {pid}: {e}"),
                Err(_) => last_error = format!("app {pid}: no answer from the audio service"),
            }
        }
        if opened == 0 {
            stop.store(true, Ordering::Relaxed);
            return Err(MicError::new("failed", &format!("couldn't hear the chosen apps ({last_error})")));
        }
        sink.start(RATE, 1);
        let stop2 = stop.clone();
        thread::spawn(move || {
            let begun = Instant::now();
            let mut sent: u64 = 0;
            while !stop2.load(Ordering::Relaxed) {
                thread::sleep(STEP);
                // Hand over exactly as much as real time allows, so the chunks keep their length.
                let due = (begun.elapsed().as_secs_f64() * RATE as f64) as u64;
                let n = (due - sent) as usize;
                sent = due;
                let mix = mixer.lock().unwrap().take(n);
                sink.feed(&mix);
            }
        });
        Ok(Source::detached(stop))
    }

    fn capture_app(pid: u32, lane: usize, mixer: &Mutex<Mixer>, stop: &AtomicBool, ready: &std::sync::mpsc::Sender<Result<(), String>>) {
        let started = (|| -> Result<_, Box<dyn std::error::Error>> {
            let _ = wasapi::initialize_mta();
            let format = WaveFormat::new(32, 32, SampleType::Float, RATE as usize, 1, None);
            let mut client = AudioClient::new_application_loopback_client(pid, true)?;
            let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
            client.initialize_client(&format, Direction::Capture, mode, None)?;
            let event = client.set_get_eventhandle()?;
            let capture = client.get_audiocaptureclient()?;
            client.start_stream()?;
            Ok((client, event, capture))
        })();
        let (client, event, capture) = match started {
            Ok(parts) => {
                let _ = ready.send(Ok(()));
                parts
            }
            Err(e) => {
                let _ = ready.send(Err(e.to_string()));
                return;
            }
        };
        let mut bytes: VecDeque<u8> = VecDeque::new();
        let mut samples: Vec<f32> = Vec::new();
        while !stop.load(Ordering::Relaxed) {
            // Windows doesn't always signal process-loopback captures, so a short wait is followed by a read either way.
            let _ = event.wait_for_event(20);
            // One wake-up can carry several packets.
            loop {
                match capture.get_next_packet_size() {
                    Ok(Some(n)) if n > 0 => {}
                    Ok(_) => break,
                    Err(_) => {
                        crate::log(&format!("app audio: lost app {pid}"));
                        return;
                    }
                }
                if capture.read_from_device_to_deque(&mut bytes).is_err() {
                    crate::log(&format!("app audio: lost app {pid}"));
                    return;
                }
            }
            let whole = bytes.len() / 4 * 4;
            samples.clear();
            samples.extend(bytes.drain(..whole).collect::<Vec<u8>>().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
            mixer.lock().unwrap().push(lane, &samples);
        }
        let _ = client.stop_stream();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_apps_are_added_together() {
        let mut m = Mixer::new(2);
        m.push(0, &[0.25, 0.25, 0.25]);
        m.push(1, &[0.5, -0.25]);
        assert_eq!(m.take(3), vec![0.75, 0.0, 0.25], "a quiet app adds silence");
        assert_eq!(m.take(2), vec![0.0, 0.0], "nothing left");
    }

    #[test]
    fn loud_mixes_are_clipped_and_backlogs_trimmed() {
        let mut m = Mixer::new(2);
        m.push(0, &[0.9]);
        m.push(1, &[0.9]);
        assert_eq!(m.take(1), vec![1.0]);
        m.push(0, &vec![0.1; MAX_BACKLOG + 500]);
        assert_eq!(m.take(MAX_BACKLOG + 500).iter().filter(|s| **s != 0.0).count(), MAX_BACKLOG);
        m.push(7, &[1.0]); // no such app: ignored
    }
}
