import { readFile } from 'node:fs/promises';
import { evaluateWithTypeSafe } from '../server/typesafe.js';
import { SEMANTIC_CATEGORY_IDS, validateAnalysisInput } from '../server/logic.js';

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error('Usage: node evaluation/evaluate-fixtures.mjs /path/to/fixtures.jsonl');
  process.exit(1);
}

const rows = (await readFile(fixturePath, 'utf8'))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => JSON.parse(line));

const counts = {
  total: rows.length,
  human: 0,
  ai: 0,
  highHuman: 0,
  highAi: 0,
  predictedHigh: 0,
  assessed: 0
};

const strengths = { conservative: 0.90, balanced: 0.80, aggressive: 0.70 };
const categoryMetrics = Object.fromEntries(Object.entries(strengths).map(([strength, threshold]) => [
  strength,
  Object.fromEntries(SEMANTIC_CATEGORY_IDS.map(category => [category, {
    labeled: 0,
    positives: 0,
    predicted: 0,
    truePositives: 0,
    falsePositives: 0,
    requests: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0
  }]))
]));

function wilsonInterval(successes, trials, z = 1.96) {
  if (trials === 0) return null;
  const proportion = successes / trials;
  const denominator = 1 + (z ** 2 / trials);
  const centre = (proportion + (z ** 2 / (2 * trials))) / denominator;
  const margin = (z / denominator) * Math.sqrt(
    (proportion * (1 - proportion) / trials) + (z ** 2 / (4 * trials ** 2))
  );
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

for (const row of rows) {
  if (row.groundTruth === 'human') counts.human += 1;
  if (row.groundTruth === 'ai') counts.ai += 1;
  const categoryGroundTruth = row.categoryGroundTruth || {};
  const labeledCategories = Array.isArray(categoryGroundTruth)
    ? categoryGroundTruth
    : Object.keys(categoryGroundTruth);
  const input = validateAnalysisInput({
    contentType: row.contentType,
    text: row.text,
    title: row.title,
    body: row.body,
    subreddit: row.subreddit,
    flair: row.flair,
    includeAi: row.includeAi !== false,
    categories: labeledCategories,
    truncated: row.truncated === true
  });
  const result = input.aiInsufficient && input.categoryIds.length === 0
    ? { label: 'insufficient' }
    : await evaluateWithTypeSafe(input);
  if (result.label !== 'insufficient') counts.assessed += 1;
  if (result.label === 'high') {
    counts.predictedHigh += 1;
    if (row.groundTruth === 'human') counts.highHuman += 1;
    if (row.groundTruth === 'ai') counts.highAi += 1;
  }

  for (const strength of Object.keys(strengths)) {
    for (const category of input.categoryIds) {
      const truth = Array.isArray(categoryGroundTruth)
        ? categoryGroundTruth.includes(category)
        : Boolean(categoryGroundTruth[category]);
      const metric = categoryMetrics[strength][category];
      const probability = Number(result.categoryProbabilities?.[category]);
      if (!Number.isFinite(probability)) continue;
      metric.labeled += 1;
      metric.requests += 1;
      metric.latencyMs += Number(result.latencyMs || 0);
      metric.inputTokens += Number(result.usage?.input_tokens || 0);
      metric.outputTokens += Number(result.usage?.output_tokens || 0);
      if (truth) metric.positives += 1;
      if (probability >= strengths[strength]) {
        metric.predicted += 1;
        if (truth) metric.truePositives += 1;
        else metric.falsePositives += 1;
      }
    }
  }
}

if (counts.human < 100 || counts.ai < 100) {
  console.error(`Evaluation requires at least 100 human and 100 AI examples; received ${counts.human} human and ${counts.ai} AI.`);
  process.exit(2);
}

const precision = counts.predictedHigh === 0 ? null : counts.highAi / counts.predictedHigh;
const recall = counts.ai === 0 ? null : counts.highAi / counts.ai;
const humanFalsePositiveRate = counts.human === 0 ? null : counts.highHuman / counts.human;
const abstentionCoverage = counts.total === 0 ? null : 1 - counts.assessed / counts.total;

for (const strength of Object.keys(categoryMetrics)) {
  for (const category of SEMANTIC_CATEGORY_IDS) {
    const metric = categoryMetrics[strength][category];
    metric.precision = metric.predicted === 0 ? null : metric.truePositives / metric.predicted;
    metric.recall = metric.positives === 0 ? null : metric.truePositives / metric.positives;
    metric.falsePositiveRate = metric.labeled - metric.positives === 0
      ? null
      : metric.falsePositives / (metric.labeled - metric.positives);
    metric.averageLatencyMs = metric.requests === 0 ? null : metric.latencyMs / metric.requests;
  }
}

console.log(JSON.stringify({
  counts,
  precision,
  recall,
  humanFalsePositiveRate,
  abstentionCoverage,
  uncertainty95: {
    precision: wilsonInterval(counts.highAi, counts.predictedHigh),
    recall: wilsonInterval(counts.highAi, counts.ai),
    humanFalsePositiveRate: wilsonInterval(counts.highHuman, counts.human),
    abstentionCoverage: wilsonInterval(counts.total - counts.assessed, counts.total)
  },
  categoryMetrics
}, null, 2));
