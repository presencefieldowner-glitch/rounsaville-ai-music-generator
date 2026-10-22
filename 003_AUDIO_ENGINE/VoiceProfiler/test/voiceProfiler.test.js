'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  downsample,
  estimateFramePitch,
  spectralCentroid,
  analyzeVoiceSample,
  buildVoiceProfile,
} = require('../index.js');

function sineWave(frequency, seconds, sampleRate, amplitude = 0.5) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

test('downsample halves the sample count when target is half the rate', () => {
  const samples = sineWave(220, 0.1, 8000);
  const { samples: ds, sampleRate } = downsample(samples, 8000, 4000);
  assert.equal(sampleRate, 4000);
  assert.ok(Math.abs(ds.length - samples.length / 2) <= 1);
});

test('downsample is a no-op when target rate is >= source rate', () => {
  const samples = sineWave(220, 0.05, 8000);
  const { samples: ds, sampleRate } = downsample(samples, 8000, 16000);
  assert.equal(sampleRate, 8000); // can't upsample; original rate is kept
  assert.equal(ds, samples);
});

test('estimateFramePitch recovers a known sine frequency within a few percent', () => {
  const sampleRate = 16000;
  const frame = sineWave(150, 0.04, sampleRate, 0.6);
  const pitch = estimateFramePitch(frame, sampleRate, { minHz: 70, maxHz: 400 });
  assert.ok(pitch !== null);
  assert.ok(Math.abs(pitch - 150) / 150 < 0.05, `expected ~150Hz, got ${pitch}`);
});

test('estimateFramePitch returns null for near-silence', () => {
  const frame = new Float32Array(640); // 40ms at 16kHz, all zeros
  assert.equal(estimateFramePitch(frame, 16000), null);
});

test('spectralCentroid ranks a high-frequency tone as brighter than a low one', () => {
  const sampleRate = 16000;
  const dark = sineWave(120, 512 / sampleRate, sampleRate, 0.8).subarray(0, 512);
  const bright = sineWave(3000, 512 / sampleRate, sampleRate, 0.8).subarray(0, 512);
  assert.ok(spectralCentroid(bright, sampleRate) > spectralCentroid(dark, sampleRate));
});

test('analyzeVoiceSample extracts a pitch range around a known frequency', () => {
  const sampleRate = 22050;
  const samples = sineWave(180, 1.0, sampleRate, 0.5);
  const analysis = analyzeVoiceSample(samples, sampleRate);
  assert.ok(analysis.voicedFrameRatio > 0.8);
  assert.ok(Math.abs(analysis.averagePitchHz - 180) / 180 < 0.1);
  assert.ok(analysis.minPitchHz <= analysis.averagePitchHz);
  assert.ok(analysis.maxPitchHz >= analysis.averagePitchHz);
});

test('analyzeVoiceSample reports zero voiced ratio for silence', () => {
  const analysis = analyzeVoiceSample(new Float32Array(22050), 22050);
  assert.equal(analysis.voicedFrameRatio, 0);
  assert.equal(analysis.averagePitchHz, null);
});

test('buildVoiceProfile aggregates multiple analyses into one range', () => {
  const sampleRate = 16000;
  const low = analyzeVoiceSample(sineWave(120, 0.5, sampleRate, 0.5), sampleRate);
  const high = analyzeVoiceSample(sineWave(260, 0.5, sampleRate, 0.5), sampleRate);
  const profile = buildVoiceProfile([low, high]);
  assert.equal(profile.sampleCount, 2);
  assert.ok(profile.minPitchHz < 150);
  assert.ok(profile.maxPitchHz > 230);
});

test('buildVoiceProfile throws when nothing voiced was detected', () => {
  const silent = analyzeVoiceSample(new Float32Array(8000), 16000);
  assert.throws(() => buildVoiceProfile([silent]));
});
