import { readFile, writeFile } from 'node:fs/promises';
import { requestBody, parseModelResponse, MODEL, RUBRIC } from '../classifier.mjs';
import '../policy.js';

const key = (process.env.JEV_API_KEY || '').trim().replace(/^Bearer\s+/i, '');
if (!key) {
  console.error('Set JEV_API_KEY before running the live benchmark.');
  process.exit(2);
}

const allCases = JSON.parse(await readFile(new URL('../tests/cases.json', import.meta.url), 'utf8'));
const limit = Math.max(1, Math.min(allCases.length, Number(process.env.BENCHMARK_LIMIT || allCases.length)));
const delayMs = Math.max(0, Number(process.env.BENCHMARK_DELAY_MS || 2100));
const threshold = Math.max(60, Math.min(98, Number(process.env.BENCHMARK_THRESHOLD || 85)));
const selected = allCases.slice(0, limit);
const endpoint = 'https://api.typesafe.ai/v1/systemone';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];

for (let index = 0; index < selected.length; index++) {
  const item = selected[index];
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(item.text)),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Jev returned HTTP ${response.status} on ${item.id}`);
  const parsed = parseModelResponse(await response.json());
  const decision = globalThis.SlopPolicy.decide(parsed.result, { threshold });
  const predicted = decision.kind;
  rows.push({
    id: item.id,
    expected: item.expected,
    predicted,
    correct: predicted === item.expected,
    language: item.language,
    difficulty: item.difficulty,
    hard_negative: item.hard_negative,
    archetype: item.archetype,
    score: decision.score,
    slop_probability: parsed.result.likelihood,
    reasons: decision.reasons,
    result: parsed.result
  });
  console.log(`${index + 1}/${selected.length} ${item.id} expected=${item.expected} predicted=${predicted} score=${decision.score ?? 'n/a'}`);
  if (index + 1 < selected.length && delayMs) await sleep(delayMs);
}

const safeDiv = (a,b) => b ? a / b : 0;
const correct = rows.filter(row => row.correct).length;
const slopTp = rows.filter(row => row.expected === 'slop' && row.predicted === 'slop').length;
const slopFp = rows.filter(row => row.expected !== 'slop' && row.predicted === 'slop').length;
const slopFn = rows.filter(row => row.expected === 'slop' && row.predicted !== 'slop').length;
const clearTn = rows.filter(row => row.expected === 'clear' && row.predicted !== 'slop').length;
const clearFp = rows.filter(row => row.expected === 'clear' && row.predicted === 'slop').length;
const scoredBinary = rows.filter(row => row.expected === 'slop' || row.expected === 'clear');
const brier = safeDiv(scoredBinary.reduce((sum, row) => {
  const target = row.expected === 'slop' ? 1 : 0;
  return sum + (row.slop_probability - target) ** 2;
}, 0), scoredBinary.length);
const hard = rows.filter(row => row.hard_negative);
const byLanguage = Object.fromEntries([...new Set(rows.map(row => row.language))].map(language => {
  const subset = rows.filter(row => row.language === language);
  return [language, { count: subset.length, accuracy: safeDiv(subset.filter(row => row.correct).length, subset.length) }];
}));
const byArchetype = Object.fromEntries([...new Set(rows.map(row => row.archetype))].sort().map(archetype => {
  const subset = rows.filter(row => row.archetype === archetype);
  return [archetype, { count: subset.length, accuracy: safeDiv(subset.filter(row => row.correct).length, subset.length) }];
}));

const report = {
  generated_at: new Date().toISOString(),
  model: MODEL,
  rubric: RUBRIC,
  threshold,
  count: rows.length,
  metrics: {
    accuracy: safeDiv(correct, rows.length),
    slop_precision: safeDiv(slopTp, slopTp + slopFp),
    slop_recall: safeDiv(slopTp, slopTp + slopFn),
    clear_false_positive_rate: safeDiv(clearFp, clearFp + clearTn),
    brier_score_clear_vs_slop: brier,
    hard_negative_accuracy: safeDiv(hard.filter(row => row.correct).length, hard.length),
    false_positive_count: slopFp,
    false_negative_count: slopFn,
    by_language: byLanguage,
    by_archetype: byArchetype
  },
  rows
};

const output = process.env.BENCHMARK_OUTPUT || 'benchmark-report.json';
await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report.metrics, null, 2));
console.log(`Saved ${output}`);
