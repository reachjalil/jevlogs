# Releasing jevlogs

`pnpm release` publishes the version in `package.json`. It runs every check first, publishes the exact tarball that passed the smoke test, and only then tags, pushes, and creates the GitHub release.

## One-time setup

- `npm login` with an account that can publish `jevlogs`. `npm whoami` should print your username. npm asks for your one-time password, or opens the browser, during the publish.
- `gh auth login`, so the script can create the GitHub release. Without it, the script prints the `gh` command to run later.
- pnpm 10. `packageManager` pins 10.15.1 and CI uses that version: `npm install -g pnpm@10.15.1`.

## Cut a release

1. Bump the version: `npm version minor --no-git-tag-version`, or edit `package.json`.
2. Add `## x.y.z — YYYY-MM-DD` to the top of `CHANGELOG.md`. If the first line under the heading is 72 characters or fewer, it becomes the GitHub release title.
3. Commit, merge to `main`, and wait for CI to pass.
4. On `main`, run `pnpm release --dry-run`. It runs every check and `npm publish --dry-run`, and changes nothing.
5. Run `pnpm release`, type the version to confirm, and approve npm's 2FA prompt.

## What `pnpm release` checks and does

| Step | What happens | Stops when |
| --- | --- | --- |
| Preflight | Compares the branch with `origin`, then checks the tag, npm, the changelog, and your login | not on `main`, uncommitted changes, behind `origin`, tag exists, version already on npm, the dist-tag would move backwards, no changelog section, not logged in |
| Verify | `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm check:examples`, `pnpm lint:package` (publint and Are the Types Wrong) | any command fails |
| Pack | `pnpm pack`, lists every file, prints the sha512 integrity | a required file is missing or a test, benchmark, `.env`, or tarball file would ship |
| Smoke | `scripts/smoke.mjs` on that tarball: pnpm with strict peers, npm, TypeScript 5.9 and 7.0 with `skipLibCheck` off, the CLI, the receiver, `require()`, and the exporter on OpenTelemetry 0.200.0 and 0.222.0 | any check fails |
| Confirm | Shows the package, dist-tag, tarball, and integrity | you do not type the version |
| Publish | `npm publish <tarball> --access public --tag <dist-tag>`, then `git tag -a vX.Y.Z`, `git push --atomic origin main vX.Y.Z`, and `gh release create` with the changelog section and the tarball attached | — |
| Verify | Waits for npm to list the version, then runs `npx jevlogs@X.Y.Z --version` from a clean directory | — |

Options:

- `--dry-run` runs every check and `npm publish --dry-run`. A dirty tree or a non-`main` branch only warns.
- `--tag <name>` sets the npm dist-tag. The default is `latest`, or `next` for a prerelease such as `0.7.0-rc.1`. A prerelease cannot go to `latest`.
- `--allow-branch` releases from a branch other than `main`.
- `--yes` skips the typed confirmation, for scripted use.

`pnpm smoke` runs the smoke test alone; it packs the working tree when no tarball is given.

## When something goes wrong

- **Before the publish step:** nothing has changed. Fix the problem and run the script again.
- **After the publish step:** the package is live. If the tag, push, or GitHub release failed, the script prints the commands that are left.
- **A bad release:** npm does not allow a version to be published twice. Deprecate it with `npm deprecate jevlogs@x.y.z "Use x.y.z+1"`, then publish a fixed patch. To point `latest` back at a good version, run `npm dist-tag add jevlogs@<good> latest`.

## History

- 0.4.0 and 0.5.0 were tagged on GitHub but never published to npm. 0.6.0 is the first npm release after 0.3.0, and its changelog includes the upgrade notes.
- Releases before 0.6.0 were published by hand from a local tarball.
- `npm-placeholder/` is historical reservation material. Git ignores it and it is not part of any release.

## 0.6.0 announcement

> jevlogs 0.6.0 is on npm. It scores log lines with Jev and decides which ones are worth sending to a more expensive LLM, and which ones should page on-call. This release brings the pager, template cache, labeled recall and precision scoring, and the model-call budget to npm, and fixes installs with strict pnpm peers, TypeScript projects without OpenTelemetry, and exporter shutdown on older OpenTelemetry SDKs. Try `pnpm dlx jevlogs` or `npx jevlogs` for the offline demo. MIT licensed: https://github.com/reachjalil/jevlogs
