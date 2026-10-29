<pre align="center">
   ▄████████  ▄██████▄     ▄████████    ▄▄▄▄███▄▄▄▄    ▄█     ▄████████    ▄████████
  ███    ███ ███    ███   ███    ███  ▄██▀▀▀███▀▀▀██▄ ███    ███    ███   ███    ███
  ███    ███ ███    ███   ███    ███  ███   ███   ███ ███▌   ███    █▀    ███    █▀
 ▄███▄▄▄▄██▀ ███    ███   ███    ███  ███   ███   ███ ███▌  ▄███▄▄▄       ███
▀▀███▀▀▀▀▀   ███    ███ ▀███████████  ███   ███   ███ ███▌ ▀▀███▀▀▀     ▀███████████
▀███████████ ███    ███   ███    ███  ███   ███   ███ ███    ███    █▄           ███
  ███    ███ ███    ███   ███    ███  ███   ███   ███ ███    ███    ███    ▄█    ███
  ███    ███  ▀██████▀    ███    █▀    ▀█   ███   █▀  █▀     ██████████  ▄████████▀
  ███    ███
</pre>

<p align="center">
  <strong>A little buddy that lives on your screen and keeps you on track.</strong>
</p>

<p align="center">
  <a href="https://github.com/KenKaiii/Roamies/releases/latest"><img src="https://img.shields.io/github/v/release/KenKaiii/Roamies?style=for-the-badge&label=Download&color=78ffe2" alt="Roamies desktop release"></a>
  <a href="https://github.com/KenKaiii/Roamies/stargazers"><img src="https://img.shields.io/github/stars/KenKaiii/Roamies?style=for-the-badge&label=Stars&color=yellow" alt="Star Roamies on GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="AGPL-3.0 License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-78ffe2?style=for-the-badge" alt="Skool"></a>
</p>

Roamies are little creatures that live on your desktop. The main one, **Sidekick**, is a pixel-LED blob
with an AI brain. Talk to it, and it answers in animated speech bubbles, acts out what it's doing, keeps
track of what you said you'd do, and nudges you when it's due. It lives in the menu bar and stays out of
your Dock.

## What you get

- **Talk to it:** hold ⌃⌥ to talk and let go to send, or tap ⌃⌥ for hands-free. ⌃⌥S shows or hides
  Sidekick, and ⌃⌥A lets you snap an area of the screen and ask about it. Both shortcuts can be changed.
- **It remembers:** commitments with reminders down to the second, facts about you, and conversations
  that pick up where you left off. A conversation starts fresh after two quiet hours or on a new day.
- **It sees and points:** it can screenshot a specific window, read what's in it, and point at the exact
  spot on screen you need to click.
- **It works your apps:** it can open apps, sites and files, and click or type in other apps for you.
- **It shows its work:** every tool call plays its own animation, so you can see when it's taking a
  screenshot, reading a file, running a command or searching the web.
- **Your AI, your way:** it signs in through the same `~/.gg/auth.json` as GG Coder (Anthropic, OpenAI,
  Gemini, Kimi and xAI subscriptions, or API keys), so if GG Coder is signed in, so is Sidekick.
- **Safe by default:** writing files, running commands and controlling other apps are off until you turn
  them on in setup or the menu bar ("Allow File Edits & Commands").
- **Setup guide:** opens on first launch and walks through permissions (microphone, screen recording,
  accessibility, files), connecting an AI account, shortcuts and where to find the menu bar icon. Reopen
  it any time from the menu bar icon → Setup Guide….

Voice works best on macOS 26+, which doesn't need Siri or Dictation turned on. Voice, window reading,
pointing and app control are macOS only for now.

## Get started

1. Install Roamies:

   **macOS (Apple silicon or Intel):** [Download the latest release](https://github.com/KenKaiii/Roamies/releases/latest) and open the `.dmg` for your Mac (`aarch64` for Apple silicon, `x64` for Intel).

   **Windows:** [Download the latest release](https://github.com/KenKaiii/Roamies/releases/latest) and run the `.exe` installer. It isn't code-signed yet, so Windows shows a SmartScreen warning the first time.

   **Development:** With Rust, Node.js 22+, the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and, on macOS, the Xcode Command Line Tools installed:

   ```bash
   git clone https://github.com/KenKaiii/Roamies.git
   cd Roamies/showcase/tauri
   (cd sidecar && npm ci && npm test)
   ./build.sh dev        # debug build
   ./build.sh            # release bundle for this OS
   ```

2. Open the app, follow the setup guide, and hold ⌃⌥ to say hi.

## Built on gg-framework

Sidekick's brain is a [gg-framework](https://github.com/KenKaiii/gg-framework) agent running in a Node
sidecar. Want to build your own?

- [**@kenkaiiii/gg-ai**](https://github.com/KenKaiii/gg-framework/blob/main/packages/gg-ai/README.md): Connect to AI providers and stream responses.
- [**@kenkaiiii/gg-agent**](https://github.com/KenKaiii/gg-framework/blob/main/packages/gg-agent/README.md): Build agents that use your tools and work through tasks.
- [**@kenkaiiii/gg-core**](https://github.com/KenKaiii/gg-framework/blob/main/packages/gg-core/README.md): Model selection, authentication, and local model discovery.

```bash
npm install @kenkaiiii/gg-ai @kenkaiiii/gg-agent
```

## What's in this repo

| Path | What |
|---|---|
| `showcase/tauri/` | The desktop app (Tauri 2): overlay shell, voice and hands helpers, agent sidecar |
| `showcase/roamies/` | The shared JS: physics, rendering, expressions, bubbles, tool animations, sounds |
| `showcase/onboarding/` | The setup guide |

### Signing and releases

On macOS, `build.sh` signs with `APPLE_SIGNING_IDENTITY` if set, otherwise the first "Developer ID
Application" certificate in your keychain, otherwise ad-hoc. Signing with a stable identity keeps macOS
permissions (microphone, screen recording, accessibility) across rebuilds; ad-hoc builds re-ask each time.

Push a version tag (`git tag v0.1.0 && git push origin v0.1.0`) or run the **Release** workflow from the
Actions tab. It builds a signed and notarized macOS DMG for Apple silicon and Intel, plus a Windows
installer, and attaches them to a draft release for you to publish. The signing credentials are GitHub
Actions secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID`), never files in the repo.

## License

[AGPL-3.0](LICENSE). You can use, change and share Roamies, but if you distribute it or run a modified
version as a network service, you have to release your source under the same license.

## Learn with me

Come build with me in my [Skool community](https://skool.com/kenkai). Get help, share what you're making, and learn how to get more out of AI.
