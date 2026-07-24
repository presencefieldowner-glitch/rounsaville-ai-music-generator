'use strict';

const http = require('node:http');
const { createLogger, createRateLimiter } = require('../../001_FOUNDATION/Utilities');
const { sanitizePrompt, validateSpec } = require('../../002_LLM_GATEWAY/Guardrails');
const { parsePrompt } = require('../../002_LLM_GATEWAY/PromptEngine');
const { createModelRouter } = require('../../002_LLM_GATEWAY/ModelRouter');
const { generateComposition } = require('../../004_COMPOSITION_AGENT/TrackGenerator');
const { createSessionManager } = require('../../004_COMPOSITION_AGENT/SessionManager');
const { createCompositionMemory } = require('../../004_COMPOSITION_AGENT/CompositionMemory');
const { renderComposition, interleaveStereo, encodeWav, decodeWav } = require('../../003_AUDIO_ENGINE/AudioRenderer');
const { normalizeStereo, applyLimiterStereo, applyReverbStereo } = require('../../003_AUDIO_ENGINE/MixMaster');
const { analyzeVoiceSample, buildVoiceProfile } = require('../../003_AUDIO_ENGINE/VoiceProfiler');

const logger = createLogger('REST_API', { level: 'warn' });

// Voice recordings are legitimately much bigger than a JSON prompt body
// (a few seconds of 16-bit PCM WAV, base64-encoded, per phrase), so the
// body-size cap is route-dependent rather than one global number.
const DEFAULT_MAX_BODY_BYTES = 200_000;
const VOICE_PROFILE_MAX_BODY_BYTES = 20_000_000;
const MAX_VOICE_SAMPLES = 10;
const MAX_VOICE_SAMPLE_BASE64_LENGTH = 8_000_000; // ~6MB decoded, well over a few seconds of 16-bit mono WAV

function readJsonBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) req.destroy(new Error('payload too large'));
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
  const parsedSpec = parsePrompt(cleanPrompt);
  // An explicit body.instrumental (from a UI toggle) wins; otherwise fall
  // back to whatever the prompt text itself said (see PromptEngine's
  // detectInstrumental), which can also be undefined.
  const spec = validateSpec({
    ...parsedSpec,
    instrumental: body.instrumental ?? parsedSpec.instrumental,
    voiceProfile: body.voiceProfile,
  });

  const { modelUsed, result: composition } = await modelRouter.route(spec);
  const { left, right, sampleRate } = renderComposition(composition);
  const reverberated = applyReverbStereo(left, right, sampleRate, composition.reverb);
  const normalized = normalizeStereo(reverberated.left, reverberated.right);
  const mastered = applyLimiterStereo(normalized.left, normalized.right);
  const wav = encodeWav(interleaveStereo(mastered.left, mastered.right), sampleRate, 2);

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
  // Only meaningful for this persistent process — a serverless deployment
  // (see netlify/functions/) doesn't share this in-memory bucket map
  // across invocations, so it isn't rate-limited by this mechanism.
  rateLimiter = createRateLimiter({ capacity: 20, refillPerSecond: 0.5 }),
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
    const body = await readJsonBody(req, { maxBytes: VOICE_PROFILE_MAX_BODY_BYTES });
    const base64Samples = body.samples ?? (body.base64Wav ? [body.base64Wav] : []);
    if (!Array.isArray(base64Samples) || base64Samples.length === 0) {
      return sendJson(res, 400, { error: 'at least one base64-encoded WAV sample is required' });
    }
    if (base64Samples.length > MAX_VOICE_SAMPLES) {
      return sendJson(res, 400, { error: `too many voice samples (max ${MAX_VOICE_SAMPLES})` });
    }
    const oversized = base64Samples.find((s) => typeof s !== 'string' || s.length > MAX_VOICE_SAMPLE_BASE64_LENGTH);
    if (oversized !== undefined) {
      return sendJson(res, 400, { error: 'a voice sample exceeds the maximum allowed size' });
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

    // Only the compute-heavy routes (composition rendering, voice
    // analysis) are rate-limited — health checks and session reads stay
    // unrestricted.
    const isRateLimitedRoute =
      req.method === 'POST' &&
      parts[0] === 'api' &&
      (parts[1] === 'generate' || parts[1] === 'voice-profile' || (parts[1] === 'sessions' && parts[3] === 'generate'));

    if (isRateLimitedRoute) {
      const clientKey = req.socket?.remoteAddress ?? 'unknown';
      const limit = rateLimiter.take(clientKey);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return sendJson(res, 429, { error: 'rate limit exceeded', retryAfterSeconds: limit.retryAfterSeconds });
      }
    }

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

module.exports = {
  createApp,
  startServer,
  readJsonBody,
  MAX_VOICE_SAMPLES,
  MAX_VOICE_SAMPLE_BASE64_LENGTH,
};
