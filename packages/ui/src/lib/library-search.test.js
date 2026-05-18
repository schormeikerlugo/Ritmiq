/**
 * Tests para library-search (puro, sin DB ni IO).
 *
 * Ejecutar:
 *   node --test packages/ui/src/lib/library-search.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { searchLibraryTracks, dedupeByYtId } from './library-search.js';

/** @returns {import('@ritmiq/core/types').Track} */
const makeTrack = (id, title, artist, album, ytId) => ({
  id, title, artist, album, ytId,
  userId: 'u1', source: 'youtube',
  durationSeconds: 200, coverUrl: null,
  filePath: null, isDownloaded: false, createdAt: '2026-01-01T00:00:00Z',
});

const LIBRARY = [
  makeTrack('1', 'Bohemian Rhapsody', 'Queen', 'A Night at the Opera', 'btx'),
  makeTrack('2', 'Don\'t Stop Me Now', 'Queen', 'Jazz', 'dsm'),
  makeTrack('3', 'Rumours', 'Fleetwood Mac', 'Rumours', 'rum'),
  makeTrack('4', 'Go Your Own Way', 'Fleetwood Mac', 'Rumours', 'gyow'),
  makeTrack('5', 'Café del Mar', 'Energy 52', 'Volume One', 'cafe'),
  makeTrack('6', 'Yesterday', 'The Beatles', 'Help!', 'yest'),
];

describe('searchLibraryTracks', () => {
  test('query vacia devuelve []', () => {
    assert.deepEqual(searchLibraryTracks(LIBRARY, ''), []);
    assert.deepEqual(searchLibraryTracks(LIBRARY, '   '), []);
  });

  test('library vacia devuelve []', () => {
    assert.deepEqual(searchLibraryTracks([], 'queen'), []);
    assert.deepEqual(searchLibraryTracks(null, 'queen'), []);
  });

  test('matchea por title', () => {
    const r = searchLibraryTracks(LIBRARY, 'bohemian');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, '1');
  });

  test('matchea por artist', () => {
    const r = searchLibraryTracks(LIBRARY, 'queen');
    assert.equal(r.length, 2);
    assert.equal(r[0].artist, 'Queen');
  });

  test('matchea por album', () => {
    const r = searchLibraryTracks(LIBRARY, 'rumours');
    assert.equal(r.length, 2, 'Rumours album tiene 2 tracks (title + Go Your Own Way)');
    // Track id=3 tiene "Rumours" como title Y album → score mas alto (prefix).
    assert.equal(r[0].id, '3');
  });

  test('AND: todos los tokens deben matchear', () => {
    const r = searchLibraryTracks(LIBRARY, 'queen bohemian');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, '1');
  });

  test('AND: si un token no aparece, no matchea', () => {
    const r = searchLibraryTracks(LIBRARY, 'queen jazz');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, '2', 'Don\'t Stop Me Now esta en album Jazz');
  });

  test('AND estricto: query con token no presente devuelve []', () => {
    const r = searchLibraryTracks(LIBRARY, 'queen unknown_token_xyz');
    assert.equal(r.length, 0);
  });

  test('case-insensitive', () => {
    assert.equal(searchLibraryTracks(LIBRARY, 'QUEEN')[0].artist, 'Queen');
    assert.equal(searchLibraryTracks(LIBRARY, 'queen').length, 2);
    assert.equal(searchLibraryTracks(LIBRARY, 'Queen').length, 2);
  });

  test('ignora diacriticos (cafe vs café)', () => {
    const r = searchLibraryTracks(LIBRARY, 'cafe');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, '5');
    assert.equal(searchLibraryTracks(LIBRARY, 'café').length, 1);
    assert.equal(searchLibraryTracks(LIBRARY, 'CAFÉ').length, 1);
  });

  test('limit respeta el maximo', () => {
    const big = Array.from({ length: 50 }, (_, i) => makeTrack(`q${i}`, `Queen Song ${i}`, 'Queen', null, `yt${i}`));
    const r = searchLibraryTracks(big, 'queen', 5);
    assert.equal(r.length, 5);
  });

  test('score: matches que empiezan con el primer token rankean mas alto', () => {
    const r = searchLibraryTracks(LIBRARY, 'rumours');
    // Track 3 (title="Rumours") debe estar antes de track 4 (album="Rumours").
    assert.equal(r[0].id, '3');
    assert.equal(r[1].id, '4');
  });

  test('tracks sin title/artist/album no rompen', () => {
    const lib = [
      makeTrack('x', null, null, null, 'ytx'),
      makeTrack('y', 'Hello', null, null, 'yty'),
    ];
    const r = searchLibraryTracks(lib, 'hello');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'y');
  });
});

describe('dedupeByYtId', () => {
  test('devuelve youtubeResults sin cambios si library vacia', () => {
    const yt = [{ id: 'btx', title: 'Bohemian' }];
    assert.deepEqual(dedupeByYtId(yt, []), yt);
    assert.deepEqual(dedupeByYtId(yt, null), yt);
  });

  test('devuelve [] si youtubeResults vacio', () => {
    assert.deepEqual(dedupeByYtId([], LIBRARY), []);
    assert.deepEqual(dedupeByYtId(null, LIBRARY), []);
  });

  test('filtra YouTube results cuyo id matchea ytId local', () => {
    const yt = [
      { id: 'btx', title: 'Bohemian Rhapsody (YouTube)' },
      { id: 'other', title: 'Otra cancion' },
      { id: 'dsm', title: 'Don\'t Stop Me Now (live)' },
    ];
    const r = dedupeByYtId(yt, LIBRARY);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'other');
  });

  test('tracks locales sin ytId no afectan dedup', () => {
    const lib = [makeTrack('1', 'Algo', 'Alguien', null, null)];
    const yt = [{ id: 'btx', title: 'YouTube' }];
    assert.deepEqual(dedupeByYtId(yt, lib), yt);
  });
});
