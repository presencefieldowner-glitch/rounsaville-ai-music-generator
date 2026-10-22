'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const {
  attachWebSocketServer,
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
} = require('../index.js');

test('computeAcceptKey matches the RFC 6455 worked example', () => {
  const accept = computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

function encodeMaskedClientFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];

  const header = Buffer.alloc(2);
  header[0] = 0x80 | 0x1; // FIN + text opcode
  header[1] = 0x80 | payload.length; // masked + length (small payloads only)
  return Buffer.concat([header, mask, masked]);
}

test('encodeFrame/decodeFrame round-trip an unmasked payload', () => {
  const frame = encodeFrame('hello');
  const result = decodeFrame(frame);
  assert.equal(result.frame.payload.toString('utf8'), 'hello');
  assert.equal(result.bytesConsumed, frame.length);
});

test('decodeFrame unmasks a masked client frame correctly', () => {
  const frame = encodeMaskedClientFrame('ping');
  const result = decodeFrame(frame);
  assert.equal(result.frame.payload.toString('utf8'), 'ping');
});

// Exercised against Node's standards-compliant global WebSocket client
// (stable since Node 22) rather than a hand-rolled socket, so the test
// verifies interop with a real client, not just our own encoder/decoder.
test('end-to-end: handshake, client message, server broadcast', async () => {
  const server = http.createServer((_req, res) => res.end('http-ok'));
  let resolveMessage;
  const gotMessage = new Promise((resolve) => {
    resolveMessage = resolve;
  });

  const ws = attachWebSocketServer(server, {
    onConnection: (connection) => {
      connection.on('message', (text) => resolveMessage(text));
    },
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws?session=abc`);

  try {
    await new Promise((resolve, reject) => {
      client.addEventListener('open', resolve, { once: true });
      client.addEventListener('error', reject, { once: true });
    });

    const gotBroadcast = new Promise((resolve) => {
      client.addEventListener('message', (event) => resolve(event.data), { once: true });
    });

    client.send('hello-from-client');
    assert.equal(await gotMessage, 'hello-from-client');

    ws.broadcast('abc', 'hello-from-server');
    assert.equal(await gotBroadcast, 'hello-from-server');
  } finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
