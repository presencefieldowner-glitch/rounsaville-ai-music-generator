'use strict';

// Stateless Netlify Function wrapping the composition pipeline. Unlike
// 005_INTERFACE/REST_API (which keeps sessions/history in an in-memory
// Map), serverless invocations aren't guaranteed to share memory, so this
// endpoint takes a prompt and returns a composition + WAV in one shot with
// no server-side session state.

const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../../004_COMPOSITION_AGENT/TrackGenerator');
const { renderComposition, encodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalize, applyLimiter } = require('../../003_AUDIO_ENGINE/MixMaster');

function buildRouter() {
  const router = createModelRouter();
  router.register('algorithmic-composer', async (spec) => generateComposition(spec), { priority: 10 });
  return router;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const cleanPrompt = sanitizePrompt(body.prompt ?? '');
    const spec = validateSpec({
      ...parsePrompt(cleanPrompt),
      instrumental: body.instrumental,
      voiceProfile: body.voiceProfile,
    });

    const { modelUsed, result: composition } = await buildRouter().route(spec);
    const { buffer, sampleRate } = renderComposition(composition);
    const mastered = applyLimiter(normalize(buffer));
    const wav = encodeWav(mastered, sampleRate, 1);

    if (body.format === 'wav') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'audio/wav' },
        body: wav.toString('base64'),
        isBase64Encoded: true,
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelUsed,
        composition,
        audio: { sampleRate, base64Wav: wav.toString('base64') },
      }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
