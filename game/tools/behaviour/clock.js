// The virtual clock, shared by the behaviour suite and the recorder (../reel.js), installed with
// page.addInitScript(CLOCK) before any page script: real time until __clock.freeze(), then only __clock.step(ms) advances
// performance.now, requestAnimationFrame, timers and CSS animations.
// freeze(origin) starts the virtual time at `origin` (ms) rather than wherever real time had got to, so two recordings
// play from the same logical time whatever their boot took (anything keyed on absolute time, a rim's breathing, comes
// out the same); it must be later than the real time at the freeze. Timers and animation frames asked for before the
// freeze carry over onto the virtual clock with the time they had left.
const CLOCK = () => {
  // Math.random is seeded, and seeded again when the clock freezes (the real-time settling before it draws a varying
  // number of times), so two recordings of the same client are the same frames.
  let seed = 0; const reseed = () => (seed = 0x9e3779b9);
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  reseed();
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
  const realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window), realSetI = window.setInterval.bind(window), realClearI = window.clearInterval.bind(window);
  let frozen = false, base = 0, now = 0, nextId = 1e6;
  const rafs = new Map(), timers = new Map(), anims = new Map();
  // What was asked for in real time and has not run yet, to carry over at the freeze: id -> callback (and due time).
  const realRafs = new Map(), realTimers = new Map();
  performance.now = () => (frozen ? now : realNow());
  window.requestAnimationFrame = cb => {
    if (frozen) { const id = nextId++; rafs.set(id, cb); return id; }
    const id = realRaf(t => { realRafs.delete(id); cb(t); }); realRafs.set(id, cb); return id;
  };
  window.cancelAnimationFrame = id => { rafs.delete(id); realRafs.delete(id); realCancel(id); };
  window.setTimeout = (cb, ms = 0, ...a) => {
    if (frozen) { const id = nextId++; timers.set(id, { at: now + Math.max(0, +ms || 0), cb, a }); return id; }
    const id = realSet((...x) => { realTimers.delete(id); cb(...x); }, ms, ...a); realTimers.set(id, { due: realNow() + Math.max(0, +ms || 0), cb, a }); return id;
  };
  window.clearTimeout = id => { timers.delete(id); realTimers.delete(id); realClear(id); };
  window.setInterval = (cb, ms = 0, ...a) => {
    if (frozen) { const id = nextId++; timers.set(id, { at: now + ms, cb, a, every: Math.max(1, ms) }); return id; }
    const id = realSetI(cb, ms, ...a); realTimers.set(id, { due: realNow() + ms, cb, a, every: Math.max(1, ms) }); return id;
  };
  window.clearInterval = id => { timers.delete(id); realTimers.delete(id); realClearI(id); };
  // CSS animations and transitions: pause each as it appears and drive its currentTime from the virtual clock.
  const syncCss = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (!anims.has(a)) { anims.set(a, now - (a.currentTime || 0)); try { a.pause(); } catch (e) {} }
      try { a.currentTime = now - anims.get(a); } catch (e) {}
    }
  };
  window.__clock = {
    get frozen() { return frozen; }, get now() { return now; },
    freeze(origin) {
      if (frozen) return;
      const real = realNow();
      now = origin != null && origin > real ? origin : real; base = now; frozen = true; reseed();
      for (const [id, t] of realTimers) { (t.every ? realClearI : realClear)(id); timers.set(id, { at: now + Math.max(0, t.due - real), cb: t.cb, a: t.a, every: t.every }); }
      realTimers.clear();
      for (const [id, cb] of realRafs) { realCancel(id); rafs.set(id, cb); }
      realRafs.clear();
      syncCss();
    },
    step(ms) {
      const end = now + ms;
      for (;;) {   // timers due inside the step, in order
        let due = null; for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due; now = Math.max(now, t.at);
        if (t.every) t.at += t.every; else timers.delete(id);
        try { t.cb(...t.a); } catch (e) { console.error(e); }
      }
      now = end;
      const cbs = [...rafs.values()]; rafs.clear();
      for (const cb of cbs) try { cb(now); } catch (e) { console.error(e); }
      syncCss();
      return now - base;
    },
  };
};
module.exports = { CLOCK };
