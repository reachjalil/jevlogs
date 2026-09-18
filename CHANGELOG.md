# Changelog

## Unreleased

- **Template fingerprints.** After redaction, identifiers (UUIDs, IPs, timestamps, mixed hex IDs, durations, 6+ digit numbers) become `<*>`. Matching templates share one cached Jev decision and one in-flight model call. HTTP status codes, percentages, and other small numbers stay literal, so `200` and `500` do not collapse. Decisions carry `fingerprint` and `fingerprintHits`; OpenTelemetry gets `jev.fingerprint` and `jev.fingerprint_hits`. Disable with `fingerprint: false`. Failures are still never cached. `fingerprintLog()` is exported for inspection.

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
