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

Each JS/TS module is a standalone npm package (`package.json` + `index.js`)
that currently ships as a stub — replace the stub logic as real
implementations land. `npm run build` / `npm test` in each stub just prints a
confirmation so `build-all.sh` has something real to orchestrate end-to-end.

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
