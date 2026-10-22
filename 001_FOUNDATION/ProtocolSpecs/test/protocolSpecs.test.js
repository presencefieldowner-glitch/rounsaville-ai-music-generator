'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MESSAGE_TYPES, createMessage, validateMessage, createErrorMessage } = require('../index.js');

test('createMessage rejects unknown types', () => {
  assert.throws(() => createMessage('bogus.type', {}));
});

test('createMessage + validateMessage round-trip', () => {
  const msg = createMessage(MESSAGE_TYPES.GENERATION_REQUEST, { prompt: 'lofi beat' });
  const result = validateMessage(msg);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateMessage flags malformed payloads', () => {
  const result = validateMessage({ id: 'x', type: MESSAGE_TYPES.ERROR, payload: null });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('createErrorMessage wraps a real Error', () => {
  const msg = createErrorMessage(new Error('boom'));
  assert.equal(msg.type, MESSAGE_TYPES.ERROR);
  assert.equal(msg.payload.message, 'boom');
});
