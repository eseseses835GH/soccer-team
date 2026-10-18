// Goal celebration sound: a synthesized crowd roar + air horn (Web Audio), and a Hebrew
// "announcer" through speechSynthesis. No audio files. Everything starts inside the tap
// handler, because iOS only lets a user gesture unlock audio and speech.

import type { GoalSound } from '../state/model';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let noise: AudioBuffer | null = null;
let current: { out: GainNode; ends: number } | null = null;
let speaking = false;

/** The shared AudioContext, created/resumed on demand. Call from a user gesture. */
function audio(): Ctx | null {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      // Older iOS unlocks only once something has played inside the gesture.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 4 s of pink noise (warmer than white, closer to a crowd), made once. */
function pinkNoise(c: Ctx): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const len = Math.floor(c.sampleRate * 4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    // Paul Kellet's pink filter.
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return (noise = buf);
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Swell → hold → a natural (exponential-decay) fade over about `release` seconds. */
function envelope(g: AudioParam, t0: number, peak: number, attack: number, hold: number, release: number) {
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + attack);
  g.setValueAtTime(peak, t0 + attack + hold);
  g.setTargetAtTime(0, t0 + attack + hold, release / 4);
}

/** Crowd: filtered noise (the roar) + a choir of detuned "aaah" voices through vowel formants. */
function crowd(c: Ctx, out: AudioNode, t0: number): number {
  const ends = t0 + 3.6;

  // The roar: two noise bands, the low one swelling a bit slower.
  const bands: [number, number, number, number][] = [
    // freq, Q, peak, attack
    [520, 0.7, 1.5, 0.5],
    [1700, 0.9, 0.8, 0.35],
    [3800, 1.2, 0.2, 0.3],
  ];
  for (const [freq, q, peak, attack] of bands) {
    const src = c.createBufferSource();
    src.buffer = pinkNoise(c);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq * 0.8, t0);
    bp.frequency.linearRampToValueAtTime(freq, t0 + 0.6); // the crowd "opens up"
    bp.Q.value = q;
    const g = c.createGain();
    envelope(g.gain, t0, peak, attack, 1.1, 2.0);
    src.connect(bp).connect(g).connect(out);
    src.start(t0, rand(0, 3));
    src.stop(ends);
  }

  // The voices: many people shouting "aaah" a little out of tune, rising with excitement.
  const vowel = c.createGain();
  vowel.gain.value = 1;
  const formants: [number, number, number][] = [
    [780, 6, 1],
    [1180, 7, 0.7],
    [2500, 9, 0.25],
  ];
  const mix = c.createGain();
  mix.gain.value = 0.8;
  for (const [f, q, gain] of formants) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    vowel.connect(bp).connect(g).connect(mix);
  }
  mix.connect(out);

  const VOICES = 16;
  for (let i = 0; i < VOICES; i++) {
    const low = i % 3 !== 0; // two thirds men, one third higher voices
    const base = low ? rand(150, 260) : rand(300, 470);
    const start = t0 + rand(0, 0.35);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.86, start);
    o.frequency.exponentialRampToValueAtTime(base * rand(1.05, 1.18), start + rand(0.45, 0.8));
    o.frequency.exponentialRampToValueAtTime(base * 0.9, ends);
    // Vibrato, each voice its own.
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(4.5, 7);
    const depth = c.createGain();
    depth.gain.value = base * rand(0.01, 0.025);
    lfo.connect(depth).connect(o.frequency);
    const g = c.createGain();
    envelope(g.gain, start, rand(0.04, 0.08), rand(0.25, 0.45), rand(0.8, 1.3), rand(1.2, 1.8));
    // Each shouter's loudness wobbles on its own: that's what makes a choir sound like a crowd.
    const wobble = c.createGain();
    wobble.gain.value = 0.7;
    const trem = c.createOscillator();
    trem.frequency.value = rand(2, 6);
    const tremDepth = c.createGain();
    tremDepth.gain.value = rand(0.2, 0.35);
    trem.connect(tremDepth).connect(wobble.gain);
    o.connect(g).connect(wobble).connect(vowel);
    for (const n of [o, lfo, trem]) {
      n.start(start);
      n.stop(ends);
    }
  }
  return ends;
}

/** Stadium air horn: two blasts, "baap … baaaap". */
function airHorn(c: Ctx, out: AudioNode, t0: number) {
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    curve[i] = Math.tanh(2.5 * x);
  }
  shaper.curve = curve;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  const g = c.createGain();
  g.gain.value = 0;
  shaper.connect(lp).connect(g).connect(out);

  const blasts: [number, number][] = [
    [0.02, 0.22],
    [0.34, 0.75],
  ];
  for (const [at, len] of blasts) {
    const s = t0 + at;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.28, s + 0.025);
    g.gain.setValueAtTime(0.28, s + len - 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, s + len);
  }
  // Three reeds slightly apart; the pitch dips at the start of each blast like a real horn.
  for (const f of [466, 470, 587]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    for (const [at] of blasts) {
      o.frequency.setValueAtTime(f * 0.9, t0 + at);
      o.frequency.exponentialRampToValueAtTime(f, t0 + at + 0.07);
    }
    const og = c.createGain();
    og.gain.value = 0.3;
    o.connect(og).connect(shaper);
    o.start(t0);
    o.stop(t0 + 1.2);
  }
}

/** Stop whatever celebration is playing (quick fade, no click). */
export function stopCelebration() {
  if (ctx && current && current.ends > ctx.currentTime) {
    const g = current.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
  }
  current = null;
  try {
    if (speaking) window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  speaking = false;
}

// ---------- announcer ----------

/** Prefer a real Hebrew voice; `null` = none listed. */
export function pickHebrewVoice<V extends { lang: string; localService?: boolean }>(voices: readonly V[]): V | null {
  const he = voices.filter((v) => /^(he|iw)([-_]|$)/i.test(v.lang));
  return he.find((v) => v.localService) ?? he[0] ?? null;
}

/** What the announcer shouts. The niqqud stretches the vowel: "Goooal! Goal for the reds!" */
export function announcerText(teamName: string): string {
  return `גוֹוֹוֹל! גוֹל ל${teamName}!`;
}

/** Ask for the voice list early: Chrome fills it asynchronously. */
export function primeVoices() {
  try {
    window.speechSynthesis?.getVoices();
  } catch {
    /* ignore */
  }
}

function announce(teamName: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    const voices = synth.getVoices();
    const voice = pickHebrewVoice(voices);
    // Voices are listed but none is Hebrew: a foreign voice reading Hebrew sounds broken, so stay quiet.
    if (voices.length && !voice) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(announcerText(teamName));
    u.lang = 'he-IL';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 1.3;
    u.volume = 1;
    u.onend = u.onerror = () => {
      speaking = false;
    };
    speaking = true;
    synth.speak(u);
  } catch {
    /* no speech */
  }
}

/** Celebrate a goal: call straight from the tap handler. */
export function celebrateGoal(sound: GoalSound, teamName: string) {
  try {
    navigator.vibrate?.([70, 50, 70, 50, 160]);
  } catch {
    /* ignore */
  }
  if (sound === 'off') return;
  stopCelebration();
  const c = audio();
  if (c) {
    const t0 = c.currentTime + 0.02;
    const out = c.createGain();
    out.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    out.connect(comp).connect(c.destination);
    airHorn(c, out, t0);
    const ends = crowd(c, out, t0 + 0.08);
    current = { out, ends };
  }
  if (sound === 'all') announce(teamName);
}
