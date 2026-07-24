'use strict';

// A real phase vocoder: STFT analysis, phase-unwrapping to track each
// bin's true instantaneous frequency, phase accumulation at a different
// hop size for time-stretching, and overlap-add resynthesis. Pitch
// shifting is the standard technique built on top of it (stretch, then
// resample back to the original duration). This is the honest, buildable
// version of "retroactively phase-correct an active audio stream" /
// "manipulate, pitch-bend... without massive computational overhead" —
// real DSP (Cooley-Tukey FFT included, since nothing else in this repo
// needed a full FFT yet), not a fabricated capability.

// Iterative radix-2 Cooley-Tukey FFT, in place. `re`/`im` must have a
// power-of-2 length.
function fft(re, im) {
  const n = re.length;
  if (n & (n - 1)) throw new Error('fft: length must be a power of 2');

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len / 2;
    const angleStep = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angleStep);
    const wStepIm = Math.sin(angleStep);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k += 1) {
        const evenRe = re[i + k];
        const evenIm = im[i + k];
        const oddRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const oddIm = re[i + k + half] * curIm + im[i + k + half] * curRe;

        re[i + k] = evenRe + oddRe;
        im[i + k] = evenIm + oddIm;
        re[i + k + half] = evenRe - oddRe;
        im[i + k + half] = evenIm - oddIm;

        const nextRe = curRe * wStepRe - curIm * wStepIm;
        const nextIm = curRe * wStepIm + curIm * wStepRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i += 1) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i += 1) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function hannWindow(size) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

function wrapPhase(phase) {
  return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
}

// Time-stretches `samples` by `stretchFactor` (2 = twice as long, 0.5 =
// half as long) while preserving pitch. frameSize must be a power of 2;
// hopSize is the analysis hop (75% overlap, i.e. hopSize = frameSize/4,
// is the classic choice for a Hann window and is the default).
function timeStretch(samples, sampleRate, stretchFactor, { frameSize = 1024, hopSize = frameSize / 4 } = {}) {
  if (frameSize & (frameSize - 1)) throw new Error('frameSize must be a power of 2');
  if (!(stretchFactor > 0)) throw new Error('stretchFactor must be > 0');

  const window = hannWindow(frameSize);
  const analysisHop = Math.round(hopSize);
  const synthesisHop = Math.max(1, Math.round(hopSize * stretchFactor));
  const bins = frameSize / 2 + 1;

  const numFrames = Math.max(1, Math.floor((samples.length - frameSize) / analysisHop) + 1);
  const outputLength = synthesisHop * (numFrames - 1) + frameSize;
  const output = new Float64Array(outputLength);
  const windowEnergy = new Float64Array(outputLength);

  const lastPhase = new Float64Array(bins);
  const sumPhase = new Float64Array(bins);
  const expectedAdvance = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) expectedAdvance[k] = (2 * Math.PI * analysisHop * k) / frameSize;

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * analysisHop;
    const re = new Float64Array(frameSize);
    const im = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i += 1) {
      const sample = start + i < samples.length ? samples[start + i] : 0;
      re[i] = sample * window[i];
    }
    fft(re, im);

    const outRe = new Float64Array(frameSize);
    const outIm = new Float64Array(frameSize);

    for (let k = 0; k < bins; k += 1) {
      const magnitude = Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);

      const phaseDiff = wrapPhase(phase - lastPhase[k] - expectedAdvance[k]);
      lastPhase[k] = phase;
      const trueFreqPerSample = (expectedAdvance[k] + phaseDiff) / analysisHop;

      if (frame === 0) {
        sumPhase[k] = phase;
      } else {
        sumPhase[k] += trueFreqPerSample * synthesisHop;
      }

      outRe[k] = magnitude * Math.cos(sumPhase[k]);
      outIm[k] = magnitude * Math.sin(sumPhase[k]);
      if (k > 0 && k < frameSize - k) {
        outRe[frameSize - k] = outRe[k];
        outIm[frameSize - k] = -outIm[k];
      }
    }

    ifft(outRe, outIm);

    const outStart = frame * synthesisHop;
    for (let i = 0; i < frameSize; i += 1) {
      const idx = outStart + i;
      if (idx < output.length) {
        output[idx] += outRe[i] * window[i];
        windowEnergy[idx] += window[i] * window[i];
      }
    }
  }

  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    result[i] = windowEnergy[i] > 1e-6 ? output[i] / windowEnergy[i] : output[i];
  }
  return result;
}

function resampleLinear(samples, outputLength) {
  const out = new Float32Array(outputLength);
  if (samples.length === 0 || outputLength === 0) return out;
  const scale = (samples.length - 1) / Math.max(1, outputLength - 1);
  for (let i = 0; i < outputLength; i += 1) {
    const srcPos = i * scale;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const s0 = samples[i0] ?? 0;
    const s1 = samples[Math.min(samples.length - 1, i0 + 1)] ?? 0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

// Shifts pitch by `semitones` while keeping duration constant: stretch by
// 2^(semitones/12) (changes duration, keeps pitch), then resample back to
// the original length (changes pitch by the same ratio, restores
// duration). The standard phase-vocoder pitch-shift technique.
function pitchShift(samples, sampleRate, semitones, options = {}) {
  const ratio = 2 ** (semitones / 12);
  const stretched = timeStretch(samples, sampleRate, ratio, options);
  return resampleLinear(stretched, samples.length);
}

module.exports = {
  fft,
  ifft,
  nextPowerOfTwo,
  hannWindow,
  wrapPhase,
  timeStretch,
  resampleLinear,
  pitchShift,
};
