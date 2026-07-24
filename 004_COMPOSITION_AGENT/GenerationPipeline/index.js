'use strict';

// Shared orchestration glue: prompt text -> sanitized spec -> composition
// -> rendered/reverbed/mastered stereo WAV, plus voice-sample analysis
// with its guards. Both 005_INTERFACE/REST_API and netlify/functions/
// call this — extracted here so the two interfaces can't drift out of
// sync with each other (they did briefly: the Netlify functions were
// still rendering mono with no reverb/seed support after REST_API grew
// those features).

const { clamp } = require('../../001_FOUNDATION/Utilities');
const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../TrackGenerator');
const { renderComposition, interleaveStereo, encodeWav, decodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalizeStereo, applyLimiterStereo, applyReverbStereo, applyEqStereo } = require('../../003_AUDIO_ENGINE/MixMaster');
const { analyzeVoiceSample, buildVoiceProfile } = require('../../003_AUDIO_ENGINE/VoiceProfiler');
const { pitchShift, timeStretch } = require('../../003_AUDIO_ENGINE/PhaseVocoder');
const { generateLyrics, deriveRecordingPhrases } = require('../../002_LLM_GATEWAY/LyricsEngine');

const MAX_SEED = 2 ** 31 - 1;
const MAX_VOICE_SAMPLES = 10;
// ~6MB decoded, well over a few seconds of 16-bit mono WAV per phrase.
const MAX_VOICE_SAMPLE_BASE64_LENGTH = 8_000_000;
const MAX_PITCH_SEMITONES = 12; // +/- one octave
const MIN_TEMPO_STRETCH = 0.5; // half speed
const MAX_TEMPO_STRETCH = 2; // double speed
const MAX_EQ_DB = 12; // per-band boost/cut ceiling for the 3-band EQ

function defaultModelRouter() {
  const router = createModelRouter();
  // spec.seed rides along on the spec object (same pattern as
  // instrumental/voiceProfile) so ModelRouter's single-argument interface
  // doesn't need to change; generateComposition falls back to a fresh
  // random seed when it's absent.
  router.register('algorithmic-composer', async (spec) => generateComposition(spec, { seed: spec.seed }), {
    priority: 10,
  });
  return router;
}

// Lightweight, audio-free: parses the prompt and generates lyrics text
// only, for a fast "see the words before you commit to generating the
// full track" preview and for deriving the voice-recording phrases from
// them. Note this is real, if simple, template + rhyme-family generation
// (see 002_LLM_GATEWAY/LyricsEngine) — not an LLM — and the words it
// produces are never sung by the audio pipeline (there's no text-to-
// singing-voice synthesis here); see runGeneration's comment for why.
function generateLyricsForPrompt(body) {
  const cleanPrompt = sanitizePrompt(body.prompt ?? '');
  const parsedSpec = parsePrompt(cleanPrompt);
  const spec = validateSpec(parsedSpec);
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed) & MAX_SEED : Math.floor(Math.random() * MAX_SEED);
  const lyrics = generateLyrics(spec, { seed });
  const recordingPhrases = deriveRecordingPhrases(lyrics);
  return { cleanPrompt, spec, seed, lyrics, recordingPhrases };
}

// Every generation has a seed — either the caller's (for "regenerate the
// same track") or a freshly random one — and it's always returned so the
// caller can capture it for later.
async function runGeneration(body, modelRouter) {
  const cleanPrompt = sanitizePrompt(body.prompt ?? '');
  const parsedSpec = parsePrompt(cleanPrompt);
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed) & MAX_SEED : Math.floor(Math.random() * MAX_SEED);
  // An explicit body.<field> (from a UI toggle) wins; otherwise fall back
  // to whatever the prompt text itself said (see PromptEngine's
  // detectInstrumental/detectNoDrums/detectNoBass/detectTimeSignature),
  // any of which can also be undefined, in which case validateSpec's
  // defaults (include the track, 4/4) apply.
  const spec = validateSpec({
    ...parsedSpec,
    instrumental: body.instrumental ?? parsedSpec.instrumental,
    noDrums: body.noDrums ?? parsedSpec.noDrums,
    noBass: body.noBass ?? parsedSpec.noBass,
    timeSignature: body.timeSignature ?? parsedSpec.timeSignature,
    voiceProfile: body.voiceProfile,
    seed,
  });

  const lyrics = generateLyrics(spec, { seed });

  const { modelUsed, result: composition } = await modelRouter.route(spec);
  const { left, right, sampleRate } = renderComposition(composition);
  const reverberated = applyReverbStereo(left, right, sampleRate, composition.reverb);

  // Optional post-processing via the phase vocoder: pitch-bend and/or
  // tempo-stretch the already-rendered mix. Applied per-channel, then
  // re-normalized/re-limited afterward since resampling can shift peak
  // levels slightly.
  let processedLeft = reverberated.left;
  let processedRight = reverberated.right;
  if (Number.isFinite(body.pitchSemitones) && body.pitchSemitones !== 0) {
    const semitones = clamp(body.pitchSemitones, -MAX_PITCH_SEMITONES, MAX_PITCH_SEMITONES);
    processedLeft = pitchShift(processedLeft, sampleRate, semitones);
    processedRight = pitchShift(processedRight, sampleRate, semitones);
  }
  if (Number.isFinite(body.tempoStretch) && body.tempoStretch !== 1) {
    const stretch = clamp(body.tempoStretch, MIN_TEMPO_STRETCH, MAX_TEMPO_STRETCH);
    processedLeft = timeStretch(processedLeft, sampleRate, stretch);
    processedRight = timeStretch(processedRight, sampleRate, stretch);
  }

  // Optional real 3-band biquad EQ (see MixMaster.applyEqStereo), tone-
  // shaping before the final loudness stage so normalize/limit still see
  // (and react to) the EQ'd peaks, matching real mastering-chain order.
  if (body.eq && typeof body.eq === 'object') {
    const eq = {
      bassDb: Number.isFinite(body.eq.bassDb) ? clamp(body.eq.bassDb, -MAX_EQ_DB, MAX_EQ_DB) : 0,
      midDb: Number.isFinite(body.eq.midDb) ? clamp(body.eq.midDb, -MAX_EQ_DB, MAX_EQ_DB) : 0,
      trebleDb: Number.isFinite(body.eq.trebleDb) ? clamp(body.eq.trebleDb, -MAX_EQ_DB, MAX_EQ_DB) : 0,
    };
    if (eq.bassDb !== 0 || eq.midDb !== 0 || eq.trebleDb !== 0) {
      const eqd = applyEqStereo(processedLeft, processedRight, sampleRate, eq);
      processedLeft = eqd.left;
      processedRight = eqd.right;
    }
  }

  const normalized = normalizeStereo(processedLeft, processedRight);
  const mastered = applyLimiterStereo(normalized.left, normalized.right);
  const wav = encodeWav(interleaveStereo(mastered.left, mastered.right), sampleRate, 2);

  return { cleanPrompt, spec, modelUsed, composition, sampleRate, wav, seed, lyrics };
}

// Validates, decodes, and analyzes recorded voice samples (base64 WAV),
// returning a pitch-range profile. Throws a plain Error with a
// caller-facing message on any violation, so both interfaces can just
// catch-and-400 the same way they already do for other request errors.
function analyzeVoiceSamples(base64Samples) {
  if (!Array.isArray(base64Samples) || base64Samples.length === 0) {
    throw new Error('at least one base64-encoded WAV sample is required');
  }
  if (base64Samples.length > MAX_VOICE_SAMPLES) {
    throw new Error(`too many voice samples (max ${MAX_VOICE_SAMPLES})`);
  }
  const oversized = base64Samples.find((s) => typeof s !== 'string' || s.length > MAX_VOICE_SAMPLE_BASE64_LENGTH);
  if (oversized !== undefined) {
    throw new Error('a voice sample exceeds the maximum allowed size');
  }

  const analyses = base64Samples.map((base64Wav) => {
    const { samples, sampleRate } = decodeWav(Buffer.from(base64Wav, 'base64'));
    return analyzeVoiceSample(samples, sampleRate);
  });

  return buildVoiceProfile(analyses);
}

module.exports = {
  defaultModelRouter,
  runGeneration,
  generateLyricsForPrompt,
  analyzeVoiceSamples,
  MAX_SEED,
  MAX_VOICE_SAMPLES,
  MAX_VOICE_SAMPLE_BASE64_LENGTH,
  MAX_PITCH_SEMITONES,
  MIN_TEMPO_STRETCH,
  MAX_TEMPO_STRETCH,
  MAX_EQ_DB,
};
