'use strict';

const http = require('node:http');
const { createLogger } = require('../../001_FOUNDATION/Utilities');
const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../../004_COMPOSITION_AGENT/TrackGenerator');
const { createSessionManager } = require('../../004_COMPOSITION_AGENT/SessionManager');
const { createCompositionMemory } = require('../../004_COMPOSITION_AGENT/CompositionMemory');
const { renderComposition, encodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalize, applyLimiter } = require('../../003_AUDIO_ENGINE/MixMaster');

const logger = createLogger('REST_API', { level: 'warn' });

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function defaultModelRouter() {
  const router = createModelRouter();
  router.register('algorithmic-composer', async (spec) => generateComposition(spec), { priority: 10 });
  return router;
}

function createApp({
  sessionManager = createSessionManager(),
  compositionMemory = createCompositionMemory(),
  modelRouter = defaultModelRouter(),
} = {}) {
  async function handleCreateSession(req, res) {
    const body = await readJsonBody(req);
    const session = sessionManager.create(body.meta ?? {});
    sendJson(res, 201, session);
  }

  async function handleGenerate(req, res, sessionId) {
    const session = sessionManager.get(sessionId);
    if (!session) return sendJson(res, 404, { error: 'session not found' });

    const body = await readJsonBody(req);
    const cleanPrompt = sanitizePrompt(body.prompt ?? '');
    const parsedSpec = parsePrompt(cleanPrompt);
    const spec = validateSpec(parsedSpec);

    compositionMemory.appendEvent(sessionId, { type: 'prompt', text: cleanPrompt, spec });

    const { modelUsed, result: composition } = await modelRouter.route(spec);
    compositionMemory.appendEvent(sessionId, { type: 'generation', modelUsed, composition });

    const { buffer, sampleRate } = renderComposition(composition);
    const mastered = applyLimiter(normalize(buffer));
    const wav = encodeWav(mastered, sampleRate, 1);

    sessionManager.update(sessionId, {});

    if (body.format === 'wav') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      return res.end(wav);
    }

    sendJson(res, 200, {
      modelUsed,
      composition,
      audio: { sampleRate, base64Wav: wav.toString('base64') },
    });
  }

  function handleGetSession(req, res, sessionId) {
    const session = sessionManager.get(sessionId);
    if (!session) return sendJson(res, 404, { error: 'session not found' });
    sendJson(res, 200, { session, history: compositionMemory.getHistory(sessionId) });
  }

  async function router(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'health') {
        return sendJson(res, 200, { status: 'ok' });
      }
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts.length === 2) {
        return await handleCreateSession(req, res);
      }
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts.length === 3) {
        return handleGetSession(req, res, parts[2]);
      }
      if (
        req.method === 'POST' &&
        parts[0] === 'api' &&
        parts[1] === 'sessions' &&
        parts[3] === 'generate' &&
        parts.length === 4
      ) {
        return await handleGenerate(req, res, parts[2]);
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error('request failed', { error: err.message, path: url.pathname });
      sendJson(res, 400, { error: err.message });
    }
  }

  return { router, sessionManager, compositionMemory, modelRouter };
}

function startServer(port = 0, appOptions = {}) {
  const app = createApp(appOptions);
  const server = http.createServer(app.router);
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, app }));
  });
}

module.exports = { createApp, startServer, readJsonBody };
