# Approved specification drift checks

Bridge can fail CI when declared implementation files no longer match the baseline reviewed against a canonical approved specification. This is an explicit provenance check, not semantic source-code analysis.

## Capture a reviewed baseline

After a human-approved artifact version accurately describes the selected implementation files, run:

```bash
bridge spec drift capture \
  --artifact-id art_... \
  --file src/transfer-retry.ts \
  --file test/transfer-retry.test.ts
git add .bridge/spec-drift.json
```

Repeat `--file` for every implementation file covered by that specification. Re-run capture for the same artifact only after reviewing the changed implementation against the currently approved version. Capturing reads the artifact through REST, requires a current approved version, replaces only that artifact's binding, and records:

- project, artifact, and approved-version IDs;
- the canonical approved body SHA-256;
- repository-relative file paths and SHA-256 values;
- capture time and non-secret API source.

It does not publish, approve, supersede, or edit an artifact. The manifest is ordinary reviewable repository evidence; a reviewer must treat an unexplained baseline change like a changed lockfile or policy file.

## Run in CI

Provision a project-restricted `ci` service identity with `bridge:artifacts:read`, save its one-time token in the CI platform's masked secret manager, and run:

```yaml
- name: Check approved specification drift
  env:
    BRIDGE_API_URL: ${{ vars.BRIDGE_API_URL }}
    BRIDGE_SERVICE_TOKEN: ${{ secrets.BRIDGE_SERVICE_TOKEN }}
  run: bridge spec drift check
```

The check compares every bound local file with its captured hash and asks the canonical REST artifact list for the current approved version/hash. JSON output is stable. Exit `0` means every binding matches; exit `10` with `SPECIFICATION_DRIFT` identifies missing/changed implementation files or a missing/changed approved version. Configuration, authentication, and connectivity retain their normal distinct CLI exit codes.

`bridge spec drift check --offline` validates local files only. It is useful in restricted environments but cannot detect that Bridge has approved a newer version, so it is not equivalent to the connected CI gate.

## Safety and limits

- Manifest and bound files must stay inside the repository. Absolute stored paths, `..` traversal, and symlinks escaping the repository fail closed.
- The service token is read only from `BRIDGE_SERVICE_TOKEN`, sent only as a bearer header in OIDC mode, and never written to the repository, output, or errors.
- Hash equality detects declared-file changes; it does not prove semantic compliance, cover undeclared files, inspect commits or pull requests, or attest that a manifest edit was honestly reviewed.
- REST remains canonical, MCP is unnecessary, and only the existing human review/approval workflow can make a specification authoritative.
