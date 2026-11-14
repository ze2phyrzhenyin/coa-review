/**
 * 可选的轻微音效：翻片、合盖、撞车、扣上。用 WebAudio 现场合成，不带音频文件。
 * 默认关，开关在播放器上，选择记在这台设备的浏览器里。这个文件不引用 three.js。
 */
export type SoundName = 'flip' | 'latch' | 'crash' | 'click' | 'thud';

const KEY = 'coa:sound';
const listeners = new Set<(on: boolean) => void>();
let context: AudioContext | null = null;
let last = 0;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSound(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // 存不了就只在这一页有效。
  }
  for (const listener of listeners) listener(on);
  if (on) ensure();
}

export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensure(): AudioContext | null {
  if (typeof AudioContext !== 'function') return null;
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** 一小段噪声，经带通滤波，短促衰减：像木片、塑料片碰在一起。 */
function knock(ctx: AudioContext, at: number, freq: number, length: number, gain: number): void {
  const frames = Math.max(1, Math.round(ctx.sampleRate * length));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 2.2;
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(filter).connect(level).connect(ctx.destination);
  source.start(at);
}

/** 放一个音效。没打开、浏览器不支持、同一时刻已经响过时不响。 */
export function play(name: SoundName): void {
  if (!soundOn()) return;
  const ctx = ensure();
  if (!ctx) return;
  const now = ctx.currentTime;
  // 一排位片一起翻时只响一下。
  if (name === 'flip' && now - last < 0.06) return;
  last = now;
  switch (name) {
    case 'flip':
      knock(ctx, now, 2600, 0.03, 0.12);
      break;
    case 'click':
      knock(ctx, now, 3200, 0.025, 0.16);
      break;
    case 'latch':
      knock(ctx, now, 1500, 0.04, 0.22);
      knock(ctx, now + 0.05, 2400, 0.03, 0.12);
      break;
    case 'thud':
      knock(ctx, now, 420, 0.09, 0.3);
      break;
    case 'crash':
      knock(ctx, now, 900, 0.16, 0.34);
      knock(ctx, now + 0.03, 3400, 0.1, 0.16);
      break;
  }
}
