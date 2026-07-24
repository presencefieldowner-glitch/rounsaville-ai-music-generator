'use strict';

// Shared orchestration glue: prompt text -> sanitized spec -> composition
// -> rendered/reverbed/mastered stereo WAV, plus voice-sample analysis
// with its guards. Both 005_INTERFACE/REST_API and netlify/functions/
// call this — extracted here so the two interfaces can't drift out of
// sync with each other (they did briefly: the Netlify functions were
// still rendering mono with no reverb/seed support after REST_API grew
// those features).

const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../TrackGenerator');
const { renderComposition, interleaveStereo, encodeWav, decodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalizeStereo, applyLimiterStereo, applyReverbStereo } = require('../../003_AUDIO_ENGINE/MixMaster');
const { analyzeVoiceSample, buildVoiceProfile } = require('../../003_AUDIO_ENGINE/VoiceProfiler');

const MAX_SEED = 2 ** 31 - 1;
const MAX_VOICE_SAMPLES = 10;
// ~6MB decoded, well over a few seconds of 16-bit mono WAV per phrase.
const MAX_VOICE_SAMPLE_BASE64_LENGTH = 8_000_000;

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

// Every generation has a seed — either the caller's (for "regenerate the
// same track") or a freshly random one — and it's always returned so the
// caller can capture it for later.
async function runGeneration(body, modelRouter) {
  const cleanPrompt = sanitizePrompt(body.prompt ?? '');
  const parsedSpec = parsePrompt(cleanPrompt);
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed) & MAX_SEED : Math.floor(Math.random() * MAX_SEED);
  // An explicit body.instrumental (from a UI toggle) wins; otherwise fall
  // back to whatever the prompt text itself said (see PromptEngine's
  // detectInstrumental), which can also be undefined.
  const spec = validateSpec({
    ...parsedSpec,
    instrumental: body.instrumental ?? parsedSpec.instrumental,
    voiceProfile: body.voiceProfile,
    seed,
  });

  const { modelUsed, result: composition } = await modelRouter.route(spec);
  const { left, right, sampleRate } = renderComposition(composition);
  const reverberated = applyReverbStereo(left, right, sampleRate, composition.reverb);
  const normalized = normalizeStereo(reverberated.left, reverberated.right);
  const mastered = applyLimiterStereo(normalized.left, normalized.right);
  const wav = encodeWav(interleaveStereo(mastered.left, mastered.right), sampleRate, 2);

  return { cleanPrompt, spec, modelUsed, composition, sampleRate, wav, seed };
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
  analyzeVoiceSamples,
  MAX_SEED,
  MAX_VOICE_SAMPLES,
  MAX_VOICE_SAMPLE_BASE64_LENGTH,
};
