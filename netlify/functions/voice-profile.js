'use strict';

// Analyzes recorded voice samples (base64 WAV) and returns a pitch-range
// profile via 004_COMPOSITION_AGENT/GenerationPipeline (shared with
// REST_API, including its sample count/size guards). This calibrates the
// synth's vocal range to the speaker's real pitch — it is not neural
// voice cloning/timbre transfer, and no ML model or network call is
// involved.

const { analyzeVoiceSamples } = require('../../004_COMPOSITION_AGENT/GenerationPipeline');

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
    const base64Samples = body.samples ?? (body.base64Wav ? [body.base64Wav] : []);
    const voiceProfile = analyzeVoiceSamples(base64Samples);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceProfile }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
