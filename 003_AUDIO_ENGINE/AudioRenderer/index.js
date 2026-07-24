'use strict';

const { synthesizeNote } = require('../SynthEngine');

// Renders a Composition (from 001_FOUNDATION/Types) into a mono Float32
// buffer, and encodes that buffer as a real, playable 16-bit PCM WAV file.

function secondsPerBeat(tempo) {
  return 60 / tempo;
}

function renderComposition(composition, { sampleRate = 44100 } = {}) {
  const beatSeconds = secondsPerBeat(composition.tempo);
  const [beatsPerBar] = composition.timeSignature ?? [4, 4];
  const totalSeconds = composition.bars * beatsPerBar * beatSeconds + 1; // +1s tail for release
  const totalSamples = Math.ceil(totalSeconds * sampleRate);
  const buffer = new Float32Array(totalSamples);

  for (const track of composition.tracks) {
    const trackGain = track.gain ?? 0.8;
    for (const note of track.notes) {
      const startSample = Math.round(note.start * beatSeconds * sampleRate);
      const rendered = synthesizeNote(
        { ...note, duration: note.duration * beatSeconds },
        sampleRate,
        track.waveform
      );
      for (let i = 0; i < rendered.length; i += 1) {
        const idx = startSample + i;
        if (idx < buffer.length) buffer[idx] += rendered[i] * trackGain;
      }
    }
  }

  return { buffer, sampleRate };
}

function floatTo16BitPCM(float32Samples) {
  const out = new Int16Array(float32Samples.length);
  for (let i = 0; i < float32Samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav(float32Samples, sampleRate, numChannels = 1) {
  const pcm = floatTo16BitPCM(float32Samples);
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i += 1) {
    buffer.writeInt16LE(pcm[i], 44 + i * bytesPerSample);
  }

  return buffer;
}

// Parses a RIFF/WAVE buffer (8 or 16-bit PCM) into mono Float32 samples in
// [-1, 1], walking chunks rather than assuming a fixed 44-byte header since
// browser-produced WAV files can include extra chunks. Multi-channel audio
// is downmixed to mono by averaging.
function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE buffer');
  }

  let fmt = null;
  let dataStart = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(bodyStart),
        numChannels: buffer.readUInt16LE(bodyStart + 2),
        sampleRate: buffer.readUInt32LE(bodyStart + 4),
        bitsPerSample: buffer.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === 'data') {
      dataStart = bodyStart;
      dataSize = chunkSize;
    }

    offset = bodyStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (!fmt || dataStart === -1) throw new Error('WAV buffer missing fmt or data chunk');
  if (fmt.bitsPerSample !== 16 && fmt.bitsPerSample !== 8) {
    throw new Error(`unsupported bits per sample: ${fmt.bitsPerSample}`);
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / bytesPerSample / fmt.numChannels);
  const mono = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < fmt.numChannels; ch += 1) {
      const sampleOffset = dataStart + (i * fmt.numChannels + ch) * bytesPerSample;
      if (fmt.bitsPerSample === 16) {
        sum += buffer.readInt16LE(sampleOffset) / 32768;
      } else {
        sum += (buffer.readUInt8(sampleOffset) - 128) / 128;
      }
    }
    mono[i] = sum / fmt.numChannels;
  }

  return { samples: mono, sampleRate: fmt.sampleRate, numChannels: fmt.numChannels };
}

module.exports = { renderComposition, encodeWav, decodeWav, floatTo16BitPCM, secondsPerBeat };
