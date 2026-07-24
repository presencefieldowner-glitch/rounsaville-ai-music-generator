'use strict';

// Stateless Netlify Function wrapping the composition pipeline. Unlike
// 005_INTERFACE/REST_API (which keeps sessions/history in an in-memory
// Map), serverless invocations aren't guaranteed to share memory, so this
// endpoint takes a prompt and returns a composition + WAV in one shot with
// no server-side session state. The actual generation logic lives in
// 004_COMPOSITION_AGENT/GenerationPipeline, shared with REST_API, so this
// file can't silently drift out of sync with it (it briefly did: this
// function was still rendering mono with no reverb/seed support after
// REST_API grew those features).

const { defaultModelRouter, runGeneration } = require('../../004_COMPOSITION_AGENT/GenerationPipeline');

const router = defaultModelRouter();

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
    const result = await runGeneration(body, router);

    if (body.format === 'wav') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'audio/wav', 'X-Generation-Seed': String(result.seed) },
        body: result.wav.toString('base64'),
        isBase64Encoded: true,
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelUsed: result.modelUsed,
        composition: result.composition,
        seed: result.seed,
        audio: { sampleRate: result.sampleRate, base64Wav: result.wav.toString('base64') },
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
