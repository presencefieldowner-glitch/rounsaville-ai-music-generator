'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, MAX_VOICE_SAMPLES } = require('../index.js');
const { encodeWav } = require('../../../003_AUDIO_ENGINE/AudioRenderer');
const { createRateLimiter } = require('../../../001_FOUNDATION/Utilities');

function sineWavBase64(frequency, seconds, sampleRate) {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = 0.6 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return encodeWav(samples, sampleRate, 1).toString('base64');
}

async function withServer(fn, appOptions = {}) {
  const { server, app } = await startServer(0, appOptions);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn({ baseUrl, app });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health reports ok', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});

test('unknown route returns 404', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/nope`);
    assert.equal(res.status, 404);
  });
});

test('POST /api/sessions creates a session', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 201);
    const session = await res.json();
    assert.match(session.id, /^sess_/);
  });
});

test('GET /api/sessions/:id 404s for an unknown session', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/sessions/does-not-exist`);
    assert.equal(res.status, 404);
  });
});

test('full pipeline: create session, generate JSON composition + wav', async () => {
  await withServer(async ({ baseUrl }) => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', body: '{}' });
    const session = await createRes.json();

    const genRes = await fetch(`${baseUrl}/api/sessions/${session.id}/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a calm lofi track in C major at 80 bpm, 4 bars' }),
    });
    assert.equal(genRes.status, 200);
    const body = await genRes.json();
    assert.equal(body.modelUsed, 'algorithmic-composer');
    assert.ok(body.composition.tracks.length > 0);
    assert.ok(body.audio.base64Wav.length > 0);

    const historyRes = await fetch(`${baseUrl}/api/sessions/${session.id}`);
    const historyBody = await historyRes.json();
    assert.equal(historyBody.history.length, 2); // prompt event + generation event
  });
});

test('full pipeline: format=wav returns a real audio/wav response', async () => {
  await withServer(async ({ baseUrl }) => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', body: '{}' });
    const session = await createRes.json();

    const genRes = await fetch(`${baseUrl}/api/sessions/${session.id}/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'energetic edm at 128 bpm', format: 'wav' }),
    });
    assert.equal(genRes.status, 200);
    assert.equal(genRes.headers.get('content-type'), 'audio/wav');
    const bytes = Buffer.from(await genRes.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(22), 2); // real stereo output, not mono
  });
});

test('generate against an unknown session returns 404', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/sessions/nope/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'x' }),
    });
    assert.equal(res.status, 404);
  });
});

test('guardrails reject banned content with a 400', async () => {
  await withServer(async ({ baseUrl }) => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', body: '{}' });
    const session = await createRes.json();

    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'please use this copyrighted sample' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/generate is stateless: no session needed, returns a composition', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a cinematic track in D minor at 100 bpm, 4 bars' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.modelUsed, 'algorithmic-composer');
    assert.ok(body.audio.base64Wav.length > 0);
    // default (no instrumental flag) keeps the original instrumental-only tracks
    assert.equal(body.composition.tracks.find((t) => t.name === 'vocal'), undefined);
  });
});

test('POST /api/generate with instrumental: false adds a vocal track', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a pop song in C major at 110 bpm, 4 bars', instrumental: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.composition.tracks.find((t) => t.name === 'vocal'));
  });
});

test('POST /api/generate: an instrumental request stated only in the prompt text (no explicit flag) still omits vocals', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'an instrumental jazz track in C major at 110 bpm, 4 bars' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.composition.tracks.find((t) => t.name === 'vocal'), undefined);
  });
});

test('POST /api/generate: an explicit instrumental: false flag overrides an instrumental-sounding prompt', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'an instrumental jazz track in C major at 110 bpm, 4 bars',
        instrumental: false,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.composition.tracks.find((t) => t.name === 'vocal'));
  });
});

test('POST /api/generate accepts a voiceProfile and constrains the vocal range', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'a ballad in A minor at 90 bpm, 4 bars',
        instrumental: false,
        voiceProfile: { minPitchHz: 150, maxPitchHz: 260, averagePitchHz: 200 },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const vocal = body.composition.tracks.find((t) => t.name === 'vocal');
    assert.ok(vocal);
    assert.ok(vocal.notes.length > 0);
  });
});

test('POST /api/voice-profile analyzes a recorded sample and returns a pitch range', async () => {
  await withServer(async ({ baseUrl }) => {
    const sample = sineWavBase64(180, 1.0, 22050);
    const res = await fetch(`${baseUrl}/api/voice-profile`, {
      method: 'POST',
      body: JSON.stringify({ samples: [sample] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Math.abs(body.voiceProfile.averagePitchHz - 180) / 180 < 0.15);
    assert.equal(body.voiceProfile.sampleCount, 1);
  });
});

test('POST /api/voice-profile with no samples returns 400', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/voice-profile`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 400);
  });
});

test('POST /api/voice-profile rejects more than the max sample count', async () => {
  await withServer(async ({ baseUrl }) => {
    const sample = sineWavBase64(180, 0.05, 8000);
    const samples = new Array(MAX_VOICE_SAMPLES + 1).fill(sample);
    const res = await fetch(`${baseUrl}/api/voice-profile`, {
      method: 'POST',
      body: JSON.stringify({ samples }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too many/i);
  });
});

test('POST /api/voice-profile rejects an oversized individual sample', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/voice-profile`, {
      method: 'POST',
      body: JSON.stringify({ samples: ['A'.repeat(9_000_000)] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /exceeds the maximum/i);
  });
});

test('rate limiting: exceeding capacity on a compute-heavy route returns 429 with Retry-After', async () => {
  await withServer(
    async ({ baseUrl }) => {
      const makeRequest = () =>
        fetch(`${baseUrl}/api/generate`, { method: 'POST', body: JSON.stringify({ prompt: 'a lofi track' }) });

      const first = await makeRequest();
      assert.equal(first.status, 200);

      const second = await makeRequest();
      assert.equal(second.status, 429);
      assert.ok(second.headers.get('retry-after'));
      const body = await second.json();
      assert.match(body.error, /rate limit/i);
    },
    { rateLimiter: createRateLimiter({ capacity: 1, refillPerSecond: 0.001 }) }
  );
});

test('rate limiting does not apply to health checks', async () => {
  await withServer(
    async ({ baseUrl }) => {
      for (let i = 0; i < 5; i += 1) {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.equal(res.status, 200);
      }
    },
    { rateLimiter: createRateLimiter({ capacity: 1, refillPerSecond: 0.001 }) }
  );
});
