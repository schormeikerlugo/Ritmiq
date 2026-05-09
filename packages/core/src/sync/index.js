/**
 * Cola de operaciones offline-first.
 * Cuando el cliente está offline o Supabase no responde, las mutaciones
 * (crear playlist, añadir track, etc) se serializan en una cola persistente.
 * Al reconectarse, se reproducen contra el servidor en orden FIFO.
 *
 * Política de conflictos: last-write-wins basada en `clientUpdatedAt`.
 *
 * @module @ritmiq/core/sync
 */

/**
 * @typedef {Object} SyncOp
 * @property {string} id                 UUID local
 * @property {string} table              ej. 'tracks' | 'playlists' | 'playlist_tracks'
 * @property {'insert'|'update'|'delete'} op
 * @property {Record<string, unknown>} payload
 * @property {string} clientUpdatedAt    ISO timestamp
 * @property {number} attempts
 */

/**
 * @typedef {Object} SyncStorage
 * @property {() => Promise<SyncOp[]>} list
 * @property {(op: SyncOp) => Promise<void>} push
 * @property {(id: string) => Promise<void>} remove
 * @property {(id: string, attempts: number) => Promise<void>} bumpAttempts
 */

/**
 * @typedef {Object} SyncTransport
 * @property {(op: SyncOp) => Promise<void>} apply  Lanza si falla.
 */

export class SyncEngine {
  /**
   * @param {Object} deps
   * @param {SyncStorage} deps.storage
   * @param {SyncTransport} deps.transport
   * @param {() => boolean} deps.isOnline
   */
  constructor({ storage, transport, isOnline }) {
    this.storage = storage;
    this.transport = transport;
    this.isOnline = isOnline;
    this._running = false;
  }

  /**
   * Encola una operación para sincronización diferida.
   * @param {Omit<SyncOp,'id'|'attempts'|'clientUpdatedAt'> & {clientUpdatedAt?: string}} partial
   */
  async enqueue(partial) {
    /** @type {SyncOp} */
    const op = {
      id: crypto.randomUUID(),
      attempts: 0,
      clientUpdatedAt: partial.clientUpdatedAt ?? new Date().toISOString(),
      table: partial.table,
      op: partial.op,
      payload: partial.payload,
    };
    await this.storage.push(op);
    if (this.isOnline()) this.flush().catch(() => {});
  }

  /**
   * Procesa la cola hasta vaciarla o hasta el primer fallo.
   */
  async flush() {
    if (this._running) return;
    this._running = true;
    try {
      const ops = await this.storage.list();
      for (const op of ops) {
        try {
          await this.transport.apply(op);
          await this.storage.remove(op.id);
        } catch (err) {
          await this.storage.bumpAttempts(op.id, op.attempts + 1);
          throw err;
        }
      }
    } finally {
      this._running = false;
    }
  }
}
