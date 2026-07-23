'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getIndexHtml, startWebUI } = require('../index.js');

test('getIndexHtml embeds the configured API base URL and a title', () => {
  const html = getIndexHtml({ apiBaseUrl: 'http://example.test' });
  assert.match(html, /<title>Rounsaville AI Music Generator<\/title>/);
  assert.match(html, /http:\/\/example\.test/);
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
