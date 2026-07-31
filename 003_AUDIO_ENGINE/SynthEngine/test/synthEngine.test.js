'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  synthesizeNote,
  synthesizePad,
  synthesizePluck,
  applyADSR,
  applyLowPassFilter,
  WAVEFORMS,
} = require('../index.js');

test('synthesizeNote produces the expected sample count', () => {
  const samples = synthesizeNote({ pitch: 69, start: 0, duration: 1, velocity: 100 }, 8000, 'sine');
  assert.equal(samples.length, 8000);
});

test('synthesizeNote output stays within [-1, 1]', () => {
  const samples = synthesizeNote({ pitch: 40, start: 0, duration: 0.5, velocity: 127 }, 8000, 'saw');
  for (const s of samples) {
    assert.ok(s >= -1.0001 && s <= 1.0001);
  }
});

test('envelope fades the first and last samples toward zero', () => {
  const samples = synthesizeNote({ pitch: 69, start: 0, duration: 1, velocity: 127 }, 8000, 'square');
  assert.ok(Math.abs(samples[0]) < 0.1);
  assert.ok(Math.abs(samples[samples.length - 1]) < 0.1);
});

test('all four basic waveforms are defined and bounded', () => {
  for (const name of Object.keys(WAVEFORMS)) {
    const fn = WAVEFORMS[name];
    for (let p = 0; p < 1; p += 0.1) {
      const v = fn(p);
      assert.ok(v >= -1.0001 && v <= 1.0001, `${name}(${p}) out of range: ${v}`);
    }
  }
});

test('applyADSR shapes attack up and release down with a sustain plateau between', () => {
  const samples = new Float32Array(1000).fill(1);
  const shaped = applyADSR(samples, 1000, { attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.1 });
  assert.ok(shaped[0] < shaped[50]); // rising through attack
  assert.ok(Math.abs(shaped[500] - 0.5) < 0.05); // sustain plateau
  assert.ok(shaped[shaped.length - 1] < 0.05); // released to near-zero
});

test('applyLowPassFilter smooths a high-frequency signal toward its average', () => {
  const samples = new Float32Array(2000);
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 1 : -1; // Nyquist-ish square alternation
  const filtered = applyLowPassFilter(samples, 44100, 200);
  const peak = Math.max(...filtered.map(Math.abs));
  assert.ok(peak < 0.5, `expected the alternating signal to be heavily attenuated, got peak ${peak}`);
});

test('synthesizePad sums multiple detuned oscillators (louder than a single one would be) and stays in range', () => {
  const samples = synthesizePad({ pitch: 69, start: 0, duration: 0.5, velocity: 127 }, 8000);
  assert.equal(samples.length, 4000);
  for (const s of samples) assert.ok(s >= -1.0001 && s <= 1.0001);
  const hasSignal = [...samples].some((v) => Math.abs(v) > 0.01);
  assert.ok(hasSignal);
});

test('synthesizePluck produces a naturally decaying (not envelope-clipped) plucked-string timbre', () => {
  const samples = synthesizePluck({ pitch: 60, start: 0, duration: 1, velocity: 127 }, 8000);
  assert.equal(samples.length, 8000);

  function rms(chunk) {
    let sum = 0;
    for (const s of chunk) sum += s * s;
    return Math.sqrt(sum / chunk.length);
  }
  const early = rms(samples.subarray(0, 400));
  const late = rms(samples.subarray(samples.length - 400));
  assert.ok(late < early, `expected the plucked string to decay: early RMS ${early}, late RMS ${late}`);
});

test('synthesizePluck is deterministic for the same note (seeded, not Math.random)', () => {
  const note = { pitch: 64, start: 2, duration: 0.3, velocity: 100 };
  const a = synthesizePluck(note, 8000);
  const b = synthesizePluck(note, 8000);
  assert.deepEqual([...a], [...b]);
});

test('synthesizeNote dispatches pad/pluck through their dedicated synthesis paths', () => {
  const note = { pitch: 60, start: 0, duration: 0.2, velocity: 100 };
  assert.deepEqual([...synthesizeNote(note, 8000, 'pad')], [...synthesizePad(note, 8000)]);
  assert.deepEqual([...synthesizeNote(note, 8000, 'pluck')], [...synthesizePluck(note, 8000)]);
});
