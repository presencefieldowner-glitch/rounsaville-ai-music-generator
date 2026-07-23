# Rounsaville AI Music Generator

This repo is bootstrapped around a single ecosystem-wide orchestration script,
`build-all.sh`, which installs, builds, and tests every module in the
dependency-ordered layers below, and can export or archive the full tree.

## Module layout

| Layer | Path | Purpose |
| --- | --- | --- |
| Foundation | `001_FOUNDATION/` | Shared types, utilities, protocol specs |
| LLM Gateway | `002_LLM_GATEWAY/` | Prompt engine, model routing, guardrails for lyric/prompt-driven generation |
| Audio Engine | `003_AUDIO_ENGINE/` | Synthesis, rendering, and mixing; `PythonRunner/` holds Python-based audio DSP tests |
| Composition Agent | `004_COMPOSITION_AGENT/` | Session state, composition memory, track generation |
| Interface | `005_INTERFACE/` | WebSocket, REST API, and web UI gateways |

Each JS module is a standalone npm package (`package.json` + `index.js` +
`test/`) with a real, dependency-free implementation — no external npm
packages, so `npm install` never touches the network:

- **Foundation**: `Types` (Note/Track/Composition/Session factories +
  validators), `Utilities` (id generation, seeded PRNG, dB/MIDI math,
  retry/logging), `ProtocolSpecs` (the message envelope shared across
  layers).
- **LLM Gateway**: `PromptEngine` parses free text into a structured
  generation spec (genre/mood/tempo/key/bars); `Guardrails` sanitizes
  prompts and clamps the spec into safe ranges; `ModelRouter` dispatches to
  registered generator backends with priority + fallback.
- **Audio Engine**: `SynthEngine` is a real oscillator bank (sine/square/
  saw/triangle) with envelopes; `AudioRenderer` renders a `Composition`
  into PCM and encodes a playable 16-bit WAV; `MixMaster` mixes, normalizes,
  and soft-limits buffers. `PythonRunner/audio_metrics.py` independently
  verifies peak/RMS/clipping on real WAV bytes via the stdlib `wave` module.
- **Composition Agent**: `SessionManager` (in-memory session CRUD + TTL
  pruning), `CompositionMemory` (per-session event history), `TrackGenerator`
  (deterministic, seeded algorithmic composer producing melody/bass/drums
  over a major/minor scale).
- **Interface**: `WebSockets` is a hand-rolled RFC 6455 server (handshake,
  framing, masking) with no `ws` dependency; `REST_API` wires the whole
  pipeline together (`POST /api/sessions`, `POST /api/sessions/:id/generate`,
  `GET /api/sessions/:id`, `GET /api/health`) end-to-end from prompt text to
  a returned WAV; `WebUI` is a single static page that calls the REST API
  and plays the result.

Every module's `npm test` runs real assertions via Node's built-in
`node:test` runner (no jest/mocha needed); `PythonRunner` runs via
`unittest`.

## Usage

```bash
chmod +x build-all.sh

./build-all.sh              # install, build, test every module
./build-all.sh --verbose    # show full output per module
./build-all.sh --no-test    # build only
./build-all.sh --coverage   # generate coverage reports
./build-all.sh --clean      # wipe dist/ and node_modules/ first
./build-all.sh --download-all  # copy the entire tree into _exports/
./build-all.sh --archive    # create a full .tar.gz of the repo
```

The script continues past a failing module (collecting failures into a
summary) rather than aborting on the first error, so a single broken module
doesn't hide the status of the rest of the ecosystem.
