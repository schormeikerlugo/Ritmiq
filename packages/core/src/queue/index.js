/**
 * Cola de reproducción con shuffle y repeat.
 * @module @ritmiq/core/queue
 */

/**
 * @typedef {import('../types.js').Track} Track
 * @typedef {'off'|'one'|'all'} RepeatMode
 */

/**
 * @param {Track[]} tracks
 * @returns {Track[]}
 */
function shuffleArray(tracks) {
  const a = tracks.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Queue {
  /**
   * @param {Object} [opts]
   * @param {Track[]} [opts.tracks]
   * @param {number} [opts.index]
   * @param {boolean} [opts.shuffle]
   * @param {RepeatMode} [opts.repeat]
   */
  constructor(opts = {}) {
    /** @type {Track[]} */
    this.tracks = opts.tracks ?? [];
    /** @type {Track[]} */
    this.order = opts.shuffle ? shuffleArray(this.tracks) : this.tracks.slice();
    this.index = opts.index ?? 0;
    this.shuffle = opts.shuffle ?? false;
    /** @type {RepeatMode} */
    this.repeat = opts.repeat ?? 'off';
  }

  /** @returns {Track|null} */
  current() {
    return this.order[this.index] ?? null;
  }

  /** @returns {Track|null} */
  next() {
    if (this.repeat === 'one') return this.current();
    if (this.index < this.order.length - 1) {
      this.index++;
      return this.current();
    }
    if (this.repeat === 'all') {
      this.index = 0;
      return this.current();
    }
    return null;
  }

  /** @returns {Track|null} */
  prev() {
    if (this.index > 0) {
      this.index--;
      return this.current();
    }
    return null;
  }

  /** @param {boolean} on */
  setShuffle(on) {
    if (on === this.shuffle) return;
    const cur = this.current();
    this.shuffle = on;
    this.order = on ? shuffleArray(this.tracks) : this.tracks.slice();
    if (cur) this.index = Math.max(0, this.order.indexOf(cur));
  }

  /** @param {RepeatMode} mode */
  setRepeat(mode) {
    this.repeat = mode;
  }

  /** @param {Track} track */
  enqueue(track) {
    this.tracks.push(track);
    this.order.push(track);
  }
}
