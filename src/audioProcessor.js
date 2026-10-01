import encodeOgg from "@audio/encode-ogg";

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const GAIN_DB = -4;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Audio processing dibatalkan.");
    error.name = "AbortError";
    throw error;
  }
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function audioBufferToChannels(audioBuffer) {
  const channels = [];

  for (
    let channel = 0;
    channel < audioBuffer.numberOfChannels;
    channel++
  ) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  return channels;
}

async function renderAudio(audioBuffer, processingSpeed) {
  if (
    !Number.isFinite(processingSpeed) ||
    processingSpeed <= 0
  ) {
    throw new Error("Processing speed tidak valid.");
  }

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;

  const outputDuration =
    audioBuffer.duration / processingSpeed;

  const outputLength = Math.max(
    1,
    Math.ceil(outputDuration * sampleRate)
  );

  const offlineContext = new OfflineAudioContext(
    channels,
    outputLength,
    sampleRate
  );

  const source = offlineContext.createBufferSource();
  const gainNode = offlineContext.createGain();

  source.buffer = audioBuffer;

  /*
   * processingSpeed sudah dikonversi oleh App.jsx.
   *
   * Target Roblox 0.43 -> processing 2.325581x
   * Target Roblox 0.50 -> processing 2.000000x
   * Target Roblox 0.65 -> processing 1.538462x
   * Target Roblox 0.80 -> processing 1.250000x
   * Target Roblox 1.00 -> processing 1.000000x
   *
   * Nilai > 1 mempercepat audio.
   * Speed dan pitch bergerak bersama.
   */
  source.playbackRate.value = processingSpeed;

  gainNode.gain.value = dbToGain(GAIN_DB);

  source.connect(gainNode);
  gainNode.connect(offlineContext.destination);

  source.start(0);

  return await offlineContext.startRendering();
}

async function encodeToOgg(audioBuffer, quality) {
  const channelData =
    audioBufferToChannels(audioBuffer);

  const encoder = await encodeOgg({
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    quality,
  });

  const encoded = encoder.encode(channelData);
  const tail = encoder.flush();

  return new Blob(
    [encoded, tail],
    {
      type: "audio/ogg",
    }
  );
}

export async function processAudio(
  file,
  processingSpeed,
  onProgress,
  options = {}
) {
  const signal = options?.signal;
  throwIfAborted(signal);

  if (!file) {
    throw new Error("Audio file belum dipilih.");
  }

  if (
    !Number.isFinite(processingSpeed) ||
    processingSpeed <= 0
  ) {
    throw new Error("Processing speed tidak valid.");
  }

  onProgress?.(5);

  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);

  onProgress?.(15);

  let audioContext = null;

  try {
    audioContext = new AudioContext();

    const audioBuffer =
      await audioContext.decodeAudioData(
        arrayBuffer.slice(0)
      );

    throwIfAborted(signal);
    onProgress?.(30);

    const renderedBuffer =
      await renderAudio(
        audioBuffer,
        processingSpeed
      );

    throwIfAborted(signal);
    onProgress?.(65);

    /*
     * Coba quality tinggi terlebih dahulu.
     * Jika hasil lebih dari 20 MB,
     * coba quality yang lebih rendah.
     */
    const qualities = [5, 3, 1, 0];

    let finalBlob = null;

    for (
      let index = 0;
      index < qualities.length;
      index++
    ) {
      const quality = qualities[index];

      throwIfAborted(signal);

      const blob = await encodeToOgg(
        renderedBuffer,
        quality
      );

      const encodeProgress =
        65 +
        Math.round(
          ((index + 1) /
            qualities.length) *
            30
        );

      onProgress?.(encodeProgress);

      throwIfAborted(signal);

      if (blob.size <= MAX_OUTPUT_BYTES) {
        finalBlob = blob;
        break;
      }
    }

    if (!finalBlob) {
      throw new Error(
        "Output masih lebih dari 20 MB. Coba gunakan audio yang lebih pendek."
      );
    }

    onProgress?.(100);

    return {
      blob: finalBlob,
      size: finalBlob.size,
      duration: renderedBuffer.duration,
      originalName: file.name,
    };
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Ignore close errors.
      }
    }
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

export function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const mb = bytes / 1024 / 1024;

  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`;
  }

  return `${Math.max(
    1,
    Math.round(bytes / 1024)
  )} KB`;
}
