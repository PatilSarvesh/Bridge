import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const manifestUrl = new URL("../config/pilot-readiness.json", import.meta.url);
const allowedStatuses = new Set([
  "complete",
  "repository_verified",
  "external_required",
  "documented_followup",
]);
const expectedCriteria = [1, 2, 3, 4, 5, 6];

export async function loadReadinessManifest() {
  return JSON.parse(await readFile(manifestUrl, "utf8"));
}

function isSafeEvidenceValue(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !/postgres(?:ql)?:\/\/|\bBearer\s+|-----BEGIN/i.test(value)
  );
}

export function validateReadinessManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (manifest?.reviewId !== "BRG-112") errors.push("reviewId must be BRG-112");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest?.lastReviewed ?? "")) {
    errors.push("lastReviewed must be an ISO calendar date");
  }
  if (!Array.isArray(manifest?.checks) || manifest.checks.length !== expectedCriteria.length) {
    errors.push("checks must contain exactly the six BRG-112 criteria");
    return errors;
  }

  const seenIds = new Set();
  const seenCriteria = new Set();
  for (const check of manifest.checks) {
    if (!check || typeof check !== "object") {
      errors.push("each check must be an object");
      continue;
    }
    if (typeof check.id !== "string" || seenIds.has(check.id)) errors.push(`duplicate or invalid check id: ${check.id}`);
    seenIds.add(check.id);
    if (!expectedCriteria.includes(check.criterion) || seenCriteria.has(check.criterion)) {
      errors.push(`criterion must be unique and numbered 1-6: ${check.criterion}`);
    }
    seenCriteria.add(check.criterion);
    if (!allowedStatuses.has(check.status)) errors.push(`invalid status for ${check.id}: ${check.status}`);
    if (typeof check.externalEvidenceRequired !== "boolean") {
      errors.push(`externalEvidenceRequired must be boolean for ${check.id}`);
    }
    if (typeof check.owner !== "string" || check.owner.length === 0) errors.push(`owner is required for ${check.id}`);
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
      errors.push(`evidence is required for ${check.id}`);
    } else {
      for (const evidence of check.evidence) {
        if (!evidence || typeof evidence.kind !== "string" || !isSafeEvidenceValue(evidence.value)) {
          errors.push(`unsafe or incomplete evidence for ${check.id}`);
        }
      }
    }
  }
  for (const criterion of expectedCriteria) {
    if (!seenCriteria.has(criterion)) errors.push(`missing criterion ${criterion}`);
  }
  return errors;
}

function isCompleteForPilot(check) {
  return check.status === "complete" || (!check.externalEvidenceRequired && check.status === "repository_verified");
}

export function summarizeReadiness(manifest) {
  const validationErrors = validateReadinessManifest(manifest);
  const checks = Array.isArray(manifest?.checks) ? manifest.checks : [];
  const pendingExternalCriteria = checks
    .filter((check) => check.externalEvidenceRequired && check.status !== "complete")
    .map((check) => check.criterion);
  const pilotReady = validationErrors.length === 0 && checks.length === expectedCriteria.length && checks.every(isCompleteForPilot);
  return {
    reviewId: manifest?.reviewId ?? "BRG-112",
    lastReviewed: manifest?.lastReviewed ?? null,
    validationErrors,
    checkCount: checks.length,
    completedCriteria: checks.filter(isCompleteForPilot).map((check) => check.criterion),
    pendingExternalCriteria,
    pilotReady,
    decision: pilotReady ? "ready_for_external_pilot" : "not_ready_for_external_pilot_evidence",
  };
}

export function formatHumanReport(manifest, summary) {
  const lines = [
    `Bridge ${summary.reviewId} readiness review`,
    `Reviewed: ${summary.lastReviewed ?? "unknown"}`,
    `Decision: ${summary.decision}`,
    "",
  ];
  for (const check of manifest.checks ?? []) {
    const state = check.status === "complete" || (!check.externalEvidenceRequired && check.status === "repository_verified") ? "complete" : "pending";
    lines.push(`${state.padEnd(8)} criterion ${check.criterion}: ${check.title}`);
  }
  if (summary.pendingExternalCriteria.length > 0) {
    lines.push("", `External evidence pending: ${summary.pendingExternalCriteria.join(", ")}`);
  }
  if (summary.validationErrors.length > 0) {
    lines.push("", `Manifest errors: ${summary.validationErrors.join("; ")}`);
  }
  return lines.join("\n");
}

export async function runReadiness(argv = process.argv.slice(2)) {
  const manifest = await loadReadinessManifest();
  const summary = summarizeReadiness(manifest);
  const json = argv.includes("--json");
  const strict = argv.includes("--strict");
  if (json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    process.stdout.write(`${formatHumanReport(manifest, summary)}\n`);
  }
  if (summary.validationErrors.length > 0) return 2;
  if (strict && !summary.pilotReady) return 10;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runReadiness();
}
