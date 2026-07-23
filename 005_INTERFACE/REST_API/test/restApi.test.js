'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../index.js');

async function withServer(fn) {
  const { server, app } = await startServer(0);
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
