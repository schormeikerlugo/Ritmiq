/**
 * Backend de audio basado en Howler.js que implementa la interfaz
 * AudioBackend de @ritmiq/core/player.
 */

import { Howl } from 'howler';

export function createHowlerBackend() {
  /** @type {Howl|null} */
  let howl = null;
  /** @type {Set<() => void>} */
  const endedCbs = new Set();
  /** @type {Set<(p:number) => void>} */
  const posCbs = new Set();

  /** @type {ReturnType<typeof setInterval>|null} */
  let posTimer = null;

  function startPolling() {
    stopPolling();
    posTimer = setInterval(() => {
      if (!howl || !howl.playing()) return;
      const p = howl.seek();
      const sec = typeof p === 'number' ? p : 0;
      for (const cb of posCbs) cb(sec);
    }, 250);
  }

  function stopPolling() {
    if (posTimer) {
      clearInterval(posTimer);
      posTimer = null;
    }
  }

  function unload() {
    if (howl) {
      howl.unload();
      howl = null;
    }
    stopPolling();
  }

  return {
    /** @param {string} url */
    load(url) {
      return new Promise((resolve, reject) => {
        unload();
        howl = new Howl({
          src: [url],
          html5: true,        // necesario para streaming / archivos largos
          format: ['opus', 'm4a', 'mp3', 'webm'],
          onload: () => resolve(),
          onloaderror: (_id, err) => reject(new Error(`load: ${err}`)),
          onend: () => {
            for (const cb of endedCbs) cb();
          },
        });
      });
    },
    play() {
      return new Promise((resolve) => {
        if (!howl) return resolve();
        howl.play();
        startPolling();
        resolve();
      });
    },
    pause() {
      howl?.pause();
      stopPolling();
    },
    seek(sec) {
      howl?.seek(sec);
    },
    setVolume(v) {
      howl?.volume(v);
    },
    onEnded(cb) {
      endedCbs.add(cb);
      return () => endedCbs.delete(cb);
    },
    onPosition(cb) {
      posCbs.add(cb);
      return () => posCbs.delete(cb);
    },
    duration() {
      return howl?.duration() ?? 0;
    },
    dispose() {
      unload();
      endedCbs.clear();
      posCbs.clear();
    },
  };
}
