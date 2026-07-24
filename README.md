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
- **Audio Engine**: `SynthEngine` has four phase-based oscillators
  (sine/square/saw/triangle) with a real ADSR envelope, plus two
  genuinely different synthesis techniques for richer timbre: `pad`
  (three detuned saw oscillators summed and low-passed) and `pluck`
  (Karplus-Strong physical modeling — a damped noise burst circulating
  through a delay line, which is where the natural plucked-string decay
  comes from, not a sample or a synthetic fade). `AudioRenderer` renders
  a `Composition` into PCM, encodes a playable 16-bit WAV, and decodes
  one back (used to read uploaded voice recordings); `MixMaster` mixes,
  normalizes, and soft-limits buffers. `VoiceProfiler` does real (if
  basic) voice analysis — autocorrelation pitch detection and a
  spectral-centroid "brightness" estimate — to measure a speaker's
  actual pitch range. **This is not neural voice cloning**: no ML
  model, no timbre transfer, just a real pitch-range measurement used
  to keep a synthesized vocal line within that range.
  `PythonRunner/audio_metrics.py` independently verifies peak/RMS/
  clipping on real WAV bytes via the stdlib `wave` module.
- **Composition Agent**: `SessionManager` (in-memory session CRUD + TTL
  pruning), `CompositionMemory` (per-session event history),
  `TrackGenerator` — a deterministic, seeded algorithmic composer, not a
  trained model. It builds a genre-specific chord progression (e.g. jazz
  gets ii-V-I, EDM gets vi-IV-I-V) and locks the bassline to each bar's
  chord root; the melody leans onto a chord tone on the strong beat of
  each bar (real harmonic awareness, not an independent random walk) and
  picks its timbre by genre (`pluck` for lofi/jazz/classical, `pad` for
  ambient/cinematic, `saw` for edm/trap, `square` for rock); a
  `dynamicsCurve` fades the arrangement in over the first ~15% of bars
  and out over the last ~15% instead of constant volume throughout. An
  optional vocal line is added, shaped to a voice profile, when
  `instrumental: false`. `GenerationPipeline` is the shared orchestration
  glue (prompt -> spec -> composition -> render -> reverb -> master ->
  WAV, plus voice-sample validation/analysis) that both `REST_API` and
  the Netlify functions call — extracted specifically so the two
  interfaces can't drift out of sync the way they briefly did (the
  Netlify functions kept rendering mono with no reverb/seed support
  after `REST_API` grew those features locally).
- **Interface**: `WebSockets` is a hand-rolled RFC 6455 server (handshake,
  framing, masking) with no `ws` dependency. `REST_API` exposes both a
  session-based API (`POST /api/sessions`, `POST /api/sessions/:id/generate`,
  `GET /api/sessions/:id`) and a stateless one (`POST /api/generate`,
  `POST /api/voice-profile`, `GET /api/health`) — the stateless routes are
  what the WebUI and the Netlify deployment use, since serverless
  invocations don't reliably share in-memory session state. Every
  generation carries a seed (caller-supplied or fresh), always reported
  back, so "regenerate the exact same track" is real and exact — verified
  by asserting byte-identical compositions across two requests with the
  same seed. The compute-heavy routes are rate-limited with a real
  token-bucket (`429` + `Retry-After`; only meaningful for this
  persistent process, not the stateless Netlify functions), and
  `/api/voice-profile` caps sample count/size separately from the
  smaller default body limit, since a voice recording is legitimately
  much bigger than a prompt.

  `WebUI` is a single-page studio (style/BPM/bars/instrumental controls,
  seed display + "regenerate with same seed", a download-as-file link,
  thumbs up/down rating, and a voice-recording flow) generated by
  `scripts/build-static-site.js` into `public/index.html` for the
  Netlify deploy, so there's one source of truth instead of two
  hand-maintained copies. Track history stores the generation *recipe*
  (prompt/instrumental/voiceProfile/seed) rather than the rendered
  audio and re-fetches on playback — storing full stereo WAVs in
  `localStorage` blew the browser's storage quota after a couple of
  tracks (found by actually driving this in a real headless-Chromium
  session, not just asserting on the HTML string).

  For local dev, `WebUI` and `REST_API` are two separate `http.Server`
  instances; `startWebUI(port, { apiProxyTarget })` forwards `/api/*` to
  a real `REST_API` instance so the page's relative fetches work without
  a CORS/hosting setup, mirroring what `netlify.toml`'s redirect does in
  production:
  ```js
  const { startServer } = require('./005_INTERFACE/REST_API');
  const { startWebUI } = require('./005_INTERFACE/WebUI');
  const { server: api } = await startServer(4000);
  await startWebUI(3000, { apiProxyTarget: 'http://127.0.0.1:4000' });
  // open http://127.0.0.1:3000/
  ```

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
