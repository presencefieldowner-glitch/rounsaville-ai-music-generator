'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultModelRouter, runGeneration, analyzeVoiceSamples, MAX_VOICE_SAMPLES } = require('../index.js');
const { encodeWav } = require('../../../003_AUDIO_ENGINE/AudioRenderer');

function sineWavBase64(frequency, seconds, sampleRate) {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = 0.6 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return encodeWav(samples, sampleRate, 1).toString('base64');
}

test('runGeneration produces a real stereo WAV and always reports a seed', async () => {
  const result = await runGeneration({ prompt: 'a lofi track in C major at 80 bpm, 4 bars' }, defaultModelRouter());
  assert.ok(Number.isFinite(result.seed));
  assert.equal(result.wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(result.wav.readUInt16LE(22), 2); // stereo
  assert.ok(result.composition.tracks.length > 0);
});

test('runGeneration with the same seed reproduces the exact same composition', async () => {
  const router = defaultModelRouter();
  const a = await runGeneration({ prompt: 'an ambient track in D minor at 90 bpm, 4 bars', seed: 42 }, router);
  const b = await runGeneration({ prompt: 'an ambient track in D minor at 90 bpm, 4 bars', seed: 42 }, router);
  assert.equal(a.seed, 42);
  assert.deepEqual(a.composition, b.composition);
});

test('runGeneration respects an instrumental flag detected only from prompt text', async () => {
  const result = await runGeneration({ prompt: 'an instrumental jazz track' }, defaultModelRouter());
  assert.equal(result.composition.tracks.find((t) => t.name === 'vocal'), undefined);
});

test('analyzeVoiceSamples returns a profile for a valid sample', () => {
  const profile = analyzeVoiceSamples([sineWavBase64(200, 0.5, 22050)]);
  assert.ok(Math.abs(profile.averagePitchHz - 200) / 200 < 0.15);
});

test('analyzeVoiceSamples rejects an empty or missing sample list', () => {
  assert.throws(() => analyzeVoiceSamples([]), /at least one/i);
  assert.throws(() => analyzeVoiceSamples(undefined), /at least one/i);
});

test('analyzeVoiceSamples rejects too many samples', () => {
  const sample = sineWavBase64(200, 0.05, 8000);
  const samples = new Array(MAX_VOICE_SAMPLES + 1).fill(sample);
  assert.throws(() => analyzeVoiceSamples(samples), /too many/i);
});

test('analyzeVoiceSamples rejects an oversized sample', () => {
  assert.throws(() => analyzeVoiceSamples(['A'.repeat(9_000_000)]), /exceeds the maximum/i);
});
