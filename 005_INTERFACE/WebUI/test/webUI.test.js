'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getIndexHtml, startWebUI, GENRES, VOICE_PHRASES } = require('../index.js');

test('getIndexHtml embeds the configured API base URL and a title', () => {
  const html = getIndexHtml({ apiBaseUrl: 'http://example.test' });
  assert.match(html, /<title>Rounsaville AI Music Generator<\/title>/);
  assert.match(html, /http:\/\/example\.test/);
});

test('getIndexHtml renders every genre as a style option', () => {
  const html = getIndexHtml();
  for (const genre of GENRES) {
    assert.match(html, new RegExp(`<option value="${genre}">`));
  }
});

test('getIndexHtml includes the voice-cloning disclaimer and calls /api/generate + /api/voice-profile', () => {
  const html = getIndexHtml();
  assert.match(html, /not[\s\S]{0,60}neural voice cloning/i);
  assert.match(html, /\/api\/generate/);
  assert.match(html, /\/api\/voice-profile/);
  assert.equal(VOICE_PHRASES.length, 3);
});

test('getIndexHtml includes seed/regenerate, rating, and download controls', () => {
  const html = getIndexHtml();
  assert.match(html, /id="regenerate"/);
  assert.match(html, /id="seedValue"/);
  assert.match(html, /id="downloadLink"/);
  assert.match(html, /rate-btn/); // thumbs up/down rating buttons
  assert.match(html, /payload\.seed = seedOverride/);
});

test('getIndexHtml includes the deferred client-side (Web Audio) live-playback path', () => {
  const html = getIndexHtml();
  assert.match(html, /id="playLive"/);
  assert.match(html, /id="stopLive"/);
  assert.match(html, /LiveSynth/);
  assert.match(html, /createDynamicsCompressor/); // real native limiter, not a fake one
  assert.match(html, /AudioWorklet/i); // honest disclosure that pluck is approximated here
});

test('getIndexHtml includes pitch-bend/tempo-stretch controls wired to the phase vocoder params', () => {
  const html = getIndexHtml();
  assert.match(html, /id="pitchBend"/);
  assert.match(html, /id="tempoStretch"/);
  assert.match(html, /payload\.pitchSemitones = pitchSemitones/);
  assert.match(html, /payload\.tempoStretch = tempoStretch/);
  assert.match(html, /phase vocoder/i);
});

test('getIndexHtml produces well-formed, parseable script content (balanced braces/quotes)', () => {
  const html = getIndexHtml({ apiBaseUrl: '' });
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'expected an inline <script> block');
  // A syntax error here throws, which is the actual assertion.
  // eslint-disable-next-line no-new-func
  new Function(scriptMatch[1]);
});

test('getIndexHtml includes the lyrics section wired to /api/lyrics with an honest disclaimer', () => {
  const html = getIndexHtml();
  assert.match(html, /id="generateLyrics"/);
  assert.match(html, /id="lyricsSections"/);
  assert.match(html, /id="lyricsTitle"/);
  assert.match(html, /\/api\/lyrics/);
  assert.match(html, /not[\s\S]{0,20}an LLM/i);
  assert.match(html, /never sung/i);
  assert.match(html, /no text-to-singing-voice synthesis/i);
});

test('getIndexHtml derives the voice-recording phrases from generated lyrics rather than only the static fallback', () => {
  const html = getIndexHtml();
  assert.match(html, /applyRecordingPhrases/);
  assert.match(html, /currentPhrases/);
  // The fallback phrases still exist for before any lyrics are generated.
  assert.equal(VOICE_PHRASES.length, 3);
});

test('getIndexHtml includes the 3-band EQ sliders wired into payload.eq', () => {
  const html = getIndexHtml();
  assert.match(html, /id="bassDb"/);
  assert.match(html, /id="midDb"/);
  assert.match(html, /id="trebleDb"/);
  assert.match(html, /payload\.eq = /);
  assert.match(html, /Audio EQ Cookbook/i);
});

test('getIndexHtml includes No drums / No bass / Waltz controls wired into the prompt and payload', () => {
  const html = getIndexHtml();
  assert.match(html, /id="noDrums"/);
  assert.match(html, /id="noBass"/);
  assert.match(html, /id="waltz"/);
  assert.match(html, /payload\.noDrums = true/);
  assert.match(html, /payload\.noBass = true/);
  assert.match(html, /payload\.timeSignature = \[3, 4\]/);
});

test('startWebUI serves the page at / and 404s elsewhere', async () => {
  const server = await startWebUI(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await res.text();
    assert.match(html, /Generate/);

    const missing = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('apiProxyTarget forwards /api/* requests to a real backend (fixes plain local dev, two separate ports)', async () => {
  const { startServer } = require('../../REST_API');
  const { server: apiServer } = await startServer(0);
  const apiPort = apiServer.address().port;

  const uiServer = await startWebUI(0, { apiProxyTarget: `http://127.0.0.1:${apiPort}` });
  const uiPort = uiServer.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${uiPort}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    await new Promise((resolve) => uiServer.close(resolve));
    await new Promise((resolve) => apiServer.close(resolve));
  }
});

test('apiProxyTarget also forwards /api/lyrics, returning real lyrics + recording phrases', async () => {
  const { startServer } = require('../../REST_API');
  const { server: apiServer } = await startServer(0);
  const apiPort = apiServer.address().port;

  const uiServer = await startWebUI(0, { apiProxyTarget: `http://127.0.0.1:${apiPort}` });
  const uiPort = uiServer.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${uiPort}/api/lyrics`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a happy pop song', seed: 4 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.lyrics.lines.length > 0);
    assert.equal(body.recordingPhrases.length, 3);
  } finally {
    await new Promise((resolve) => uiServer.close(resolve));
    await new Promise((resolve) => apiServer.close(resolve));
  }
});

test('apiProxyTarget forwards eq/noDrums/timeSignature through /api/generate end to end', async () => {
  const { startServer } = require('../../REST_API');
  const { server: apiServer } = await startServer(0);
  const apiPort = apiServer.address().port;

  const uiServer = await startWebUI(0, { apiProxyTarget: `http://127.0.0.1:${apiPort}` });
  const uiPort = uiServer.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${uiPort}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'a classical waltz at 100 bpm, 8 bars',
        noDrums: true,
        eq: { bassDb: 8 },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.composition.timeSignature, [3, 4]);
    assert.equal(body.composition.tracks.find((t) => t.name === 'drums'), undefined);
  } finally {
    await new Promise((resolve) => uiServer.close(resolve));
    await new Promise((resolve) => apiServer.close(resolve));
  }
});

test('without apiProxyTarget, /api/* still 404s on the WebUI server (documents the gap it fixes)', async () => {
  const server = await startWebUI(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
