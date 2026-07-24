'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePrompt, validateSpec, validateVoiceProfile } = require('../index.js');

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

test('validateSpec leaves instrumental unset when not a boolean', () => {
  const spec = validateSpec({ tempo: 100, bars: 8 });
  assert.equal(spec.instrumental, undefined);
});

test('validateSpec passes a real boolean instrumental flag through', () => {
  assert.equal(validateSpec({ instrumental: true }).instrumental, true);
  assert.equal(validateSpec({ instrumental: false }).instrumental, false);
});

test('validateVoiceProfile returns undefined when no profile is given', () => {
  assert.equal(validateVoiceProfile(undefined), undefined);
  assert.equal(validateVoiceProfile(null), undefined);
});

test('validateVoiceProfile clamps pitches into the plausible vocal range', () => {
  const profile = validateVoiceProfile({ minPitchHz: 1, maxPitchHz: 5000, averagePitchHz: 200 });
  assert.equal(profile.minPitchHz, 50);
  assert.equal(profile.maxPitchHz, 1000);
});

test('validateVoiceProfile swaps min/max if they arrive reversed', () => {
  const profile = validateVoiceProfile({ minPitchHz: 300, maxPitchHz: 150 });
  assert.equal(profile.minPitchHz, 150);
  assert.equal(profile.maxPitchHz, 300);
});

test('validateVoiceProfile rejects non-numeric pitches', () => {
  assert.throws(() => validateVoiceProfile({ minPitchHz: 'low', maxPitchHz: 200 }));
});

test('validateSpec sanitizes a voiceProfile nested in the spec', () => {
  const spec = validateSpec({ voiceProfile: { minPitchHz: 1, maxPitchHz: 5000 } });
  assert.equal(spec.voiceProfile.minPitchHz, 50);
  assert.equal(spec.voiceProfile.maxPitchHz, 1000);
});
