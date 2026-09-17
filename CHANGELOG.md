# Changelog

## 0.4.0 — 2026-09-17

Jev Logs can page on-call, not only skip LLM analysis.

- **`createJevPager()`.** One boolean (`page_now`). Your code fires when `probability >= pageAbove` (default 0.50). Discrete urgency is not used. INFO is not a veto. ERROR is not an auto-page.
- **Unavailable calls do not page** unless `pageWhenUnavailable: true` (a 503 must not wake people).
- **`JevPagerExporter`** annotates `jev.page` / `jev.page_probability`. `mode: "pages-only"` forwards only pages.
- **CLI `--page`** and config `intent: "page"` with `pageAbove`. Offline demo includes an INFO replica-lag page and an ERROR coupon hold.
- **`shouldPage(probability, pageAbove)`** for the same cut on stored scores.

Triage (`createJevLogs`) is unchanged: ERROR/FATAL still skip the model and stay eligible for analysis.

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
