# Clanky: project plan and context

Clanky is Prathyumna S's personal JARVIS-style desktop assistant. It is a fork of
[KenKaiii/Roamies](https://github.com/KenKaiii/Roamies) (AGPL-3.0). The repo is at `github.com/Prathu3110/Clanky`.

## Working rules (read first)

- **Commits are mine.** Author: `Prathyumna S <170416389+Prathu3110@users.noreply.github.com>`. Never add a
  `Co-Authored-By` or any AI attribution line to commits or PRs.
- **I'm learning this codebase, not vibe-coding it.** Explain each change before making it, keep diffs small,
  and build each piece so it can be run and tested on its own. I write the core logic (Laya routing,
  lesson loop); AI help is for boilerplate and explanations.
- Work on branches (`ui-restyle`, `laya-router`, …) and merge through PRs into my fork.
- Follow the upstream `AGENTS.md` rules: tests for every safety rule change, CI stays green, no secrets in commits.
- Keep `upstream` (KenKaiii/Roamies) mergeable: prefer adding new files and small hooks over rewriting his files.
- AGPL-3.0: the fork stays AGPL, and the README must say this is a modified fork.

## Machine and budget

- MacBook Air M3, 16 GB RAM, fanless. About 11 GB is normally in use, so **anything Clanky runs locally
  (Laya, Omnigraph, helpers) must fit in roughly 2 to 3 GB of RAM**.
- The model is my existing Claude subscription, through Roamies' "Sign in with Claude" (Claude Code).
  Its usage is shared with my Claude app and Claude Code, so **keeping token use low is a goal in itself**.

## Target architecture

| Part | Status | What it does |
|---|---|---|
| App shell + UI | Kept, UI redesigned | Tauri (Rust) window, overlay, keys and mic. The UI is plain web (HTML/CSS/JS) in `showcase/roamies/`. |
| **Laya gate** | **New (Rust)** | Runs before Claude on every request. It *routes* the job kind and model, *picks* UI elements from the accessibility list when confident, and *trims* which tools and memories are sent. Simple jobs never reach Claude. |
| Agent sidecar | Kept | Node agent in `showcase/tauri/sidecar/`. It runs the loop, tools, model choice, memory, speech and background learning. |
| **Omnigraph** | **New** | Graph memory ([ModernRelay/omnigraph](https://github.com/ModernRelay/omnigraph), MIT, Rust). It stores profile, preferences and **lessons** linked to task, app and person. Claude Code and the Claude desktop app share it through MCP. |
| Hands | Kept | Swift accessibility helper (`src-tauri/hands/main.swift`). Its `walk()` returns the filtered list of on-screen controls. |
| Safety rules | Kept | `sidecar/safety.mjs` and `HANDS_OFF`: safe, ask or block. |
| Output | Kept | Voice plus on-screen ink. |
| **Trace log** | **New** | Records what worked and what failed. Confirmed lessons go to the graph (fast learning). Traces become data for fine-tuning Laya (slow learning). |

Why Node stays: the slow part is waiting on Claude, not the language. The agent also depends on the Claude Agent
SDK and Claude Code, which are TypeScript and Python only. New, per-request code (the Laya gate) is written in Rust
(`ort` or `candle`).

## Key files to read first

1. `showcase/tauri/sidecar/sidekick.mjs`: the agent loop. It talks to the shell over stdio JSON lines.
2. `sidecar/tools.mjs`: every tool the model can use (`act_in_app`, `read_window`, `draw`, `remember_commitment`…).
3. `sidecar/brain.mjs`: background memory and skill passes. **The lesson loop hooks in here.**
4. `sidecar/route.mjs`: regex job router. **The Laya router replaces or augments this.**
5. `sidecar/store.mjs`: memory and sessions in `~/Roamies/Data/`. **Omnigraph plugs in here.**
6. `src-tauri/hands/main.swift`: `walk()`, `findText()`, and the `ui` and `act` commands.
7. `showcase/roamies/`: the UI (character, overlay, ask bar, panel).

## Build order

1. **Setup.** Build from source with `cd showcase/tauri && (cd sidecar && npm ci && npm test) && ./build.sh dev`.
   Add a "modified fork" note to the README.
2. **`ui-restyle`.** Design mockups first, then restyle `showcase/roamies/` (my own character design, not
   Marvel's JARVIS). Use plain JS and canvas for the overlay, and a framework only for the panel if needed.
3. **Measure.** Use it for a few days and read `~/Roamies/Data/usage.jsonl` to see where tokens actually go.
4. **`laya-router`.** Put Laya in front of `jobKinds()` in `route.mjs`. Compare it against the regex router on a fixed
   test set of my real requests (accuracy and latency).
5. **`omnigraph-memory`.** Run Omnigraph locally with a small schema and no embeddings at first (graph and BM25 only).
   Connect Claude Code through MCP first, then the sidecar.
6. **`lesson-loop`.** Make `brain.mjs` write lessons to the graph, linked to task, app and person. Retrieve the top five
   before acting.
7. **`laya-picker`.** Laya chooses `act_in_app` targets from the `ui` element list, and falls back to Claude plus a
   screenshot when unsure. This is the riskiest assumption, so test it early on WhatsApp Desktop.

## Starter graph schema (draft)

Nodes: `Person`, `Project`, `Task`, `App`, `Preference`, `Lesson`, `Attempt`.
Edges: `knows`, `works_on`, `depends_on`, `attempt_of` (Attempt to Task), `in_app`, `failed_because`,
`corrected_by`, `lesson_from` (Lesson to Attempt), `applies_to` (Lesson or Preference to Task, App or Person).

Rules:
- Store short lessons, not transcripts.
- Write lessons only from my corrections or verified outcomes, **never from content the assistant merely read**
  (this guards against prompt injection).
- New lessons go on a `proposed` branch and are merged once confirmed.
- Lessons can be replaced or expire.
- At most five lessons per request.

## Open questions

- Laya's RAM footprint and the backbone it is built on. This decides whether it shares a model with anything else.
- Embeddings for Omnigraph's search by meaning: a small local embedding model, or skip it.
