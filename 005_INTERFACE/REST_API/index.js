'use strict';

const http = require('node:http');
const { createLogger, createRateLimiter } = require('../../001_FOUNDATION/Utilities');
const { createSessionManager } = require('../../004_COMPOSITION_AGENT/SessionManager');
const { createCompositionMemory } = require('../../004_COMPOSITION_AGENT/CompositionMemory');
const {
  defaultModelRouter,
  runGeneration,
  generateLyricsForPrompt,
  analyzeVoiceSamples,
  MAX_VOICE_SAMPLES,
  MAX_VOICE_SAMPLE_BASE64_LENGTH,
} = require('../../004_COMPOSITION_AGENT/GenerationPipeline');

const logger = createLogger('REST_API', { level: 'warn' });

// Voice recordings are legitimately much bigger than a JSON prompt body
// (a few seconds of 16-bit PCM WAV, base64-encoded, per phrase), so the
// body-size cap is route-dependent rather than one global number.
const DEFAULT_MAX_BODY_BYTES = 200_000;
const VOICE_PROFILE_MAX_BODY_BYTES = 20_000_000;

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

function sendGenerationResult(res, body, result) {
  if (body.format === 'wav') {
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': result.wav.length,
      'X-Generation-Seed': String(result.seed),
    });
    return res.end(result.wav);
  }
  sendJson(res, 200, {
    modelUsed: result.modelUsed,
    composition: result.composition,
    seed: result.seed,
    lyrics: result.lyrics,
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

  // Fast, audio-free lyrics preview: parses the prompt and generates
  // lyrics text plus the derived voice-recording phrases, without
  // rendering any audio. Real template + rhyme-family generation (see
  // 002_LLM_GATEWAY/LyricsEngine), not an LLM — and the words it returns
  // are never sung by the audio pipeline; there's no text-to-singing-
  // voice synthesis here, and recording the derived phrases only
  // calibrates pitch range, not voice timbre.
  async function handleLyrics(req, res) {
    const body = await readJsonBody(req);
    const result = generateLyricsForPrompt(body);
    sendJson(res, 200, { seed: result.seed, lyrics: result.lyrics, recordingPhrases: result.recordingPhrases });
  }

  // Analyzes one or more recorded voice samples (base64-encoded WAV) and
  // returns a pitch-range profile. This calibrates the synth's vocal range
  // to the speaker's real pitch — it is not neural voice cloning.
  async function handleVoiceProfile(req, res) {
    const body = await readJsonBody(req, { maxBytes: VOICE_PROFILE_MAX_BODY_BYTES });
    const base64Samples = body.samples ?? (body.base64Wav ? [body.base64Wav] : []);
    const voiceProfile = analyzeVoiceSamples(base64Samples); // throws -> caught below -> 400
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
      (parts[1] === 'generate' ||
        parts[1] === 'voice-profile' ||
        parts[1] === 'lyrics' ||
        (parts[1] === 'sessions' && parts[3] === 'generate'));

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
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'lyrics' && parts.length === 2) {
        return await handleLyrics(req, res);
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
