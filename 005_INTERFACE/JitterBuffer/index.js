'use strict';

// A real jitter buffer + packet-loss concealment (PLC), the standard
// technique real-time audio/VoIP systems use to absorb network jitter and
// smooth over dropped packets — this is the honest, buildable version of
// vague "adaptive routing restitches packets, temporal echo smooths the
// response without cutting off the feed" language: sequence numbers, an
// initial buffering delay so out-of-order arrivals get reordered before
// they're needed, and concealment (repeat-and-fade the last good frame,
// degrading to silence rather than looping forever) for frames that never
// arrive in time. No ML, no "quantum" anything — delay-line buffering and
// simple signal fading, same as it's always been done.

function fadePayload(payload, factor) {
  const out = new Float32Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] * factor;
  return out;
}

function silence(length) {
  return new Float32Array(length);
}

// frameDurationMs: nominal duration each frame represents (informational —
//   callers use it to convert audio buffers into frames; the buffer itself
//   is duration-agnostic).
// targetDelayMs: how long to wait after the first frame arrives before
//   starting playout — this is the actual jitter-absorbing window. Frames
//   that arrive within it, even out of order, still get played in the
//   right sequence.
// maxConcealedFrames: how many consecutive missing frames to conceal by
//   repeating+fading the last good one before giving up and going silent,
//   rather than looping stale audio indefinitely.
function createJitterBuffer({ frameDurationMs = 20, targetDelayMs = 60, maxConcealedFrames = 5 } = {}) {
  const frames = new Map();
  let playoutSeq = null;
  let firstArrivalMs = null;
  let lastGoodPayload = null;
  let consecutiveConcealed = 0;

  const stats = { framesReceived: 0, framesConcealed: 0, framesLate: 0, framesSilenced: 0 };

  function push(seq, payload, arrivedAtMs) {
    stats.framesReceived += 1;
    if (firstArrivalMs === null) firstArrivalMs = arrivedAtMs;
    if (playoutSeq !== null && seq < playoutSeq) {
      // Arrived after its playout slot already passed — too late to use.
      stats.framesLate += 1;
      return { accepted: false, reason: 'late' };
    }
    frames.set(seq, payload);
    return { accepted: true };
  }

  // Call once per frameDurationMs "tick". Returns null while still inside
  // the initial buffering window (nothing to play yet), otherwise the
  // frame for the current playout sequence — real if it arrived in time,
  // concealed (faded repeat of the last good frame) if it didn't.
  function pull(nowMs) {
    if (firstArrivalMs === null) return null;
    if (nowMs < firstArrivalMs + targetDelayMs) return null;

    if (playoutSeq === null) {
      // First pull after the buffering window: start at the lowest
      // sequence number actually observed, not whichever frame happened
      // to arrive first — that's what makes out-of-order arrivals within
      // the window still play back correctly.
      playoutSeq = Math.min(...frames.keys());
    }

    const seq = playoutSeq;
    playoutSeq += 1;

    if (frames.has(seq)) {
      const payload = frames.get(seq);
      frames.delete(seq);
      lastGoodPayload = payload;
      consecutiveConcealed = 0;
      return { seq, payload, concealed: false };
    }

    stats.framesConcealed += 1;
    consecutiveConcealed += 1;

    if (lastGoodPayload && consecutiveConcealed <= maxConcealedFrames) {
      const fadeFactor = Math.max(0, 1 - consecutiveConcealed / (maxConcealedFrames + 1));
      return { seq, payload: fadePayload(lastGoodPayload, fadeFactor), concealed: true };
    }

    stats.framesSilenced += 1;
    return { seq, payload: silence(lastGoodPayload ? lastGoodPayload.length : 0), concealed: true, silenced: true };
  }

  return { push, pull, stats: () => ({ ...stats }), frameDurationMs, targetDelayMs };
}

module.exports = { createJitterBuffer, fadePayload, silence };
