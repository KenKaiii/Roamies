# ElevenLabs voice, OpenCode and Antigravity providers

Status: proposed, 2026-11-21.

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

**3. Antigravity becomes a model provider** (separate PR; see the gate below).

Antigravity has no public model API. The supported path is the official `agy` CLI, which the user already has
signed in. The provider is therefore a thin bridge, not a key card:

- `showcase/tauri/sidecar/antigravity.mjs`:
  - detect `agy`, report connected when `agy models` returns the account's list, and expose those models.
  - one chat turn spawns `agy -p --input-format stream-json --output-format stream-json --agent roamies-relay
    --model <slug>` in a private temp workspace.
  - the relay agent is a generated `.agents/agents/roamies-relay/agent.md` with `excludeDefaultComponents: true`
    and Roamies' tools as an MCP server (the same in-process server `claudecode.mjs` already uses). Built-in
    file/command tools stay off; if agy calls anything outside the inventory, the turn fails.
  - NDJSON events map to the same `gg-agent` events `claudecode.mjs` emits.
- `route.mjs` / `sidekick.mjs`: a new route (`antigravity`) beside `claude-code`; no `gg-core` change.
- Panel: an "Antigravity" card with Connect/Disconnect (runs the signed-in check), its model list, and a note
  that tools run through Roamies.
- Tests: a fake `agy` binary that streams canned NDJSON (`test/fake-agy.mjs`); no quota is spent. A live check
  is opt-in behind `ROAMIES_AGY_LIVE=1`.

## Why

The user wants one voice vendor (ElevenLabs), and wants the Antigravity subscription usable as a brain next
to OpenCode. OpenCode already works; Antigravity does not exist in Roamies today.

## What could go wrong

- **ElevenLabs PCM format.** `pcm_24000` is listed for all tiers, but if a plan rejects it, fall back to
  `mp3_44100_128` plus an MP3 decoder. Check with a real key before merging.
- **Antigravity is a subscription CLI, not an API.** Automating it may be subject to Google's terms, the CLI's
  stream format can change, images are not supported, and one tool call per turn makes tool loops slower.
  This is why it is a separate PR with a spike and a fake-CLI test suite.
- **Secrets.** Neither provider may put a key in config or logs. ElevenLabs uses the existing secret store;
  Antigravity never reads agy's token files.
- **Scope creep.** No ElevenLabs speech-to-text, no OpenCode CLI route, no voice cloning UI, no Antigravity
  images.

## Verification

- `cd showcase/tauri/sidecar && npm test` (new tests included).
- Live ElevenLabs check with a real key (user supplies it in the panel): one spoken reply, bad-key path, model
  switch.
- Panel screenshots: Speaking page with the ElevenLabs card, Model page with OpenCode and Antigravity.
- Antigravity: fake-CLI tests, then one opt-in real turn (`ROAMIES_AGY_LIVE=1`) before merge.

## Order

1. ElevenLabs + README (ship together).
2. Antigravity spike: confirm `agy` custom-agent relay and stream-json events against the installed `agy`.
3. Antigravity bridge, panel and tests (separate PR).
