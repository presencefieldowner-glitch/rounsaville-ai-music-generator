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

test('getIndexHtml produces well-formed, parseable script content (balanced braces/quotes)', () => {
  const html = getIndexHtml({ apiBaseUrl: '' });
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'expected an inline <script> block');
  // A syntax error here throws, which is the actual assertion.
  // eslint-disable-next-line no-new-func
  new Function(scriptMatch[1]);
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
