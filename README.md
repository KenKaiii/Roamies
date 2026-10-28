# Roamies

Little creatures that live on your desktop. The main one, **Sidekick**, is a pixel-LED blob with an
AI brain: it talks through animated speech bubbles, acts out tool calls (screenshots, reading files,
running commands, web search), listens when you hold **Control+Option**, keeps track of what you said
you'd do, and nudges you when it's due. It lives in the menu bar only, with no Dock icon and no windows.

## What's here

| Path | What |
|---|---|
| `showcase/roamies/` | The shared JS: physics, rendering, expressions, bubbles, tool animations, sounds |
| `showcase/tauri/` | The desktop app (Tauri 2): overlay shell, voice helper, agent sidecar |

## Desktop app

- **Brain:** a [gg-framework](https://github.com/KenKaiii/gg-framework) `Agent` in a Node sidecar. It
  signs in through the same `~/.gg/auth.json` as GG Coder (OAuth for Anthropic, OpenAI, Gemini, Kimi
  and xAI, or API keys), so if GG Coder is signed in, so is Sidekick.
- **Voice (macOS):** a small Swift helper using Apple's on-device speech recognition. Hold ⌃⌥ to talk
  and let go to send, or tap ⌃⌥ for hands-free. ⌃⌥S shows or hides Sidekick.
- **Sessions:** a conversation resumes across restarts and starts fresh after two quiet hours or on a
  new day. Sessions are saved in `~/.gg/sidekick/sessions/` (newest 60 kept, screenshots never
  saved). Commitments live in `~/.gg/sidekick/memory.json`.
- **Safety:** writing files and running commands are off until you turn them on in the menu bar.

### Build

Requirements: Rust, Node 22+, and on macOS the Xcode Command Line Tools (for the Swift voice helper).

```sh
cd showcase/tauri/sidecar && npm ci && cd ..
./build.sh            # release bundle for this OS
./build.sh dev        # debug build only
```

`sidecar/bundle.sh` needs `esbuild` on your `PATH`, or set `ESBUILD=/path/to/esbuild`.

On macOS the app is ad-hoc signed, so macOS may ask for microphone access again after each rebuild.
Voice works best on macOS 26+, which doesn't need Siri or Dictation turned on. Windows and Linux
builds compile, but voice is macOS only for now.
