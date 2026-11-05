import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrack, scoreCandidate, similarity, ACCEPT_SCORE } from './art-resolver.js';

test('parseTrack: quita ruido de YouTube', () => {
  const p = parseTrack({ title: 'Big Time Rush - Worldwide (Official Video)', artist: 'Big Time Rush' });
  assert.equal(p.artist, 'Big Time Rush');
  assert.equal(p.title, 'Worldwide');
});

test('parseTrack: "Título – Artista" cuando el canal es el artista', () => {
  const p = parseTrack({ title: 'Numb (Official Music Video) [4K UPGRADE] – Linkin Park', artist: 'Linkin Park' });
  assert.equal(p.artist, 'Linkin Park');
  assert.equal(p.title, 'Numb');
});

test('parseTrack: canal "- Topic" y corchetes', () => {
  const a = parseTrack({ title: 'Whale', artist: 'George & Jonathan - Topic' });
  assert.equal(a.artist, 'George & Jonathan');
  const b = parseTrack({ title: 'Sr. Falla de Origen - Hoy te Quiero Ver [POST PUNK VENEZOLANO]', artist: 'Sr. Falla de Origen' });
  assert.equal(b.title, 'Hoy te Quiero Ver');
});

test('parseTrack: anota variantes (remix, slowed)', () => {
  const p = parseTrack({ title: 'Nine Thou (Grant Mohrman Superstars Remix)', artist: 'Styles of Beyond - Topic' });
  assert.deepEqual(p.variants, ['remix']);
});

test('scoreCandidate: original > karaoke', () => {
  const q = { ...parseTrack({ title: 'Iris', artist: 'Goo Goo Dolls' }), durationSeconds: 289 };
  const orig = scoreCandidate(q, { title: 'Iris', artist: 'The Goo Goo Dolls', album: 'Dizzy Up the Girl', durationSeconds: 289 });
  const kara = scoreCandidate(q, { title: 'Iris (Karaoke Version)', artist: 'Goo Goo Dolls', album: 'Karaoke Hits', durationSeconds: 290 });
  assert.ok(orig >= ACCEPT_SCORE);
  assert.ok(orig > kara + 0.2);
});

test('scoreCandidate: otra canción no pasa el umbral', () => {
  const q = { ...parseTrack({ title: 'Kylian Mbappe Dictador Anthem', artist: 'SurNervis' }), durationSeconds: 185 };
  const c = scoreCandidate(q, { title: 'Anthem', artist: 'Kylian', album: 'X', durationSeconds: 240 });
  assert.ok(c < ACCEPT_SCORE);
});

test('similarity: acentos y mayúsculas', () => {
  assert.equal(similarity('Conversación Casual', 'conversacion casual'), 1);
});
