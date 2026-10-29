# Roamies

Little creatures that live on your desktop. The main one, **Sidekick**, is a pixel-LED blob with an
AI brain: it talks through animated speech bubbles, acts out tool calls (screenshots, reading files,
running commands, web search), listens when you hold **Control+Option**, keeps track of what you said
you'd do, and nudges you when it's due. It lives in the menu bar; it only shows a Dock icon while the
setup guide is open.

## What's here

| Path | What |
|---|---|
| `showcase/index.html` | All 10 roamie designs (jelly, ASCII goop, mercury, nebula, fluff, dither and more) |
| `showcase/dither.html` | The pixel-dither family the Sidekick is built from |
| `showcase/sidekick.html` | The Sidekick with a scripted demo of talking, thinking and tools |
| `showcase/roamies/` | The shared JS: physics, rendering, expressions, bubbles, tool animations, sounds |
| `showcase/tauri/` | The desktop app (Tauri 2): overlay shell, voice helper, agent sidecar |
| `showcase/desktop/` | An older native Swift overlay shell (macOS only) |
| `Sources/`, `build.sh` | The very first Swift prototype |

The HTML pages open straight in a browser, with no build step.

## Desktop app

- **Brain:** a [gg-framework](https://github.com/KenKaiii/gg-framework) `Agent` in a Node sidecar. It
  signs in through the same `~/.gg/auth.json` as GG Coder (OAuth for Anthropic, OpenAI, Gemini, Kimi
  and xAI, or API keys), so if GG Coder is signed in, so is Sidekick.
- **Voice (macOS):** a small Swift helper using Apple's on-device speech recognition. Hold ⌃⌥ to talk
  and let go to send, or tap ⌃⌥ for hands-free. ⌃⌥S shows or hides Sidekick.
- **Sessions:** a conversation resumes across restarts and starts fresh after two quiet hours or on a
  new day. Sessions are saved in `~/.gg/sidekick/sessions/` (newest 60 kept, screenshots never
  saved). Commitments live in `~/.gg/sidekick/memory.json`.
- **Setup guide:** opens on first launch and walks through permissions (microphone, screen recording,
  files), connecting an AI account, shortcuts (both can be changed) and where to find the menu bar
  icon. Reopen it any time from the menu bar icon → Setup Guide….
- **Safety:** writing files and running commands are off until you turn them on in setup or the menu bar.

### Build

Requirements: Rust, Node 22+, and on macOS the Xcode Command Line Tools (for the Swift voice helper).

```sh
cd showcase/tauri/sidecar && npm ci && cd ..
./build.sh            # release bundle for this OS
./build.sh dev        # debug build only
```

`sidecar/bundle.sh` needs `esbuild` on your `PATH`, or set `ESBUILD=/path/to/esbuild`.

On macOS, `build.sh` signs with `APPLE_SIGNING_IDENTITY` if set, otherwise the first "Developer ID
Application" certificate in your keychain, otherwise ad-hoc. Signing with a stable identity keeps macOS
permissions (microphone, screen recording, accessibility) across rebuilds; ad-hoc builds re-ask each time.
Voice works best on macOS 26+, which doesn't need Siri or Dictation turned on. Windows and Linux
builds compile, but voice is macOS only for now.

## License

[AGPL-3.0](LICENSE). You can use, change and share Roamies, but if you distribute it or run a
modified version as a network service, you have to release your source under the same license.
