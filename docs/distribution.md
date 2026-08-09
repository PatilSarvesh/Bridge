# Bridge CLI distribution

Bridge can be installed without MCP and without publishing to npm. The current release path attaches a tested CLI tarball and SHA-256 checksum to a GitHub Release.

## Maintainer release

1. Update `apps/cli/package.json` to the intended semantic version.
2. Run `pnpm check`. This now builds the tarball, installs it globally under a temporary prefix, executes the packaged `bridge` binary through its installed symlink, and verifies a no-mutation fresh-project dry run.
3. Commit and push the version change through the normal review process.
4. Create and push the matching annotated tag, for example `v0.1.0` for CLI version `0.1.0`.
5. The `CLI Release` GitHub Actions workflow re-runs validation, rejects a tag/version mismatch, creates the checksum, and creates the GitHub Release.

Tagging and publishing are deliberate maintainer actions. The workflow does not publish to npm, create user accounts, configure authentication, or perform organization onboarding.

## Install from a GitHub Release

Install a specific immutable release globally:

```bash
npm install --global \
  https://github.com/PatilSarvesh/Bridge/releases/download/v0.1.0/bridge-cli-0.1.0.tgz

bridge --help
```

Teams can mirror the tarball and checksum into an approved internal artifact store and install the mirrored URL the same way. The installed `bridge` command uses the canonical REST API; MCP remains optional.

## Repository-local installation

Teams that prefer a pinned project dependency can download the tarball and install it with pnpm:

```bash
pnpm add --save-dev ./bridge-cli-0.1.0.tgz
pnpm exec bridge init --name "My Project" --client codex --api-url https://bridge.example.test
```

If application dependency policy prevents `pnpm exec` from running an already installed package, use `./node_modules/.bin/bridge`. The generated repository instructions include this fallback.

## Registry boundary

The package remains private for registry purposes until the owner selects and controls a public or organization scope. A future registry release must choose the final package name, remove the private marker intentionally, add the target registry/provenance settings, and verify ownership before publication. Do not infer or claim an npm namespace from the GitHub username.
