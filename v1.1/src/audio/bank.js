// MARK ZERO — the sound bank. Owned by task `audio`.
//
// Loads audio/manifest.json, then fetches and decodes every real recorded file it names.
// Nothing here generates a waveform: a Bank entry is always a decoded AudioBuffer of a
// file that was downloaded from a permissively licensed library by tools/fetch-audio.sh
// and credited in audio/CREDITS.md.
//
// Two things this deliberately does NOT do:
//   * it never throws at the caller. A missing or corrupt file leaves a null buffer and
//     every play() on it becomes a no-op, because a 404 on a UI blip must not take the
//     flight model down with it.
//   * it never blocks the boot. init() awaits only the small, always-needed clips; the
//     long music tracks stream in behind the game and drop into place when they land.

const MANIFEST_URL = new URL('../../audio/manifest.json', import.meta.url);

// How many decodes to run at once. Above ~6 Safari starts serialising them anyway and
// the main thread stutters during the workshop walk, which is exactly when the player
// is looking at something and would notice.
const CONCURRENCY = 6;

export class Bank {
  constructor(ac) {
    this.ac = ac;
    this.buffers = new Map();   // name -> AudioBuffer | null
    this.meta = new Map();      // name -> manifest entry
    this.failed = [];
    this.loaded = 0;
    this.total = 0;
    this.ready = false;
  }

  entry(name) { return this.meta.get(name) || null; }
  get(name) { return this.buffers.get(name) || null; }
  has(name) { return !!this.buffers.get(name); }

  /** Names that exist in the manifest and match a prefix — used for random variants. */
  variants(prefix) {
    const out = [];
    for (const [name] of this.meta) if (name.startsWith(prefix) && this.buffers.get(name)) out.push(name);
    return out;
  }

  async init() {
    let manifest;
    try {
      const r = await fetch(MANIFEST_URL);
      manifest = await r.json();
    } catch (e) {
      this.error = 'audio/manifest.json could not be read: ' + e;
      return this;
    }
    const jobs = [];
    for (const group of ['sfx', 'music']) {
      for (const [name, e] of Object.entries(manifest[group] || {})) {
        if (!e || !e.file) continue;
        this.meta.set(name, { ...e, group });
        jobs.push({ name, e, group });
      }
    }
    this.total = jobs.length;

    // Everything except music is needed before the first frame that can make a sound.
    const first = jobs.filter(j => j.group === 'sfx');
    const rest = jobs.filter(j => j.group !== 'sfx');
    await this._run(first);
    this.ready = true;
    // Music arrives whenever it arrives.
    this.musicLoading = this._run(rest);
    return this;
  }

  async _run(jobs) {
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        await this._load(j.name, j.e);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  }

  async _load(name, e) {
    const url = new URL('../../' + e.file, import.meta.url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = await res.arrayBuffer();
      // decodeAudioData is callback-shaped in older Safari; the promise form is fine
      // in everything that can run WebGL2, which this game already requires.
      const buf = await this.ac.decodeAudioData(bytes);
      this.buffers.set(name, buf);
    } catch (err) {
      this.buffers.set(name, null);
      this.failed.push(name + ' (' + err.message + ')');
    }
    this.loaded++;
  }

  /**
   * Where inside the buffer a loop should run. MP3 encoders pad both ends of a file;
   * looping across that padding is the click you hear in every browser game that got
   * this wrong. tools/fetch-audio.sh already crossfaded the middle of every bed so the
   * seam is inaudible, and the manifest says how far in to keep the play head.
   */
  loopWindow(name) {
    const e = this.meta.get(name), b = this.buffers.get(name);
    if (!e || !b) return null;
    const start = Math.min(e.loopStart ?? 0.03, b.duration * 0.25);
    const end = Math.min(e.loopEnd ?? (b.duration - 0.03), b.duration);
    return { start, end: Math.max(start + 0.05, end) };
  }

  report() {
    return {
      loaded: this.loaded, total: this.total,
      ok: [...this.buffers.values()].filter(Boolean).length,
      failed: this.failed.slice(),
      seconds: +[...this.buffers.values()].filter(Boolean)
        .reduce((a, b) => a + b.duration, 0).toFixed(1),
    };
  }
}
