'use strict';

const http = require('node:http');
const { createLogger } = require('../../001_FOUNDATION/Utilities');
const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../../004_COMPOSITION_AGENT/TrackGenerator');
const { createSessionManager } = require('../../004_COMPOSITION_AGENT/SessionManager');
const { createCompositionMemory } = require('../../004_COMPOSITION_AGENT/CompositionMemory');
const { renderComposition, encodeWav, decodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalize, applyLimiter } = require('../../003_AUDIO_ENGINE/MixMaster');
const { analyzeVoiceSample, buildVoiceProfile } = require('../../003_AUDIO_ENGINE/VoiceProfiler');

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

// Shared by the session-based /generate and the stateless /api/generate:
// prompt text -> sanitized spec -> composition -> rendered/mastered WAV.
async function runGeneration(body, modelRouter) {
  const cleanPrompt = sanitizePrompt(body.prompt ?? '');
  const spec = validateSpec({
    ...parsePrompt(cleanPrompt),
    instrumental: body.instrumental,
    voiceProfile: body.voiceProfile,
  });

  const { modelUsed, result: composition } = await modelRouter.route(spec);
  const { buffer, sampleRate } = renderComposition(composition);
  const mastered = applyLimiter(normalize(buffer));
  const wav = encodeWav(mastered, sampleRate, 1);

  return { cleanPrompt, spec, modelUsed, composition, sampleRate, wav };
}

function sendGenerationResult(res, body, result) {
  if (body.format === 'wav') {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': result.wav.length });
    return res.end(result.wav);
  }
  sendJson(res, 200, {
    modelUsed: result.modelUsed,
    composition: result.composition,
    audio: { sampleRate: result.sampleRate, base64Wav: result.wav.toString('base64') },
  });
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
    const result = await runGeneration(body, modelRouter);

    compositionMemory.appendEvent(sessionId, { type: 'prompt', text: result.cleanPrompt, spec: result.spec });
    compositionMemory.appendEvent(sessionId, {
      type: 'generation',
      modelUsed: result.modelUsed,
      composition: result.composition,
    });
    sessionManager.update(sessionId, {});

    sendGenerationResult(res, body, result);
  }

  // Stateless counterpart of handleGenerate: no session/history, prompt in
  // and audio out in one call. This is what the WebUI/Netlify deployment
  // use, since serverless invocations don't reliably share in-memory state.
  async function handleGenerateStateless(req, res) {
    const body = await readJsonBody(req);
    const result = await runGeneration(body, modelRouter);
    sendGenerationResult(res, body, result);
  }

  // Analyzes one or more recorded voice samples (base64-encoded WAV) and
  // returns a pitch-range profile. This calibrates the synth's vocal range
  // to the speaker's real pitch — it is not neural voice cloning.
  async function handleVoiceProfile(req, res) {
    const body = await readJsonBody(req);
    const base64Samples = body.samples ?? (body.base64Wav ? [body.base64Wav] : []);
    if (!Array.isArray(base64Samples) || base64Samples.length === 0) {
      return sendJson(res, 400, { error: 'at least one base64-encoded WAV sample is required' });
    }

    const analyses = base64Samples.map((base64Wav) => {
      const { samples, sampleRate } = decodeWav(Buffer.from(base64Wav, 'base64'));
      return analyzeVoiceSample(samples, sampleRate);
    });

    const voiceProfile = buildVoiceProfile(analyses);
    sendJson(res, 200, { voiceProfile });
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
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'generate' && parts.length === 2) {
        return await handleGenerateStateless(req, res);
      }
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'voice-profile' && parts.length === 2) {
        return await handleVoiceProfile(req, res);
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
