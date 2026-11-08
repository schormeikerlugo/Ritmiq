import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson3, toLrc, textSimilarity, lrcText } from './lyrics-sync.js';

test('parseJson3: quita ♪, saltos y repeticiones', () => {
  const j = { events: [
    { tStartMs: 14647, segs: [{ utf8: '♪ Holding me back ♪' }] },
    { tStartMs: 15000, segs: [{ utf8: '♪ Holding me back ♪' }] },
    { tStartMs: 19452, segs: [{ utf8: '♪ I want you to hold out the\npalm of your hand ♪' }] },
    { tStartMs: 20000 },
  ] };
  assert.deepEqual(parseJson3(j), [
    { timeMs: 14647, text: 'Holding me back' },
    { timeMs: 19452, text: 'I want you to hold out the palm of your hand' },
  ]);
});

test('toLrc: formato [mm:ss.cc]', () => {
  assert.equal(toLrc([{ timeMs: 75_430, text: 'Hola' }]), '[01:15.43]Hola');
});

test('textSimilarity: misma letra vs traducción', () => {
  const es = 'No sé si estás llorando porque me voy o porque sabes que volveré';
  assert.ok(textSimilarity(es, lrcText('[00:10.00]No sé, si estás llorando porque me voy\n[00:14.00]O porque sabes que volveré')) > 0.8);
  assert.ok(textSimilarity(es, 'I do not know if you are crying because I am leaving') < 0.1);
});
