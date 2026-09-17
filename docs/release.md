# Releases

## v0.3.0 — forwarding receiver, rules, cache, streaming CLI

See CHANGELOG.md. Publish with the same steps as below, using `./jevlogs-0.3.0.tgz`.

## v0.1.1 — npm library + npx CLI

The root package is the functional release. `npm-placeholder/` is historical reservation material, ignored by Git and excluded from the release.

- `npm install jevlogs`: typed SDK imports.
- `npx jevlogs`: labeled offline sample demo without credentials or network.
- `npx jevlogs --live`: real Jev sample evaluation using AI_GATEWAY_API_KEY.
- `npx jevlogs --live --file app.log` or `--stdin --json`: bounded custom log evaluation.
- OpenTelemetry is optional for the standalone API/CLI; install the peer for the exporter integration.

## Publish

Run `pnpm test`, `pnpm check:examples`, `pnpm site:build`, `pnpm pack`, then test the packed CLI in a clean directory. Publish the inspected archive with `npm publish ./jevlogs-0.1.1.tgz --access public --tag latest`. Verify npm's latest version and run the public npx command before claiming availability.

## Announcement

Jev Logs is on npm. Try `npx jevlogs` for an offline walkthrough, then add `--live` and your Gateway key to evaluate logs with Jev. Use `npm install jevlogs` to add value scoring and prioritization to your OpenTelemetry pipeline. MIT licensed, built with Vercel AI SDK. v0.1 preview: measure incident recall and savings on your own workload.
