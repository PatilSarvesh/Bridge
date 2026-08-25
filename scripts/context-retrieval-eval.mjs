import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatasetUrl = new URL("../config/context-retrieval-evaluation.json", import.meta.url);
const allowedTypes = new Set(["decision", "artifact", "assumption"]);
const allowedAuthorities = new Set(["approved", "confirmed", "assumption"]);
const scopeKeys = ["repository", "component", "branch", "environment", "workItem"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every(isNonEmptyString);
}

function inUnitInterval(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export async function loadEvaluationDataset(datasetPath) {
  const source = datasetPath ? path.resolve(datasetPath) : defaultDatasetUrl;
  return JSON.parse(await readFile(source, "utf8"));
}

export function validateEvaluationDataset(dataset) {
  const errors = [];
  if (dataset?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (dataset?.evaluationId !== "BRG-130") errors.push("evaluationId must be BRG-130");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset?.datasetVersion ?? "")) {
    errors.push("datasetVersion must be an ISO calendar date");
  }
  if (!Number.isInteger(dataset?.k) || dataset.k < 1 || dataset.k > 20) {
    errors.push("k must be an integer from 1 through 20");
  }
  if (!Number.isInteger(dataset?.hashDimensions) || dataset.hashDimensions < 128) {
    errors.push("hashDimensions must be an integer of at least 128");
  }
  if (!inUnitInterval(dataset?.thresholds?.minimumCandidateRecallAtK)) {
    errors.push("minimumCandidateRecallAtK must be between 0 and 1");
  }
  if (!inUnitInterval(dataset?.thresholds?.minimumRecallGain)) {
    errors.push("minimumRecallGain must be between 0 and 1");
  }
  if (!Array.isArray(dataset?.corpus) || dataset.corpus.length === 0) {
    errors.push("corpus must contain at least one record");
  }
  if (!Array.isArray(dataset?.cases) || dataset.cases.length === 0) {
    errors.push("cases must contain at least one relevance query");
  }
  if (errors.length > 0) return errors;

  const corpusIds = new Set();
  for (const item of dataset.corpus) {
    if (!isRecord(item)) {
      errors.push("each corpus item must be an object");
      continue;
    }
    if (!isNonEmptyString(item.id) || corpusIds.has(item.id)) {
      errors.push(`duplicate or invalid corpus id: ${item.id}`);
    }
    corpusIds.add(item.id);
    if (!allowedTypes.has(item.type)) errors.push(`invalid type for ${item.id}`);
    if (!allowedAuthorities.has(item.authority)) errors.push(`invalid authority for ${item.id}`);
    if (!Array.isArray(item.categories) || item.categories.length === 0 || !item.categories.every(isNonEmptyString)) {
      errors.push(`categories must be non-empty strings for ${item.id}`);
    }
    for (const field of ["title", "summary", "body"]) {
      if (!isNonEmptyString(item[field])) errors.push(`${field} is required for ${item.id}`);
    }
    if (!isStringRecord(item.scope)) errors.push(`scope must contain strings for ${item.id}`);
    if (Number.isNaN(Date.parse(item.updatedAt))) errors.push(`updatedAt must be ISO-compatible for ${item.id}`);
  }

  const caseIds = new Set();
  for (const query of dataset.cases) {
    if (!isRecord(query)) {
      errors.push("each evaluation case must be an object");
      continue;
    }
    if (!isNonEmptyString(query.id) || caseIds.has(query.id)) {
      errors.push(`duplicate or invalid case id: ${query.id}`);
    }
    caseIds.add(query.id);
    if (!isNonEmptyString(query.task)) errors.push(`task is required for ${query.id}`);
    if (!isStringRecord(query.scope)) errors.push(`scope must contain strings for ${query.id}`);
    if (!Array.isArray(query.categories) || !query.categories.every(isNonEmptyString)) {
      errors.push(`categories must be strings for ${query.id}`);
    }
    if (!Array.isArray(query.relevantIds) || query.relevantIds.length === 0) {
      errors.push(`relevantIds are required for ${query.id}`);
      continue;
    }
    if (new Set(query.relevantIds).size !== query.relevantIds.length) {
      errors.push(`relevantIds must be unique for ${query.id}`);
    }
    for (const relevantId of query.relevantIds) {
      if (!corpusIds.has(relevantId)) errors.push(`unknown relevant id ${relevantId} for ${query.id}`);
    }
  }
  return errors;
}

function normalizeToken(token) {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
    .map(normalizeToken);
}

function lexicalTokens(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function authorityWeight(authority) {
  if (authority === "approved") return 10;
  if (authority === "confirmed") return 8;
  return 4;
}

function scopeMatch(scope, queryScope) {
  return scopeKeys.reduce(
    (score, key) => score + (queryScope[key] && scope[key] === queryScope[key] ? 4 : 0),
    0,
  );
}

function eligible(item, query) {
  return query.categories.length === 0 || query.categories.some((category) => item.categories.includes(category));
}

function itemText(item) {
  return `${item.title} ${item.summary} ${item.body} ${item.categories.join(" ")}`.toLowerCase();
}

function stableRank(scored) {
  return scored
    .sort((left, right) =>
      right.score - left.score ||
      right.item.updatedAt.localeCompare(left.item.updatedAt) ||
      left.item.id.localeCompare(right.item.id))
    .map(({ item, score }) => ({ id: item.id, score: Number(score.toFixed(6)) }));
}

export function rankLexicalBaseline(corpus, query) {
  const taskTokens = new Set(lexicalTokens(query.task));
  return stableRank(corpus.filter((item) => eligible(item, query)).map((item) => {
    const searchable = itemText(item);
    const textScore = [...taskTokens].filter((token) => searchable.includes(token)).length;
    return {
      item,
      score: authorityWeight(item.authority) + scopeMatch(item.scope, query.scope) + textScore,
    };
  }));
}

function hashFeature(feature, dimensions) {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dimensions;
}

function featureCounts(value, dimensions) {
  const counts = new Map();
  for (const token of tokenize(value)) {
    const feature = hashFeature(token, dimensions);
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  return counts;
}

function documentFrequencies(corpus, dimensions) {
  const frequencies = new Map();
  for (const item of corpus) {
    for (const feature of featureCounts(itemText(item), dimensions).keys()) {
      frequencies.set(feature, (frequencies.get(feature) ?? 0) + 1);
    }
  }
  return frequencies;
}

function tfIdfVector(value, dimensions, documentCount, frequencies) {
  const vector = new Map();
  for (const [feature, count] of featureCounts(value, dimensions)) {
    const termFrequency = 1 + Math.log(count);
    const inverseDocumentFrequency = Math.log((documentCount + 1) / ((frequencies.get(feature) ?? 0) + 1)) + 1;
    vector.set(feature, termFrequency * inverseDocumentFrequency);
  }
  return vector;
}

function cosineSimilarity(left, right) {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const [feature, value] of left) {
    leftMagnitude += value * value;
    dotProduct += value * (right.get(feature) ?? 0);
  }
  for (const value of right.values()) rightMagnitude += value * value;
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function rankSparseVector(corpus, query, dimensions = 1024) {
  const frequencies = documentFrequencies(corpus, dimensions);
  const queryVector = tfIdfVector(query.task, dimensions, corpus.length, frequencies);
  return stableRank(corpus.filter((item) => eligible(item, query)).map((item) => {
    const itemVector = tfIdfVector(itemText(item), dimensions, corpus.length, frequencies);
    const vectorScore = cosineSimilarity(queryVector, itemVector) * 8;
    return {
      item,
      score: authorityWeight(item.authority) + scopeMatch(item.scope, query.scope) + vectorScore,
    };
  }));
}

function rankingMetrics(rankedIds, relevantIds, k) {
  const relevant = new Set(relevantIds);
  const top = rankedIds.slice(0, k);
  const retrievedRelevant = top.filter((id) => relevant.has(id)).length;
  const firstRelevantIndex = rankedIds.findIndex((id) => relevant.has(id));
  let discountedGain = 0;
  for (const [index, id] of top.entries()) {
    if (relevant.has(id)) discountedGain += 1 / Math.log2(index + 2);
  }
  let idealDiscountedGain = 0;
  for (let index = 0; index < Math.min(relevant.size, k); index += 1) {
    idealDiscountedGain += 1 / Math.log2(index + 2);
  }
  return {
    recallAtK: retrievedRelevant / relevant.size,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAtK: idealDiscountedGain === 0 ? 0 : discountedGain / idealDiscountedGain,
  };
}

function round(value) {
  return Number(value.toFixed(4));
}

function aggregateMetrics(cases) {
  return {
    recallAtK: round(cases.reduce((sum, result) => sum + result.recallAtK, 0) / cases.length),
    mrr: round(cases.reduce((sum, result) => sum + result.reciprocalRank, 0) / cases.length),
    ndcgAtK: round(cases.reduce((sum, result) => sum + result.ndcgAtK, 0) / cases.length),
  };
}

export function evaluateDataset(dataset) {
  const validationErrors = validateEvaluationDataset(dataset);
  if (validationErrors.length > 0) {
    return { evaluationId: dataset?.evaluationId ?? "BRG-130", validationErrors };
  }
  const cases = dataset.cases.map((query) => {
    const baseline = rankLexicalBaseline(dataset.corpus, query);
    const candidate = rankSparseVector(dataset.corpus, query, dataset.hashDimensions);
    const baselineMetrics = rankingMetrics(baseline.map(({ id }) => id), query.relevantIds, dataset.k);
    const candidateMetrics = rankingMetrics(candidate.map(({ id }) => id), query.relevantIds, dataset.k);
    return {
      id: query.id,
      relevantIds: query.relevantIds,
      baselineTopK: baseline.slice(0, dataset.k).map(({ id }) => id),
      candidateTopK: candidate.slice(0, dataset.k).map(({ id }) => id),
      baseline: Object.fromEntries(Object.entries(baselineMetrics).map(([key, value]) => [key, round(value)])),
      candidate: Object.fromEntries(Object.entries(candidateMetrics).map(([key, value]) => [key, round(value)])),
    };
  });
  const baseline = aggregateMetrics(cases.map((result) => result.baseline));
  const candidate = aggregateMetrics(cases.map((result) => result.candidate));
  const recallGain = round(candidate.recallAtK - baseline.recallAtK);
  const meetsMinimumQuality = candidate.recallAtK >= dataset.thresholds.minimumCandidateRecallAtK;
  const demonstratesMaterialGain = recallGain >= dataset.thresholds.minimumRecallGain;
  return {
    evaluationId: dataset.evaluationId,
    datasetVersion: dataset.datasetVersion,
    validationErrors: [],
    corpusCount: dataset.corpus.length,
    caseCount: dataset.cases.length,
    k: dataset.k,
    baseline: { algorithm: "current_weighted_lexical_proxy", ...baseline },
    candidate: { algorithm: "hashed_sparse_tfidf_vector", ...candidate },
    recallGain,
    thresholds: dataset.thresholds,
    verdict: meetsMinimumQuality && demonstratesMaterialGain
      ? "adopt_vector_candidate"
      : "do_not_adopt_vector_candidate",
    reasons: [
      meetsMinimumQuality
        ? "candidate_meets_minimum_recall"
        : "candidate_below_minimum_recall",
      demonstratesMaterialGain
        ? "candidate_has_material_recall_gain"
        : "candidate_has_no_material_recall_gain",
    ],
    limitations: [
      "Synthetic curated records are not production relevance judgments.",
      "The candidate is deterministic sparse TF-IDF, not a hosted dense embedding model.",
      "This offline evaluation measures ranking quality only; it does not measure production latency, cost, or tenant-index operations.",
    ],
    cases,
  };
}

function datasetArgument(argv) {
  const index = argv.indexOf("--dataset");
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error("--dataset requires a file path");
  return argv[index + 1];
}

export async function runEvaluation(argv = process.argv.slice(2)) {
  const dataset = await loadEvaluationDataset(datasetArgument(argv));
  const report = evaluateDataset(dataset);
  process.stdout.write(`${JSON.stringify(report, null, argv.includes("--compact") ? 0 : 2)}\n`);
  return report.validationErrors.length === 0 ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEvaluation();
}
