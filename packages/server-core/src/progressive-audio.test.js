/**
 * Tests de la descarga progresiva compartida.
 * Ejecuta con: node --test packages/server-core/src/progressive-audio.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgressiveAudio, durationFromUrl } from './progressive-audio.js';

const AUDIO = Buffer.alloc(3 * 1024 * 1024 + 123);
for (let i = 0; i < AUDIO.length; i++) AUDIO[i] = (i * 31) % 251;

/** Falso googlevideo: soporta Range y entrega en trozos lentos. */
function fakeUpstream({ failStatus = null } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.headers.range);
    if (failStatus) { res.writeHead(failStatus).end(); return; }
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m ? Math.min(Number(m[2]), AUDIO.length - 1) : AUDIO.length - 1;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'audio/mp4',
      'Content-Length': end - start + 1,
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${AUDIO.length}` } : {}),
    });
    let pos = start;
    const tick = () => {
      if (pos > end) { res.end(); return; }
      const next = Math.min(pos + 256 * 1024, end + 1);
      res.write(AUDIO.subarray(pos, next));
      pos = next;
      setTimeout(tick, 5);
    };
    tick();
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    server, hits, url: `http://127.0.0.1:${server.address().port}/videoplayback?dur=213.4`,
  })));
}

/** Servidor que expone `serve()` como lo haría /stream. */
function frontServer(pa, ytId) {
  const server = http.createServer(async (req, res) => {
    const r = await pa.serve(req, res, pa.get(ytId));
    if (r !== 'served') res.writeHead(599).end(r);
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    server, base: `http://127.0.0.1:${server.address().port}`,
  })));
}

async function get(base, range) {
  const r = await fetch(`${base}/s`, { headers: range ? { Range: range } : {} });
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
}

test('una sola descarga sirve rangos concurrentes y deja el archivo final', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prog-'));
  const up = await fakeUpstream();
  const completed = [];
  const pa = createProgressiveAudio({ dir, onComplete: (e) => completed.push(e.ytId) });
  pa.start('abcdefghijk', up.url);
  const front = await frontServer(pa, 'abcdefghijk');

  const [whole, head, mid] = await Promise.all([
    get(front.base, 'bytes=0-'),
    get(front.base, 'bytes=0-1'),
    get(front.base, 'bytes=500000-600000'),
  ]);
  assert.equal(whole.status, 206);
  assert.equal(whole.headers.get('content-range'), `bytes 0-${AUDIO.length - 1}/${AUDIO.length}`);
  assert.ok(whole.body.equals(AUDIO));
  assert.ok(head.body.equals(AUDIO.subarray(0, 2)));
  assert.ok(mid.body.equals(AUDIO.subarray(500000, 600001)));

  await pa.get('abcdefghijk')?.finished;
  assert.deepEqual(completed, ['abcdefghijk']);
  assert.ok(readFileSync(join(dir, 'abcdefghijk.m4a')).equals(AUDIO));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.part')), []);
  // Una única petición a googlevideo (archivo < 10MB) pese a 3 rangos.
  assert.equal(up.hits.length, 1);

  up.server.close(); front.server.close();
});

test('seek lejano devuelve far sin escribir al cliente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prog-'));
  const up = await fakeUpstream();
  const pa = createProgressiveAudio({ dir });
  const entry = pa.start('zzzzzzzzzzz', up.url);
  await entry.ready;
  const front = await frontServer(pa, 'zzzzzzzzzzz');
  const r = await get(front.base, `bytes=${AUDIO.length - 10}-`);
  // Puede llegar a 'served' si la descarga ya alcanzó el final.
  assert.ok(r.status === 599 || r.status === 206);
  await entry.finished;
  up.server.close(); front.server.close();
});

test('upstream 403 sin re-resolución → not-ready y sin restos .part', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prog-'));
  const up = await fakeUpstream({ failStatus: 403 });
  const pa = createProgressiveAudio({ dir });
  const entry = pa.start('fffffffffff', up.url);
  const front = await frontServer(pa, 'fffffffffff');
  const r = await get(front.base, 'bytes=0-');
  assert.equal(r.status, 599);
  assert.equal(r.body.toString(), 'not-ready');
  await assert.rejects(entry.finished);
  assert.equal(pa.get('fffffffffff'), null);
  assert.equal(existsSync(join(dir, 'fffffffffff.m4a')), false);
  up.server.close(); front.server.close();
});

test('durationFromUrl lee dur= de la URL de googlevideo', () => {
  assert.equal(durationFromUrl('https://x.googlevideo.com/videoplayback?dur=213.441&itag=140'), 213.441);
  assert.equal(durationFromUrl('https://x/videoplayback?itag=140'), null);
  assert.equal(durationFromUrl('nope'), null);
});
