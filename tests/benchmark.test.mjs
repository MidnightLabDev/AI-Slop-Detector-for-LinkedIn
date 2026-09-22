import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestBody } from '../classifier.mjs';

const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const count = (field, value) => cases.filter(item => item[field] === value).length;

test('benchmark contains exactly 500 unique posts with the intended label balance', () => {
  assert.equal(cases.length, 500);
  assert.equal(new Set(cases.map(item => item.id)).size, 500);
  assert.equal(new Set(cases.map(item => item.text)).size, 500);
  assert.equal(count('expected', 'clear'), 250);
  assert.equal(count('expected', 'slop'), 200);
  assert.equal(count('expected', 'uncertain'), 50);
});

test('benchmark covers all supported language modes at meaningful volume', () => {
  assert.equal(count('language', 'en'), 300);
  assert.equal(count('language', 'ar'), 80);
  assert.equal(count('language', 'tr'), 80);
  assert.equal(count('language', 'mixed'), 40);
});

test('benchmark contains 150 hard negatives and covers every slop surface cue', () => {
  const hard = cases.filter(item => item.hard_negative === true);
  assert.equal(hard.length, 150);
  for (const signal of ['formulaic','engagement','motivation','jargon','pseudoInsight']) {
    assert.ok(hard.filter(item => item.target_signals.includes(signal)).length >= 10, `missing hard negatives for ${signal}`);
  }
});

test('pseudo insight has dedicated positive and hard negative coverage', () => {
  const positives = cases.filter(item => item.expected === 'slop' && item.target_signals.includes('pseudoInsight'));
  const negatives = cases.filter(item => item.expected === 'clear' && item.hard_negative && item.target_signals.includes('pseudoInsight'));
  assert.ok(positives.length >= 50);
  assert.ok(negatives.length >= 20);
});

test('every benchmark case is valid classifier input with useful metadata', () => {
  for (const item of cases) {
    assert.match(item.id, /^B\d{3}$/);
    assert.ok(['en','ar','tr','mixed'].includes(item.language));
    assert.ok(['slop','clear','uncertain'].includes(item.expected));
    assert.ok(['easy','medium','hard'].includes(item.difficulty));
    assert.equal(typeof item.archetype, 'string');
    assert.ok(item.archetype.length > 2);
    assert.equal(typeof item.expected_reason, 'string');
    assert.ok(item.expected_reason.length > 10);
    assert.ok(Array.isArray(item.target_signals));
    assert.ok(item.text.length >= 40 && item.text.length <= 6000);
    const body = requestBody(item.text);
    assert.equal(body.state.post_text, item.text);
    assert.ok(body.questions.pseudoInsight);
  }
});

function tokenSet(text) {
  return new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
}

function jaccard(a, b) {
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection || 1);
}

test('benchmark avoids artificial near duplicates, especially in hard negatives', () => {
  const tokens = cases.map(item => tokenSet(item.text));
  let overallMax = 0;
  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      overallMax = Math.max(overallMax, jaccard(tokens[i], tokens[j]));
    }
  }
  assert.ok(overallMax < 0.95, `benchmark contains an overly similar pair at ${overallMax.toFixed(3)}`);

  const hardIndexes = cases.map((item, index) => item.hard_negative ? index : -1).filter(index => index >= 0);
  let hardMax = 0;
  for (let x = 0; x < hardIndexes.length; x++) {
    for (let y = x + 1; y < hardIndexes.length; y++) {
      hardMax = Math.max(hardMax, jaccard(tokens[hardIndexes[x]], tokens[hardIndexes[y]]));
    }
  }
  assert.ok(hardMax < 0.80, `hard negatives are too template similar at ${hardMax.toFixed(3)}`);
});
