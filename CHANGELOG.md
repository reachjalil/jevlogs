# Changelog

## 0.6.0 — 2026-09-30

First npm release since 0.3.0, with clean pnpm and TypeScript installs.

It ships the 0.4.0 pager and template cache and the 0.5.0 labeled scores and model budget, and fixes three problems that stopped the package from installing, type-checking, or shutting down cleanly.

### Fixed

- **`zod` is now provided.** `ai` needs `zod` as a peer and jevlogs did not supply it. Where peers are not auto-installed, such as pnpm with `auto-install-peers=false`, every command failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'`, and pnpm 12 refused the install. `zod` is now a dependency with the range `ai` accepts.
- **TypeScript without OpenTelemetry.** The declarations imported `@opentelemetry/sdk-logs`, an optional peer, so projects without it failed `tsc` with TS2307 unless `skipLibCheck` was on. The exporter now uses structural types, `LogRecordLike`, `LogRecordExporterLike`, and `ExportResultLike`, which real OpenTelemetry records and exporters satisfy. Existing exporter code compiles unchanged.
- **Exporter shutdown on older OpenTelemetry.** `JevLogExporter` always called `forceFlush()` on the wrapped exporter. Exporters from `@opentelemetry/sdk-logs` 0.200 have none, so `forceFlush()` and `shutdown()` threw `TypeError`. It is now called only when present.

### Changed

- **OpenTelemetry peer range.** `@opentelemetry/sdk-logs` is accepted from `>=0.200.0 <1` instead of exactly 0.222.0, so pnpm stops warning on other versions. The exporter is tested on 0.200.0 and 0.222.0. Older SDKs take the exporter as the first processor argument instead of `{ exporter }`.
- **Package entry points.** `exports` adds a `default` condition and `./package.json`. CommonJS code on Node.js 22.12 or newer can `require('jevlogs')`, and tools that read `jevlogs/package.json` no longer get `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Go to definition opens the source.** The package ships declaration maps, source maps, `src/`, and this changelog.

### Upgrading from npm 0.3.0

Everything under 0.4.0 and 0.5.0 below is new on npm. Check these before you upgrade:

- `Decision.reason` can be `'budget'` when `maxModelCalls` is set. An exhaustive `switch` over `reason` needs that case.
- The decision cache keys on normalized templates, so lines that differ only in UUIDs, IPs, timestamps, paths, or hex ids share one decision. Set `normalizeTemplates: false` to cache exact inputs as 0.3.0 did.
- `service` on `triage()`, and resource `service.name` in the exporter and receiver, is sent to the model with the redacted body. Other attributes stay local.
- The CLI maps Pino levels 10–60 to OpenTelemetry severity, so numeric level 50 and 60 lines are protected on the analysis path and skip the model.

### Release tooling

- `pnpm smoke` installs the packed tarball with pnpm (strict peers, no auto-install) and npm, type-checks it with TypeScript 5.9 and 7.0 under `nodenext` and `bundler` with `skipLibCheck` off, and runs the CLI, the receiver, `require()`, and the exporter on OpenTelemetry 0.200.0 and 0.222.0.
- `pnpm lint:package` runs publint and Are the Types Wrong.
- `pnpm release` publishes the tarball that passed those checks, then tags, pushes, and creates the GitHub release. `pnpm release --dry-run` changes nothing.
- CI tests Node.js 22, 24, and 26 and runs the package lint and smoke test.

## 0.5.0 — 2026-09-21

_Tagged on GitHub; first published to npm in 0.6.0._

Measure a filter before trusting it, and keep a page from repeating.

- **Labeled scores.** `scoreDecisions()` and `npx jevlogs --labels` read `important` or `label` on each JSONL record and print recall, precision, and the lines that were missed. A miss exits 2. Labels are not sent to the model. `important: true` records must stay selected (`analyze`, or `page` when `--page` is set).
- **Page cooldown.** `suppressForMs` holds later copies of a template that already paged, without another model call. `--suppress-ms` sets it. The window does not refresh on the held copies.
- **Model-call budget.** `maxModelCalls` stops further model invocations. Analysis routing fails open (`reason: "budget"`, route `analyze`). The pager holds. Rules, cache hits, and local severity bypasses do not spend the budget.

## 0.4.0 — 2026-09-21

_Not published separately; first on npm in 0.6.0._

Paging, template caching, and cheaper repeat traffic. Analysis routing is unchanged: a record is retained only when it is confidently low-value.

- **Pager.** `createJevPager()` asks Jev one boolean question, `page_now`, and `shouldPage()` applies your probability threshold in code (default 0.5). ERROR lines are scored, not auto-paged. FATAL, CRITICAL, `severityNumber >= 21`, and `protected: true` page with no model call. Timeouts hold by default so an outage does not page the world. `npx jevlogs --page` runs the same policy on a sample, file, or stdin stream.
- **Template cache.** Cache keys collapse UUIDs, IPs, timestamps, paths, hex ids, block ids, and long numbers. Durations and short values such as `47m` and `94%` stay distinct, and the model still sees the redacted original. Set `normalizeTemplates: false` to cache exact inputs.
- **Service name.** `service` on `triage()` / `decide()`, and resource `service.name` from the exporter and receiver, is included in model input. Other attributes stay local.
- **Break-even.** `estimateSavings()` returns `breakEvenSkipFraction`, the share of logs that must skip downstream analysis for triage not to raise the bill.
- **CLI levels.** JSONL accepts `msg`. Pino levels 10–60 map to OpenTelemetry severity, so numeric ERROR lines are protected on the analysis path.
- **OTLP HTTP protobuf.** `POST /v1/logs` accepts `application/x-protobuf` in addition to JSON, including gzip. Java, Go, Python, and Collector HTTP exporters work without switching to `http/json`. gRPC is rejected with HTTP 501. Forwarding remains OTLP HTTP/JSON.

## 0.3.0 — 2026-09-16

The receiver becomes a usable pipeline stage instead of a printer.

- **Forwarding.** `forwardUrl` sends every batch on to your OTLP HTTP/JSON collector with `jev.*` attributes attached. `forwardMode: "analysis-only"` forwards just the records routed to analysis. Upstream failures return a retryable 503 before any local output, so nothing is double-delivered. Headers come from `OTEL_EXPORTER_OTLP_LOGS_HEADERS` / `OTEL_EXPORTER_OTLP_HEADERS`.
- **Rules.** `rules` in the config or `createJevLogs()` match the redacted body before the cache and the model. First match wins; protected records are never affected. Decisions carry `reason: "rule"` and the rule name.
- **Decision cache.** Identical redacted inputs share one in-flight model call and are then served from an in-memory LRU cache (1,000 entries, 5 minutes by default; `cacheSize: 0` disables it). Cached decisions are marked `cached: true` and annotated with `jev.cached`. Failures are never cached.
- **Stats.** `jev.stats()`, `exporter.stats()`, `server.stats()` and `GET /stats` report decisions, model calls, cache and rule hits, protected and unavailable counts, routes, model latency, provider-reported input tokens, and receiver counters.
- **Streaming CLI.** `--stdin --follow` evaluates each line as it arrives with four evaluations in flight and no record limit; `tail -f app.log | npx jevlogs --live --stdin --follow --json` works.
- **Receiver concurrency.** Up to 8 requests are accepted at once (`maxRequests`), sharing 4 evaluation slots (`concurrency`). `onLog` is optional when forwarding.
- **CLI.** Version is read from `package.json`; summaries include cache hits, rule hits, average Jev latency and input tokens. Fixed the offline demo showing the wrong fixture answer after a protected record.
- **Tests.** 33 tests, including a forwarding round trip through a stand-in collector, in-flight coalescing, streaming stdin, and an opt-in live test that runs only when `AI_GATEWAY_API_KEY` is set.

Breaking for TypeScript consumers: `Decision` gains the required `cached` field and the `rule` reason; `Evaluation` gains optional `inputTokens`.

## 0.2.0

Config-driven local OTLP HTTP/JSON receiver, `jevlogs/server` API, `jevlogs.config.json` with `envFile`.

## 0.1.1

npm library and `npx jevlogs` CLI with offline demo, live sample, file and stdin modes.
