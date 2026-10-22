'use strict';

const crypto = require('node:crypto');

// Minimal RFC 6455 WebSocket server implementation (text frames only, no
// permessage-deflate) built directly on Node's http "upgrade" event. No
// external dependency — this is the real protocol handshake and framing,
// not a wrapper around another library.

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(payload, opcode = OPCODE_TEXT) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const length = payloadBuffer.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN=1

  return Buffer.concat([header, payloadBuffer]);
}

// Decodes exactly one client frame (masked, per spec) from the start of
// `buffer`. Returns { frame, bytesConsumed } or null if more data is needed.
function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let maskKey;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) return null;

  const rawPayload = buffer.subarray(offset, offset + payloadLength);
  const payload = Buffer.alloc(payloadLength);
  if (masked) {
    for (let i = 0; i < payloadLength; i += 1) payload[i] = rawPayload[i] ^ maskKey[i % 4];
  } else {
    rawPayload.copy(payload);
  }

  return { frame: { opcode, payload }, bytesConsumed: offset + payloadLength };
}

function attachWebSocketServer(httpServer, { path = '/ws', onConnection } = {}) {
  const clientsBySession = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    const clientKey = req.headers['sec-websocket-key'];
    if (!clientKey) {
      socket.destroy();
      return;
    }

    const acceptKey = computeAcceptKey(clientKey);
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n');
    socket.write(responseHeaders);

    const sessionId = url.searchParams.get('session') ?? 'default';
    const connection = {
      sessionId,
      send: (text) => socket.write(encodeFrame(text, OPCODE_TEXT)),
      close: () => socket.end(encodeFrame(Buffer.alloc(0), OPCODE_CLOSE)),
    };

    if (!clientsBySession.has(sessionId)) clientsBySession.set(sessionId, new Set());
    clientsBySession.get(sessionId).add(connection);

    let buffered = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    const handlers = { message: [], close: [] };
    connection.on = (event, handler) => handlers[event]?.push(handler);

    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      let result = decodeFrame(buffered);
      while (result) {
        buffered = buffered.subarray(result.bytesConsumed);
        const { opcode, payload } = result.frame;
        if (opcode === OPCODE_TEXT) {
          handlers.message.forEach((h) => h(payload.toString('utf8')));
        } else if (opcode === OPCODE_PING) {
          socket.write(encodeFrame(payload, OPCODE_PONG));
        } else if (opcode === OPCODE_CLOSE) {
          socket.end();
        }
        result = decodeFrame(buffered);
      }
    });

    socket.on('close', () => {
      clientsBySession.get(sessionId)?.delete(connection);
      handlers.close.forEach((h) => h());
    });

    onConnection?.(connection);
  });

  function broadcast(sessionId, message) {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    for (const connection of clientsBySession.get(sessionId) ?? []) {
      connection.send(text);
    }
  }

  return { broadcast };
}

module.exports = {
  attachWebSocketServer,
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  WS_MAGIC,
};
