'use strict';

const { generateId } = require('../Utilities');

// Message envelope shared by the LLM gateway, composition agent, audio
// engine and interface layers so every hop can be logged/validated the
// same way regardless of transport (HTTP body, WebSocket frame, in-process
// call).

const MESSAGE_TYPES = Object.freeze({
  PROMPT_REQUEST: 'prompt.request',
  PROMPT_RESPONSE: 'prompt.response',
  GENERATION_REQUEST: 'generation.request',
  GENERATION_RESULT: 'generation.result',
  PROGRESS: 'generation.progress',
  ERROR: 'error',
});

const VALID_TYPES = new Set(Object.values(MESSAGE_TYPES));

function createMessage(type, payload = {}, meta = {}) {
  if (!VALID_TYPES.has(type)) {
    throw new TypeError(`Unknown message type: ${type}`);
  }
  return {
    id: generateId('msg'),
    type,
    payload,
    meta,
    timestamp: Date.now(),
  };
}

function validateMessage(message) {
  const errors = [];
  if (!message || typeof message !== 'object') {
    return { valid: false, errors: ['message must be an object'] };
  }
  if (!message.id) errors.push('message.id is required');
  if (!VALID_TYPES.has(message.type)) errors.push(`message.type is invalid: ${message.type}`);
  if (typeof message.payload !== 'object' || message.payload === null) {
    errors.push('message.payload must be an object');
  }
  return { valid: errors.length === 0, errors };
}

function createErrorMessage(error, meta = {}) {
  return createMessage(
    MESSAGE_TYPES.ERROR,
    { message: error instanceof Error ? error.message : String(error) },
    meta
  );
}

module.exports = {
  MESSAGE_TYPES,
  createMessage,
  validateMessage,
  createErrorMessage,
};
