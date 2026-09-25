// Notification sounds, synthesized with Web Audio so no audio files are bundled.
// Every sound is built here from plain oscillators and noise, so there are no samples or recordings to license.
// Shared by the settings page (preview) and the offscreen document (playback).
const Sounds = (() => {
  const LIST = ['chime', 'ding', 'drop', 'marimba', 'bell', 'tick', 'pop', 'harp', 'glass', 'knock', 'coo', 'sparkle']
    .map(id => ({ id, name: I18n.t(`sound_${id}`) }));
  const NAMES = { none: I18n.t('sound_none'), ...Object.fromEntries(LIST.map(s => [s.id, s.name])) };

  let ctx = null;
  function audio() {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A single note: exponentially decaying envelope with an optional glide.
  function tone(c, out, { freq, at, dur, type = 'sine', gain = 0.4, attack = 0.006, glideTo }) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur * 0.5);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  // A short burst of white noise through a band-pass filter, for percussive attacks.
  function noise(c, out, { at, dur, freq, q = 1, gain = 0.3 }) {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const env = c.createGain();
    src.buffer = buf;
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(env).connect(out);
    src.start(at);
  }

  // One pigeon-like "coo" syllable: a soft, falling low tone with a throaty flutter.
  function cooNote(c, out, { at, dur, from, to, gain }) {
    const osc = c.createOscillator();
    const env = c.createGain();
    const flutter = c.createGain();
    const lfo = c.createOscillator();
    const depth = c.createGain();
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + dur);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + dur * 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    // The flutter gain swings between 0.45 and 1 at 26 Hz.
    flutter.gain.value = 0.725;
    lfo.frequency.value = 26;
    depth.gain.value = 0.275;
    lfo.connect(depth).connect(flutter.gain);
    osc.connect(env).connect(flutter).connect(out);
    osc.start(at); lfo.start(at);
    osc.stop(at + dur + 0.05); lfo.stop(at + dur + 0.05);
  }

  // Each recipe returns the sound's length in seconds.
  const RECIPES = {
    chime(c, out, t) {
      tone(c, out, { freq: 880, at: t, dur: 0.45, gain: 0.4 });
      tone(c, out, { freq: 1760, at: t, dur: 0.2, gain: 0.06 });
      tone(c, out, { freq: 1318.5, at: t + 0.15, dur: 0.8, gain: 0.4 });
      tone(c, out, { freq: 2637, at: t + 0.15, dur: 0.3, gain: 0.05 });
      return 1;
    },
    ding(c, out, t) {
      tone(c, out, { freq: 1046.5, at: t, dur: 1.1, gain: 0.45 });
      tone(c, out, { freq: 2093, at: t, dur: 0.35, gain: 0.08 });
      tone(c, out, { freq: 3140, at: t, dur: 0.15, gain: 0.03 });
      return 1.1;
    },
    drop(c, out, t) {
      tone(c, out, { freq: 1500, glideTo: 520, at: t, dur: 0.25, gain: 0.5, attack: 0.003 });
      tone(c, out, { freq: 1900, glideTo: 900, at: t + 0.13, dur: 0.18, gain: 0.18, attack: 0.003 });
      return 0.4;
    },
    marimba(c, out, t) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone(c, out, { freq: f, at: t + i * 0.09, dur: 0.4, gain: 0.35, attack: 0.003 });
        tone(c, out, { freq: f * 4, at: t + i * 0.09, dur: 0.05, gain: 0.05, attack: 0.002 });
      });
      return 0.65;
    },
    bell(c, out, t) {
      // FM bell: the modulation decays over time, so the overtones clean up.
      const carrier = c.createOscillator();
      const mod = c.createOscillator();
      const modGain = c.createGain();
      const env = c.createGain();
      carrier.frequency.value = 587.33;
      mod.frequency.value = 587.33 * 3.5;
      modGain.gain.setValueAtTime(600, t);
      modGain.gain.exponentialRampToValueAtTime(1, t + 1.4);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      mod.connect(modGain).connect(carrier.frequency);
      carrier.connect(env).connect(out);
      carrier.start(t); mod.start(t);
      carrier.stop(t + 1.7); mod.stop(t + 1.7);
      return 1.6;
    },
    tick(c, out, t) {
      tone(c, out, { freq: 1600, at: t, dur: 0.06, gain: 0.35, attack: 0.002 });
      tone(c, out, { freq: 800, at: t + 0.01, dur: 0.09, gain: 0.2, attack: 0.002 });
      return 0.15;
    },
    pop(c, out, t) {
      tone(c, out, { freq: 320, glideTo: 1100, at: t, dur: 0.14, gain: 0.5, attack: 0.002 });
      tone(c, out, { freq: 2200, at: t + 0.05, dur: 0.03, gain: 0.05, attack: 0.001 });
      return 0.2;
    },
    harp(c, out, t) {
      // Rising pentatonic pluck: D5, E5, A5, B5.
      [587.33, 659.25, 880, 987.77].forEach((f, i) => {
        tone(c, out, { freq: f, at: t + i * 0.07, dur: 0.7, type: 'triangle', gain: 0.28, attack: 0.002 });
        tone(c, out, { freq: f * 2, at: t + i * 0.07, dur: 0.2, gain: 0.04, attack: 0.002 });
      });
      return 0.95;
    },
    glass(c, out, t) {
      // Struck glass: a few inharmonic partials, plus a slightly detuned copy of the fundamental for shimmer.
      tone(c, out, { freq: 1244.5, at: t, dur: 1.4, gain: 0.3, attack: 0.002 });
      tone(c, out, { freq: 1248.2, at: t, dur: 1.2, gain: 0.1, attack: 0.002 });
      tone(c, out, { freq: 1244.5 * 2.32, at: t, dur: 0.6, gain: 0.1, attack: 0.002 });
      tone(c, out, { freq: 1244.5 * 4.25, at: t, dur: 0.25, gain: 0.04, attack: 0.001 });
      return 1.4;
    },
    knock(c, out, t) {
      for (const at of [t, t + 0.16]) {
        tone(c, out, { freq: 190, glideTo: 120, at, dur: 0.12, gain: 0.6, attack: 0.002 });
        noise(c, out, { at, dur: 0.04, freq: 900, q: 1.5, gain: 0.25 });
      }
      return 0.35;
    },
    coo(c, out, t) {
      cooNote(c, out, { at: t, dur: 0.22, from: 520, to: 470, gain: 0.35 });
      cooNote(c, out, { at: t + 0.28, dur: 0.5, from: 560, to: 430, gain: 0.4 });
      return 0.8;
    },
    sparkle(c, out, t) {
      [1975.5, 2349.3, 1568, 2093, 2637].forEach((f, i) => {
        tone(c, out, { freq: f, at: t + i * 0.055, dur: 0.35, gain: 0.3 - i * 0.035, attack: 0.002 });
      });
      return 0.6;
    }
  };

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Plays one sound and resolves when it ends. Unknown ids play the default sound.
  async function play(id, volume = 70) {
    const v = Math.max(0, Math.min(100, volume)) / 100;
    if (!v || id === 'none') return;
    const recipe = RECIPES[id] || RECIPES.chime;
    const c = audio();
    const out = c.createGain();
    out.gain.value = v;
    out.connect(c.destination);
    const seconds = recipe(c, out, c.currentTime + 0.03);
    await wait(seconds * 1000 + 120);
    out.disconnect();
  }

  // Plays several sounds in turn with a short gap, so different mailboxes can be told apart.
  async function playQueue(queue, volume) {
    for (const [i, item] of queue.entries()) {
      if (i) await wait(250);
      await play(item.sound, volume);
    }
  }

  return { LIST, NAMES, play, playQueue };
})();
