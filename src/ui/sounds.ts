// Match sounds, synthesized with Web Audio (no audio files): a referee's pea whistle at
// kick-off and full time, and a stadium air horn for goals. iOS only lets a user gesture
// unlock audio, so the shared AudioContext is created/resumed on taps; the time-up whistle
// (no tap) relies on that and reports when it couldn't play, so the caller can fall back.

import type { GoalSound } from '../state/model';

type Ctx = BaseAudioContext;

let ctx: AudioContext | null = null;
let current: { out: GainNode; ends: number } | null = null;

/** The shared AudioContext, created/resumed on demand. Call from a user gesture. */
export function unlockAudio(): AudioContext | null {
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
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Unlock audio on the next tap anywhere (for a match screen opened after a reload, where the
 * first sound might be the time-up whistle, which has no tap of its own). Returns a cleanup.
 */
export function unlockOnNextTap(): () => void {
  const on = () => {
    unlockAudio();
    if (ctx?.state === 'running') off();
  };
  const off = () => {
    window.removeEventListener('pointerdown', on, true);
    window.removeEventListener('touchend', on, true);
  };
  window.addEventListener('pointerdown', on, true);
  window.addEventListener('touchend', on, true);
  return off;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function noiseBuffer(c: Ctx, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Output stage: master gain → a gentle limiter so nothing clips. */
function outStage(c: Ctx, dest: AudioNode, level: number): GainNode {
  const out = c.createGain();
  out.gain.value = level;
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -4;
  lim.knee.value = 2;
  lim.ratio.value = 16;
  lim.attack.value = 0.002;
  lim.release.value = 0.08;
  out.connect(lim).connect(dest);
  return out;
}

// ---------- air horn ----------

/** Blasts of the goal horn: [start, length] in seconds. A short toot, then a long blast. */
export const HORN_BLASTS: readonly [number, number][] = [
  [0, 0.3],
  [0.42, 1.15],
];

/**
 * A stadium air horn: three brass reeds tuned to a slightly sour chord (the classic handheld
 * horn sound), each two detuned sawtooths plus a square for the reedy buzz. The pitch scoops up
 * at the start of each blast and sags a little at the end as the pressure drops. Then soft
 * saturation (the overdriven little trumpet) and a horn-bell formant.
 * Returns when it ends.
 */
export function airHorn(c: Ctx, dest: AudioNode, t0: number): number {
  const ends = t0 + HORN_BLASTS[HORN_BLASTS.length - 1][0] + HORN_BLASTS[HORN_BLASTS.length - 1][1] + 0.05;

  const pre = c.createGain(); // drive into the saturator
  pre.gain.value = 1;
  const shaper = c.createWaveShaper();
  const N = 1024;
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    // Slightly asymmetric soft clip: adds the even harmonics a real horn has.
    curve[i] = Math.tanh(2.2 * x + 0.25 * x * x);
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  const hp = c.createBiquadFilter(); // removes the DC from the asymmetry and any rumble
  hp.type = 'highpass';
  hp.frequency.value = 180;
  hp.Q.value = 0.7;
  const bell = c.createBiquadFilter(); // the bell's main resonance
  bell.type = 'peaking';
  bell.frequency.value = 1350;
  bell.Q.value = 1.4;
  bell.gain.value = 7;
  const bite = c.createBiquadFilter(); // the nasal "blare"
  bite.type = 'peaking';
  bite.frequency.value = 2900;
  bite.Q.value = 2;
  bite.gain.value = 4;
  const lp = c.createBiquadFilter(); // no fizz on phone speakers
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  lp.Q.value = 0.6;
  const env = c.createGain();
  env.gain.value = 0;
  const post = c.createGain(); // the bell filters boost ~+7 dB: bring it back under full scale
  post.gain.value = 0.36;
  pre.connect(shaper).connect(hp).connect(bell).connect(bite).connect(lp).connect(post).connect(env).connect(dest);

  for (const [at, len] of HORN_BLASTS) {
    const s = t0 + at;
    env.gain.setValueAtTime(0, s);
    env.gain.linearRampToValueAtTime(1, s + 0.018);
    env.gain.setTargetAtTime(0.82, s + 0.03, 0.06); // the initial blat settles
    env.gain.setValueAtTime(0.82, s + len - 0.07);
    env.gain.linearRampToValueAtTime(0, s + len);
  }

  // Reeds: roughly F#4 / A#4 / C#5 pulled a bit apart, plus slow beating between the pairs.
  const reeds: [number, number][] = [
    // frequency, level
    [372, 0.34],
    [466, 0.3],
    [557, 0.22],
  ];
  // Shared wobble: the air pressure isn't perfectly steady.
  const wobble = c.createOscillator();
  wobble.frequency.value = 5.3;
  const wobbleDepth = c.createGain();
  wobbleDepth.gain.value = 0.004; // relative; scaled per reed below
  wobble.connect(wobbleDepth);
  wobble.start(t0);
  wobble.stop(ends);

  for (const [f, level] of reeds) {
    for (const [type, detune, part] of [
      ['sawtooth', -6, 0.5],
      ['sawtooth', 7, 0.5],
      ['square', 0, 0.28],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.detune.value = detune;
      for (const [at, len] of HORN_BLASTS) {
        const s = t0 + at;
        o.frequency.setValueAtTime(f * 0.86, s);
        o.frequency.exponentialRampToValueAtTime(f * 1.01, s + 0.07);
        o.frequency.exponentialRampToValueAtTime(f, s + 0.14);
        o.frequency.setValueAtTime(f, s + len - 0.12);
        o.frequency.exponentialRampToValueAtTime(f * 0.97, s + len);
      }
      const w = c.createGain();
      w.gain.value = f; // wobble depth in Hz = 0.4% of the pitch
      wobbleDepth.connect(w).connect(o.frequency);
      const g = c.createGain();
      g.gain.value = level * part;
      o.connect(g).connect(pre);
      o.start(t0);
      o.stop(ends);
    }
  }
  return ends;
}

// ---------- referee whistle ----------

/** Whistle patterns: [start, length] in seconds. */
export const WHISTLES = {
  /** Kick-off: a short pip and a long blast. */
  start: [
    [0, 0.16],
    [0.3, 0.75],
  ],
  /** Full time: short, short, long. */
  end: [
    [0, 0.2],
    [0.36, 0.2],
    [0.72, 1.05],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;
export type WhistleKind = keyof typeof WHISTLES;

/**
 * A pea whistle (the Acme Thunderer kind): a ~3 kHz tone whose pitch and loudness the rattling
 * pea chops ~25–35 times a second, irregularly; plus breath noise around the same pitch.
 * Sharp attack with a small upward pitch flick, quick release with a small drop.
 */
export function whistle(c: Ctx, dest: AudioNode, t0: number, kind: WhistleKind): number {
  const blasts = WHISTLES[kind];
  const last = blasts[blasts.length - 1];
  const ends = t0 + last[0] + last[1] + 0.06;
  const f = rand(2950, 3150);

  const env = c.createGain();
  env.gain.value = 0;
  for (const [at, len] of blasts) {
    const s = t0 + at;
    env.gain.setValueAtTime(0, s);
    env.gain.linearRampToValueAtTime(1, s + 0.008);
    env.gain.setTargetAtTime(0.85, s + 0.01, 0.05);
    env.gain.setValueAtTime(0.85, s + len - 0.035);
    env.gain.linearRampToValueAtTime(0, s + len);
  }
  // The pea: amplitude chop (tremolo) goes after the envelope.
  const chop = c.createGain();
  chop.gain.value = 0.62;
  env.connect(chop).connect(dest);

  // Pea modulators: a ~28 Hz rattle plus a slower irregular one (filtered noise).
  const pea = c.createOscillator();
  pea.type = 'triangle';
  pea.frequency.value = rand(26, 31);
  const peaJitter = c.createOscillator();
  peaJitter.frequency.value = 3.1;
  const peaJitterDepth = c.createGain();
  peaJitterDepth.gain.value = 4; // the rattle rate wanders ±4 Hz
  peaJitter.connect(peaJitterDepth).connect(pea.frequency);
  const rough = c.createBufferSource();
  rough.buffer = noiseBuffer(c, 2);
  rough.loop = true;
  const roughLp = c.createBiquadFilter();
  roughLp.type = 'lowpass';
  roughLp.frequency.value = 45;
  rough.connect(roughLp);
  // Tremolo: ±0.38 around 0.62 → the tone dips to a quarter at the bottom of each rattle.
  const tremDepth = c.createGain();
  tremDepth.gain.value = 0.38;
  pea.connect(tremDepth).connect(chop.gain);
  for (const n of [pea, peaJitter]) {
    n.start(t0);
    n.stop(ends);
  }
  rough.start(t0);
  rough.stop(ends);

  // Tone: fundamental + a little 2nd and 3rd harmonic, all following the pea's FM.
  const tone = c.createGain();
  tone.gain.value = 1;
  tone.connect(env);
  for (const [h, level] of [
    [1, 0.5],
    [2, 0.07],
    [3, 0.025],
  ] as const) {
    const o = c.createOscillator();
    o.type = 'sine';
    for (const [at, len] of blasts) {
      const s = t0 + at;
      o.frequency.setValueAtTime(f * h * 0.93, s);
      o.frequency.exponentialRampToValueAtTime(f * h, s + 0.025);
      o.frequency.setValueAtTime(f * h, s + len - 0.04);
      o.frequency.exponentialRampToValueAtTime(f * h * 0.95, s + len);
    }
    const fm = c.createGain();
    fm.gain.value = 110 * h; // ±110 Hz trill
    pea.connect(fm).connect(o.frequency);
    const fm2 = c.createGain();
    fm2.gain.value = 260 * h; // slow irregular drift from the filtered noise
    roughLp.connect(fm2).connect(o.frequency);
    const g = c.createGain();
    g.gain.value = level;
    o.connect(g).connect(tone);
    o.start(t0);
    o.stop(ends);
  }

  // Breath: noise focused around the whistle pitch, plus a little airy hiss.
  const breath = c.createBufferSource();
  breath.buffer = noiseBuffer(c, 2);
  breath.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = 5;
  const bpg = c.createGain();
  bpg.gain.value = 0.22;
  const hiss = c.createBiquadFilter();
  hiss.type = 'highpass';
  hiss.frequency.value = 5500;
  const hissg = c.createGain();
  hissg.gain.value = 0.025;
  breath.connect(bp).connect(bpg).connect(env);
  breath.connect(hiss).connect(hissg).connect(env);
  breath.start(t0);
  breath.stop(ends);
  return ends;
}

// ---------- playing on the phone ----------

const HORN_LEVEL = 1;
const WHISTLE_LEVEL = 1.2;

/** Stop whatever is playing (quick fade, no click). */
export function stopSounds() {
  if (ctx && current && current.ends > ctx.currentTime) {
    const g = current.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
  }
  current = null;
}

function play(level: number, make: (c: Ctx, out: AudioNode, t0: number) => number) {
  const c = unlockAudio();
  if (!c || c.state === 'closed') return;
  stopSounds();
  const t0 = c.currentTime + 0.02;
  const out = outStage(c, c.destination, level);
  current = { out, ends: make(c, out, t0) };
}

/** Goal: vibration + the air horn. Call straight from the tap handler. */
export function celebrateGoal(sound: GoalSound) {
  try {
    navigator.vibrate?.([70, 50, 70, 50, 160]);
  } catch {
    /* ignore */
  }
  if (sound === 'off') return;
  play(HORN_LEVEL, airHorn);
}

/**
 * Referee whistle. `fromTap` = called inside a tap handler (which may unlock audio itself).
 * Without a tap (the time-up whistle) it only plays when audio is already running, because a
 * suspended context would hold the whistle until some later tap. Returns whether it sounded,
 * so the caller can fall back to vibration and whistle on the next tap instead.
 */
export function playWhistle(sound: GoalSound, kind: WhistleKind, fromTap = true): boolean {
  if (sound === 'off') return false;
  if (!fromTap && ctx?.state !== 'running') return false;
  play(WHISTLE_LEVEL, (c, out, t0) => whistle(c, out, t0, kind));
  return !!ctx;
}

/** Render a sound offline (for checking levels / exporting a WAV). */
export async function renderOffline(which: 'horn' | WhistleKind, sampleRate = 48000): Promise<AudioBuffer> {
  const seconds = which === 'horn' ? 1.9 : 2.1;
  const c = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const out = outStage(c, c.destination, which === 'horn' ? HORN_LEVEL : WHISTLE_LEVEL);
  if (which === 'horn') airHorn(c, out, 0.02);
  else whistle(c, out, 0.02, which);
  return c.startRendering();
}
