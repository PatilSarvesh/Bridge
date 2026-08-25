import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDataset,
  loadEvaluationDataset,
  rankLexicalBaseline,
  rankSparseVector,
  validateEvaluationDataset,
} from "./context-retrieval-eval.mjs";

test("BRG-130 dataset is valid, synthetic, and deterministically evaluated", async () => {
  const dataset = await loadEvaluationDataset();
  assert.deepEqual(validateEvaluationDataset(dataset), []);
  assert.match(dataset.description, /synthetic/i);

  const first = evaluateDataset(dataset);
  const second = evaluateDataset(structuredClone(dataset));
  assert.deepEqual(second, first);
  assert.equal(first.validationErrors.length, 0);
  assert.equal(first.corpusCount, 20);
  assert.equal(first.caseCount, 12);
  assert.equal(first.k, 5);
});

test("baseline and sparse-vector rankings preserve authority and exact scope signals", () => {
  const corpus = [
    {
      id: "approved-scope",
      type: "decision",
      authority: "approved",
      categories: ["reliability"],
      title: "Retry queue work",
      summary: "Retry transient failures",
      body: "Bounded attempts",
      scope: { component: "payments" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "assumption-other",
      type: "assumption",
      authority: "assumption",
      categories: ["reliability"],
      title: "Retry queue work",
      summary: "Retry transient failures",
      body: "Bounded attempts",
      scope: { component: "notifications" },
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
  const query = {
    task: "retry transient failures",
    scope: { component: "payments" },
    categories: ["reliability"],
  };
  assert.equal(rankLexicalBaseline(corpus, query)[0].id, "approved-scope");
  assert.equal(rankSparseVector(corpus, query)[0].id, "approved-scope");
});

test("evaluation computes standard metrics and keeps adoption threshold explicit", async () => {
  const dataset = await loadEvaluationDataset();
  const report = evaluateDataset(dataset);
  for (const metrics of [report.baseline, report.candidate]) {
    assert.ok(metrics.recallAtK >= 0 && metrics.recallAtK <= 1);
    assert.ok(metrics.mrr >= 0 && metrics.mrr <= 1);
    assert.ok(metrics.ndcgAtK >= 0 && metrics.ndcgAtK <= 1);
  }
  assert.equal(report.verdict, "do_not_adopt_vector_candidate");
  assert.ok(report.recallGain < report.thresholds.minimumRecallGain);
  assert.match(report.limitations.join(" "), /not a hosted dense embedding model/i);

  const permissive = structuredClone(dataset);
  permissive.thresholds.minimumRecallGain = 0;
  assert.equal(evaluateDataset(permissive).verdict, "adopt_vector_candidate");
});

test("validation rejects duplicate records and unknown relevance labels", async () => {
  const dataset = await loadEvaluationDataset();
  const invalid = structuredClone(dataset);
  invalid.corpus.push(structuredClone(invalid.corpus[0]));
  invalid.cases[0].relevantIds.push("missing_record");
  const errors = validateEvaluationDataset(invalid).join("\n");
  assert.match(errors, /duplicate or invalid corpus id/);
  assert.match(errors, /unknown relevant id missing_record/);
  assert.deepEqual(evaluateDataset(invalid).validationErrors, validateEvaluationDataset(invalid));
});
