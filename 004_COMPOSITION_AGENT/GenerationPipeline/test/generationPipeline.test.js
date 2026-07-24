'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultModelRouter,
  runGeneration,
  generateLyricsForPrompt,
  analyzeVoiceSamples,
  MAX_VOICE_SAMPLES,
} = require('../index.js');
const { encodeWav, decodeWav } = require('../../../003_AUDIO_ENGINE/AudioRenderer');

function sineWavBase64(frequency, seconds, sampleRate) {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = 0.6 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return encodeWav(samples, sampleRate, 1).toString('base64');
}

test('generateLyricsForPrompt is fast/audio-free and derives real recording phrases', () => {
  const result = generateLyricsForPrompt({ prompt: 'a happy pop song', seed: 1 });
  assert.ok(result.lyrics.lines.length > 0);
  assert.equal(result.recordingPhrases.length, 3);
  for (const phrase of result.recordingPhrases) {
    assert.ok(result.lyrics.lines.includes(phrase.text));
  }
});

test('generateLyricsForPrompt is deterministic given the same seed', () => {
  const a = generateLyricsForPrompt({ prompt: 'a sad ballad', seed: 99 });
  const b = generateLyricsForPrompt({ prompt: 'a sad ballad', seed: 99 });
  assert.deepEqual(a.lyrics, b.lyrics);
});

test('runGeneration includes lyrics generated with the same seed as the audio', async () => {
  const router = defaultModelRouter();
  const a = await runGeneration({ prompt: 'a dark cinematic piece', seed: 55 }, router);
  const b = generateLyricsForPrompt({ prompt: 'a dark cinematic piece', seed: 55 });
  assert.deepEqual(a.lyrics, b.lyrics);
});

test('runGeneration produces a real stereo WAV and always reports a seed', async () => {
  const result = await runGeneration({ prompt: 'a lofi track in C major at 80 bpm, 4 bars' }, defaultModelRouter());
  assert.ok(Number.isFinite(result.seed));
  assert.equal(result.wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(result.wav.readUInt16LE(22), 2); // stereo
  assert.ok(result.composition.tracks.length > 0);
  assert.ok(result.lyrics.lines.length > 0);
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

test('tempoStretch actually changes the rendered WAV duration via the phase vocoder', async () => {
  const router = defaultModelRouter();
  const prompt = 'a rock track in C major at 100 bpm, 4 bars';
  const baseline = await runGeneration({ prompt, seed: 10 }, router);
  const stretched = await runGeneration({ prompt, seed: 10, tempoStretch: 2 }, router);

  const baseSamples = decodeWav(baseline.wav).samples.length;
  const stretchedSamples = decodeWav(stretched.wav).samples.length;
  const ratio = stretchedSamples / baseSamples;
  assert.ok(Math.abs(ratio - 2) < 0.15, `expected ~2x duration, got ratio ${ratio}`);
});

test('pitchSemitones shifts pitch while the phase vocoder keeps the duration essentially unchanged', async () => {
  const router = defaultModelRouter();
  const prompt = 'a classical piece in C major at 100 bpm, 4 bars';
  const baseline = await runGeneration({ prompt, seed: 20 }, router);
  const shifted = await runGeneration({ prompt, seed: 20, pitchSemitones: 7 }, router);

  const baseSamples = decodeWav(baseline.wav).samples.length;
  const shiftedSamples = decodeWav(shifted.wav).samples.length;
  assert.equal(baseSamples, shiftedSamples); // pitch-shift is duration-preserving by design
});

test('pitchSemitones/tempoStretch outside the allowed range are clamped, not rejected', async () => {
  const result = await runGeneration(
    { prompt: 'an edm track', seed: 5, pitchSemitones: 999, tempoStretch: 999 },
    defaultModelRouter()
  );
  assert.equal(result.wav.toString('ascii', 0, 4), 'RIFF'); // still produced a valid WAV, didn't throw/hang
});

test('a request with no pitch/tempo params is byte-identical to one with the neutral values (0 semitones, 1x)', async () => {
  const router = defaultModelRouter();
  const prompt = 'a jazz track at 90 bpm';
  const a = await runGeneration({ prompt, seed: 30 }, router);
  const b = await runGeneration({ prompt, seed: 30, pitchSemitones: 0, tempoStretch: 1 }, router);
  assert.ok(a.wav.equals(b.wav));
});

test('runGeneration applies the requested EQ, producing an audibly different WAV than an EQ-less request', async () => {
  const router = defaultModelRouter();
  const prompt = 'a rock track in C major at 100 bpm, 8 bars';
  const flat = await runGeneration({ prompt, seed: 40 }, router);
  const eqd = await runGeneration({ prompt, seed: 40, eq: { bassDb: 10, trebleDb: -10 } }, router);
  assert.ok(!flat.wav.equals(eqd.wav), 'expected EQ to actually change the rendered audio');
});

test('runGeneration with eq: {} (all zero/absent) is byte-identical to no eq at all', async () => {
  const router = defaultModelRouter();
  const prompt = 'an ambient track at 80 bpm';
  const a = await runGeneration({ prompt, seed: 41 }, router);
  const b = await runGeneration({ prompt, seed: 41, eq: {} }, router);
  assert.ok(a.wav.equals(b.wav));
});

test('runGeneration clamps out-of-range EQ gains instead of rejecting the request', async () => {
  const result = await runGeneration(
    { prompt: 'a lofi track', seed: 42, eq: { bassDb: 999, midDb: -999, trebleDb: 999 } },
    defaultModelRouter()
  );
  assert.equal(result.wav.toString('ascii', 0, 4), 'RIFF'); // still produced a valid WAV, didn't throw/hang
});

test('runGeneration respects an explicit noDrums/noBass flag detected only from the prompt text', async () => {
  const result = await runGeneration({ prompt: 'a rock track with no drums and no bass' }, defaultModelRouter());
  assert.equal(result.composition.tracks.find((t) => t.name === 'drums'), undefined);
  assert.equal(result.composition.tracks.find((t) => t.name === 'bass'), undefined);
});

test('runGeneration lets an explicit noDrums/noBass body flag override the prompt text', async () => {
  const result = await runGeneration({ prompt: 'a normal rock track', noDrums: true, noBass: true }, defaultModelRouter());
  assert.equal(result.composition.tracks.find((t) => t.name === 'drums'), undefined);
  assert.equal(result.composition.tracks.find((t) => t.name === 'bass'), undefined);
});

test('a rap prompt gets the trap genre treatment: machine-tight melody quantization', async () => {
  const result = await runGeneration({ prompt: 'a hard rap beat at 90 bpm, 4 bars', seed: 60 }, defaultModelRouter());
  assert.equal(result.spec.genre, 'trap');
  const melody = result.composition.tracks.find((t) => t.name === 'melody');
  for (const note of melody.notes) {
    assert.equal(note.start, Math.round(note.start), 'rap/trap melody notes must sit exactly on the grid');
  }
});

test('a country prompt gets the country treatment: wider stereo field than a trap render', async () => {
  const router = defaultModelRouter();
  const country = await runGeneration({ prompt: 'a country ballad at 90 bpm, 4 bars', seed: 61 }, router);
  const trap = await runGeneration({ prompt: 'a trap beat at 90 bpm, 4 bars', seed: 61 }, router);
  assert.equal(country.spec.genre, 'country');
  const melodyPan = (r) => Math.abs(r.composition.tracks.find((t) => t.name === 'melody').pan);
  assert.ok(melodyPan(country) > melodyPan(trap));
});

test('the genre mastering profile is genuinely applied: a trap render differs from the same composition mastered neutrally', async () => {
  const { sanitizePrompt, validateSpec } = require('../../../002_LLM_GATEWAY/Guardrails');
  const { parsePrompt } = require('../../../002_LLM_GATEWAY/PromptEngine');
  const { generateComposition } = require('../../TrackGenerator');
  const { renderComposition, interleaveStereo, encodeWav } = require('../../../003_AUDIO_ENGINE/AudioRenderer');
  const { normalizeStereo, applyLimiterStereo, applyReverbStereo } = require('../../../003_AUDIO_ENGINE/MixMaster');

  const prompt = 'a trap beat at 90 bpm, 4 bars';
  const seed = 62;
  const result = await runGeneration({ prompt, seed }, defaultModelRouter());

  // Rebuild the exact same composition through the pipeline's own stages,
  // but with the OLD neutral mastering (no genre EQ, historical 0.9
  // limiter threshold). If the mastering profile is really wired in, the
  // real pipeline's WAV must differ from this reconstruction.
  const spec = validateSpec({ ...parsePrompt(sanitizePrompt(prompt)), seed });
  const composition = generateComposition(spec, { seed });
  assert.deepEqual(composition, result.composition); // same composition either way — only mastering differs
  const { left, right, sampleRate } = renderComposition(composition);
  const reverberated = applyReverbStereo(left, right, sampleRate, composition.reverb);
  const normalized = normalizeStereo(reverberated.left, reverberated.right);
  const neutral = applyLimiterStereo(normalized.left, normalized.right); // default 0.9 threshold, no EQ
  const neutralWav = encodeWav(interleaveStereo(neutral.left, neutral.right), sampleRate, 2);

  assert.ok(!result.wav.equals(neutralWav), 'expected the trap mastering profile to change the rendered WAV');
});

test('runGeneration renders a real 3/4 waltz when the prompt says so, reflected in the composition and a shorter render than the same bars in 4/4', async () => {
  const router = defaultModelRouter();
  const waltz = await runGeneration({ prompt: 'a classical waltz at 120 bpm, 8 bars', seed: 43 }, router);
  const fourFour = await runGeneration({ prompt: 'a classical piece at 120 bpm, 8 bars', seed: 43 }, router);
  assert.deepEqual(waltz.composition.timeSignature, [3, 4]);
  assert.deepEqual(fourFour.composition.timeSignature, [4, 4]);
  const { decodeWav } = require('../../../003_AUDIO_ENGINE/AudioRenderer');
  assert.ok(decodeWav(waltz.wav).samples.length < decodeWav(fourFour.wav).samples.length);
});
