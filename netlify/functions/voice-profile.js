'use strict';

// Analyzes recorded voice samples (base64 WAV) and returns a pitch-range
// profile via 003_AUDIO_ENGINE/VoiceProfiler. This calibrates the synth's
// vocal range to the speaker's real pitch — it is not neural voice
// cloning/timbre transfer, and no ML model or network call is involved.

const { decodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { analyzeVoiceSample, buildVoiceProfile } = require('../../003_AUDIO_ENGINE/VoiceProfiler');

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
    if (!Array.isArray(base64Samples) || base64Samples.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'at least one base64-encoded WAV sample is required' }),
      };
    }

    const analyses = base64Samples.map((base64Wav) => {
      const { samples, sampleRate } = decodeWav(Buffer.from(base64Wav, 'base64'));
      return analyzeVoiceSample(samples, sampleRate);
    });

    const voiceProfile = buildVoiceProfile(analyses);
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
