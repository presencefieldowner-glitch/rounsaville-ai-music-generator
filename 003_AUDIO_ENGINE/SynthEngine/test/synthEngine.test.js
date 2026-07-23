'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { synthesizeNote, WAVEFORMS } = require('../index.js');

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

test('all four waveforms are defined and bounded', () => {
  for (const name of Object.keys(WAVEFORMS)) {
    const fn = WAVEFORMS[name];
    for (let p = 0; p < 1; p += 0.1) {
      const v = fn(p);
      assert.ok(v >= -1.0001 && v <= 1.0001, `${name}(${p}) out of range: ${v}`);
    }
  }
});
