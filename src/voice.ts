export const MAX_VOICE_MS = 3 * 60 * 1000;
export const MIN_VOICE_MS = 400;

const VOICE_RATE = 22_050;

export function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const VOICE_NAME = /^voice\.(wav|webm|ogg|m4a|mp3)$/i;

export function isVoiceFile(file: { name: string }): boolean {
  return VOICE_NAME.test(file.name.trim());
}

export function voicePreview(name: string): string | null {
  return isVoiceFile({ name }) ? "Голосовое сообщение" : null;
}

export function voiceFileName(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.includes("wav")) return "voice.wav";
  if (base.includes("ogg")) return "voice.ogg";
  if (base.includes("mp4") || base.includes("m4a") || base.includes("aac")) return "voice.m4a";
  if (base.includes("mpeg")) return "voice.mp3";
  if (base.includes("webm")) return "voice.webm";
  return "voice.webm";
}

export function preferredAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

export async function toVoiceWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const mixed = resample(mono(decoded), decoded.sampleRate, VOICE_RATE);
    return new Blob([encodeWav(mixed, VOICE_RATE)], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

function mono(buffer: AudioBuffer): Float32Array {
  const mixed = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) mixed[index] += data[index] / channels;
  }
  return mixed;
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const length = Math.max(1, Math.round((input.length * to) / from));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index * from) / to;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
