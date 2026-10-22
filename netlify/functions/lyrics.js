'use strict';

// Fast, audio-free lyrics preview via 004_COMPOSITION_AGENT/GenerationPipeline
// (shared with REST_API's /api/lyrics). Real template + rhyme-family
// generation (see 002_LLM_GATEWAY/LyricsEngine), not an LLM — and the words
// it returns are never sung by the audio pipeline; there's no text-to-
// singing-voice synthesis here, and recording the derived phrases only
// calibrates pitch range, not voice timbre.

const { generateLyricsForPrompt } = require('../../004_COMPOSITION_AGENT/GenerationPipeline');

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
    const result = generateLyricsForPrompt(body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: result.seed, lyrics: result.lyrics, recordingPhrases: result.recordingPhrases }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
