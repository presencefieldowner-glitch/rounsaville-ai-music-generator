'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrompt, buildSystemPrompt } = require('../index.js');

test('parsePrompt extracts genre, mood, tempo, bars, key', () => {
  const spec = parsePrompt('An energetic edm track in A minor at 128 bpm, 16 bars');
  assert.equal(spec.genre, 'edm');
  assert.equal(spec.mood, 'energetic');
  assert.equal(spec.tempo, 128);
  assert.equal(spec.bars, 16);
  assert.equal(spec.key, 'A');
  assert.equal(spec.mode, 'minor');
});

test('parsePrompt falls back to sensible defaults', () => {
  const spec = parsePrompt('something with no obvious keywords');
  assert.equal(spec.genre, 'ambient');
  assert.equal(spec.mood, 'neutral');
  assert.equal(spec.tempo, 100);
  assert.equal(spec.bars, 8);
});

test('parsePrompt rejects empty input', () => {
  assert.throws(() => parsePrompt(''));
});

test('buildSystemPrompt renders a readable instruction', () => {
  const spec = parsePrompt('calm lofi at 70 bpm');
  const prompt = buildSystemPrompt(spec);
  assert.match(prompt, /lofi/);
  assert.match(prompt, /70 BPM/);
});
