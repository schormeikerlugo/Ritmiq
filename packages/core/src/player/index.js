/**
 * Player core: máquina de estados pequeña, agnóstica del backend de audio.
 * El backend concreto (Howler en web/desktop, Audio nativo en PWA) implementa
 * la interfaz `AudioBackend`.
 *
 * @module @ritmiq/core/player
 */

/**
 * @typedef {import('../types.js').Track} Track
 * @typedef {import('../types.js').PlaybackState} PlaybackState
 */

/**
 * @typedef {Object} AudioBackend
 * @property {(url: string) => Promise<void>} load
 * @property {() => Promise<void>} play
 * @property {() => void} pause
 * @property {(seconds: number) => void} seek
 * @property {(volume: number) => void} setVolume
 * @property {(cb: () => void) => () => void} onEnded   Devuelve unsubscribe
 * @property {(cb: (pos: number) => void) => () => void} onPosition
 * @property {() => void} dispose
 */

export class Player {
  /**
   * @param {Object} deps
   * @param {AudioBackend} deps.backend
   * @param {(track: Track) => Promise<string>} deps.resolveSourceUrl
   *        Función que resuelve la URL reproducible (vía audio-source.js).
   */
  constructor({ backend, resolveSourceUrl }) {
    this.backend = backend;
    this.resolveSourceUrl = resolveSourceUrl;
    /** @type {PlaybackState} */
    this.state = {
      currentTrack: null,
      isPlaying: false,
      positionSeconds: 0,
      volume: 1,
      repeat: 'off',
      shuffle: false,
    };
    /** @type {Set<(s: PlaybackState) => void>} */
    this._listeners = new Set();

    this._unsubPos = backend.onPosition((pos) => {
      this.state.positionSeconds = pos;
      this._emit();
    });
  }

  /** @param {(s: PlaybackState) => void} cb */
  subscribe(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _emit() {
    for (const cb of this._listeners) cb(this.state);
  }

  /** @param {Track} track */
  async playTrack(track) {
    const url = await this.resolveSourceUrl(track);
    await this.backend.load(url);
    await this.backend.play();
    this.state.currentTrack = track;
    this.state.isPlaying = true;
    this._emit();
  }

  async pause() {
    this.backend.pause();
    this.state.isPlaying = false;
    this._emit();
  }

  async resume() {
    await this.backend.play();
    this.state.isPlaying = true;
    this._emit();
  }

  /** @param {number} sec */
  seek(sec) {
    this.backend.seek(sec);
    this.state.positionSeconds = sec;
    this._emit();
  }

  /** @param {number} v 0..1 */
  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    this.backend.setVolume(clamped);
    this.state.volume = clamped;
    this._emit();
  }

  dispose() {
    this._unsubPos?.();
    this.backend.dispose();
    this._listeners.clear();
  }
}
