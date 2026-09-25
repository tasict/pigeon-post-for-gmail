// Notification sounds, synthesized with Web Audio so no audio files are bundled.
// Shared by the settings page (preview) and the offscreen document (playback).
const Sounds = (() => {
  const LIST = ['chime', 'ding', 'drop', 'marimba', 'bell', 'tick'].map(id => ({ id, name: I18n.t(`sound_${id}`) }));
  const NAMES = { none: I18n.t('sound_none'), custom: I18n.t('sound_custom'), ...Object.fromEntries(LIST.map(s => [s.id, s.name])) };

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
    }
  };

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Plays one sound and resolves when it ends. custom needs the file's data URL and falls back to the default sound without it.
  async function play(id, volume = 70, data = null) {
    const v = Math.max(0, Math.min(100, volume)) / 100;
    if (!v || id === 'none') return;
    if (id === 'custom' && data) {
      const el = new Audio(data);
      el.volume = v;
      try { await el.play(); } catch { return; }
      // Custom files play for at most 5 seconds, in case someone uploads a whole song.
      await Promise.race([new Promise(r => { el.onended = r; }), wait(5000)]);
      el.pause();
      return;
    }
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
      await play(item.sound, volume, item.data);
    }
  }

  return { LIST, NAMES, play, playQueue };
})();
