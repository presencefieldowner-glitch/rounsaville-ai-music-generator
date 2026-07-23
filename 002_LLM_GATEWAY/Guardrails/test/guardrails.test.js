'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePrompt, validateSpec } = require('../index.js');

test('sanitizePrompt trims and length-caps input', () => {
  const result = sanitizePrompt('  hello world  ');
  assert.equal(result, 'hello world');
});

test('sanitizePrompt rejects banned content', () => {
  assert.throws(() => sanitizePrompt('please use this copyrighted sample'));
});

test('validateSpec clamps tempo and bars into range', () => {
  const spec = validateSpec({ tempo: 999, bars: -5, key: 'C', mode: 'major' });
  assert.equal(spec.tempo, 220);
  assert.equal(spec.bars, 1);
});

test('validateSpec falls back to safe key/mode when invalid', () => {
  const spec = validateSpec({ tempo: 100, bars: 8, key: 'H', mode: 'phrygian' });
  assert.equal(spec.key, 'C');
  assert.equal(spec.mode, 'major');
});
