# ElevenLabs voice, OpenCode and Antigravity providers

Status: implemented on `feat/elevenlabs-voice`, open for review in PR #162.

## What changes

**1. ElevenLabs joins spoken replies** (alongside Fish Audio, Gemini and VoiceStudio).

- New `showcase/tauri/sidecar/elevenlabs.mjs`, shaped like `gemini.mjs`:
  - one streaming request per sentence to `POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000`,
    header `xi-api-key`, raw 16-bit mono PCM at 24 kHz (the speaker already plays PCM).
  - `elevenAccount(key)` calls `GET /v1/user/subscription`: 401/403 = bad key, otherwise read the character
    allowance for the panel note.
  - models: `eleven_v3` (expressive) and `eleven_flash_v2_5` (fast, cheaper), tried in that order.
  - a stock voice per look, plus a voice picker; custom/cloned voices are a later change.
- `speaker.mjs`: register the provider (`PROVIDERS.elevenlabs`), no new player code.
- `sidekick.mjs`: `TTS.elevenlabs` (secret `elevenlabs-tts`), config keys `elevenVoices` and `elevenModel`,
  key load/save/remove, `ob_elevenkey` and `panel_elevenlabs_key` messages, panel state fields.
- `showcase/panel/panel.js`: add it to `TTS_NAMES`, the provider picker and the key form; voice and model pickers.
- `showcase/onboarding/onboarding.js`: fourth voice choice, key field and link to the ElevenLabs key page.
- Tests: new `test/elevenlabs.test.mjs` (request shape, PCM chunking, bad key, sentence ordering) and a
  speaker test that switches to it; `test/run.mjs` entry.
- Docs: README (feature line and support matrix), PRIVACY (text goes to ElevenLabs), THIRD_PARTY_NOTICES
  if the API terms need a line.

**2. OpenCode is already a model provider.** `gg-core` ships `opencode` and `opencode-go`; the panel already
shows both key cards and `catalogs.mjs` refreshes their model lists. No code change. The only gap is that the
README never mentions it. This change adds it to the README provider line.

**3. Antigravity joins as a local model server** (same PR as ElevenLabs now; no PR opened without approval).

Antigravity has no public model API. The supported path is the official `agy` CLI, which the user already has
signed in. Roamies starts a small OpenAI-compatible server in the sidecar, adds it to the local servers list, and
`agy` runs one turn per chat request:

- `showcase/tauri/sidecar/antigravity.mjs` (the server; no separate MCP process).
- Each turn gets a private workspace with a relay agent (`excludeDefaultComponents: true`, `mainAgent: true`,
  `tools: [view_file]`), agy's own file/command/browser tools off, and a tool catalog rendered from the OpenAI
  request. Permissions allow `read_file(<workspace>)` only, and deny write/command/web tools.
- agy's custom-agent allowlist cannot include its MCP dispatcher (and no MCP tool is visible when it is set), so
  the relay asks for Roamies tools in text with a fixed marker (`<<<ROAMIES_TOOL {...}>>>`). The streamer holds the
  marker back, and a complete call becomes an OpenAI `tool_calls` response for Roamies to execute.
- Screenshots and user images are written into that workspace and named in the prompt; the model opens them with
  `read_file`. The image path is verified: a real `agy` turn read a staged 7319 image correctly, including a
  screenshot arriving as a tool result.
- Roamies executes the tool (safety included) and sends the next request, which flattens the history. Tool results
  that carried pictures are staged the same way, so the next turn can see them.
- `local.mjs` lists the running server under Local models; the existing local-server path probes, registers and
  connects it, so its Gemini and Claude models appear with the others and screenshots work. (GPT-OSS is text-only,
  so it isn't offered.) It starts disconnected, like Ollama.
- Tests: `test/antigravity.test.mjs` drives a fake `agy` (text, tool calls, image staging, built-in refusal,
  out-of-workspace read) with no quota; `test/local.test.mjs` covers the extra server row.

## Why

The user wants one voice vendor (ElevenLabs), and wants the Antigravity subscription usable as a brain next
to OpenCode. OpenCode already works; Antigravity moves in as a local server so it can take images through the
same screenshots Roamies already takes.

## What could go wrong

- **ElevenLabs PCM format.** `pcm_24000` is listed for all tiers, but if a plan rejects it, fall back to
  `mp3_44100_128` plus an MP3 decoder. Check with a real key before merging.
- **Antigravity is a subscription CLI, not an API.** Automating it may be subject to Google's terms, the CLI's
  stream format can change, and `agy` starts a fresh turn per request (about 5 s before it reads the prompt).
  Images work only through the staged workspace and `read_file`, not as native prompt blocks.
- **Secrets.** Neither provider may put a key in config or logs. ElevenLabs uses the existing secret store;
  Antigravity never reads agy's token files.
- **Scope creep.** No ElevenLabs speech-to-text, no OpenCode CLI route, no voice cloning UI.

## Verification

- `cd showcase/tauri/sidecar && npm test` (new tests included).
- Live ElevenLabs check with a real key (user supplies it in the panel): one spoken reply, bad-key path, model
  switch.
- Live Antigravity check through the proxy: a plain answer, a staged screenshot read (7319), a tool call, and a
  tool result carrying a screenshot (all four ran against the installed `agy` while building this).
- Panel screenshots: Speaking page with the ElevenLabs card, Model page with OpenCode and Antigravity.

## Order

1. ElevenLabs + README (done).
2. Antigravity proxy, local-server wiring and tests (done).
3. Review, then one PR after the user approves it.
