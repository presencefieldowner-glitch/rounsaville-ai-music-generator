# 003_AUDIO_ENGINE

The layer that turns musical intent into audible sound. Everything here is
implemented and tested — no stubs.

| Module | Role |
| --- | --- |
| `SynthEngine/` | Signal generation: oscillators, pitch/MIDI conversion, ADSR envelopes, note and sequence rendering |
| `MixMaster/` | Combining and levelling: mixing, normalization, gain, constant-power panning, stereo interleaving, arrangement |
| `AudioRenderer/` | File encoding: RIFF/WAVE encode and decode, read and write |
| `PythonRunner/` | The same synthesis in Python, plus a CLI — see its own README |

## The pipeline

The three JS modules are deliberately decoupled: each passes plain
`Float32Array` buffers, so any stage can be used alone or replaced without
touching the others.

```js
const synth = require('../SynthEngine');
const mix = require('../MixMaster');
const render = require('../AudioRenderer');

const voices = ['C4', 'E4', 'G4'].map((pitch) =>
  synth.renderNote({
    frequency: synth.noteToFreq(pitch),
    duration: 2,
    waveform: 'triangle',
    envelope: synth.DEFAULT_ADSR,
  })
);

const chord = mix.mix(voices);                    // sum, normalized away from clipping
const { left, right } = mix.pan(chord, -0.3);     // constant-power, slightly left
render.writeWav('chord.wav', mix.interleave(left, right), { channels: 2 });
```

`AudioRenderer` handles 16-bit integer PCM (standard delivery, what players and
sound cards expect) and 32-bit IEEE float (lossless, for handing audio between
stages without accumulating quantization error). Decoding walks the RIFF chunk
list rather than assuming a 44-byte header, since real files carry `LIST` and
`fact` chunks that a fixed offset would misread as audio.

## Two implementations, one result

`SynthEngine` and `PythonRunner/synth.py` are independent implementations that
agree on sample rate, tuning, and envelope shape. Rendering A440 for one second
through both, with matching parameters, gives a maximum per-sample difference of
3.05e-5 — one 16-bit quantization step, the smallest difference representable in
the output format. Use whichever fits the caller; the audio is the same.

## Tests

```bash
npm test          # in any of the three JS module directories (node --test)
cd PythonRunner && python3 -m unittest discover tests
```

63 JS tests and 30 Python tests. They assert measurable signal properties rather
than smoke-testing imports: frequencies verified by zero-crossing count, panning
verified to hold constant power across the field, WAV headers checked field by
field against the payload they describe, and out-of-range samples required to
clamp rather than wrap polarity.

`build-all.sh` runs all of it — the JS suites through each module's `npm test`,
the Python suite through its `PYTHON AUDIO DSP TEST SUITE` stage.
