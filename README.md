<p align="center">
  <img src="https://raw.githubusercontent.com/reachjalil/jevlogs/main/docs/assets/readme-banner.png" alt="Jev Logs. Keep your logs. Spend on the signal." width="100%" />
</p>

<h1 align="center">Jev Logs</h1>

<p align="center">
  <strong>Score OpenTelemetry logs before expensive LLM analysis.</strong><br />
  Diagnostic value, priority, and routing with TypeSafe's Jev. Every record stays in your archive.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/jevlogs"><img src="https://img.shields.io/npm/v/jevlogs?style=flat-square&color=2448ff" alt="npm version" /></a>
  <a href="https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml"><img src="https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/reachjalil/jevlogs/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2448ff?style=flat-square" alt="MIT license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A522-11131b?style=flat-square" alt="Node.js 22 or later" /></a>
  <a href="#project-status"><img src="https://img.shields.io/badge/status-preview-8b5cf6?style=flat-square" alt="Status: preview" /></a>
</p>

<p align="center">
  <a href="https://jevlogs.com"><strong>Website</strong></a> ·
  <a href="https://jevlogs.com/guide/"><strong>Guide</strong></a> ·
  <a href="https://jevlogs.com/llms.txt"><strong>llms.txt</strong></a> ·
  <a href="https://www.npmjs.com/package/jevlogs"><strong>npm</strong></a> ·
  <a href="https://github.com/reachjalil/jevlogs/issues"><strong>Feedback</strong></a>
</p>

---

## What Jev Logs does

Health checks and cache hits still hit a reasoning model if you send every event. That costs money before you start investigating.

Jev Logs scores each log first: how useful it is, how urgent it is, and whether it should go to deeper analysis. It uses [TypeSafe's Jev](https://typesafe.ai/) through the Vercel AI SDK, with a TypeScript API and an OpenTelemetry exporter wrapper.

| Layer | What you get |
| :--- | :--- |
| **Score** | A 0-100 diagnostic-value score, priority, and actionable probability. |
| **Keep the pipeline** | Wrap your existing exporter. Resource, scope, timestamps, and trace context stay on the record. |
| **Annotate first** | Annotation mode keeps every record and attaches `jev.*` attributes. |
| **Route later** | Confidently low-value events can skip a separate LLM-analysis branch. |
| **Keep uncertain records** | Errors, protected records, ambiguity, and provider failures stay eligible for analysis. |

## Start a local OpenTelemetry receiver with one config

Requires Node.js 22+. Install `npm install jevlogs`, or use `npx` directly. Add **`jevlogs.config.json` at your project root**:

```json
{
  "envFile": ".env",
  "port": 4318,
  "retainBelow": 0.1,
  "timeoutMs": 2000,
  "maxInputChars": 8000
}
```

Create `.env` beside it:

```dotenv
AI_GATEWAY_API_KEY=your-vercel-ai-gateway-key
```

Add `.env` to your `.gitignore`. Commit the JSON config, not your key. Create a key in your [Vercel AI Gateway dashboard](https://vercel.com/docs/ai-gateway/authentication-and-byok). This is **your Gateway key**, not an OpenAI key or a Jev Logs account. Provider usage is charged to your Gateway account. The AI SDK reads it server-side to authenticate Jev requests. Applications sending OTLP logs do not need this key. The website never receives it.

Run from that project root:

```sh
npx jevlogs@latest --live
```

The receiver listens at **`http://127.0.0.1:4318/v1/logs`** and stays running until Ctrl+C. `GET /health` checks the receiver, not model availability. It prints one JSON decision per record to stdout, with available trace/span IDs and timestamp. It does not print raw log bodies or store your logs. Keep your existing archive/export pipeline.

The default config is read from your current working directory. Use `--config ./config/jevlogs.json` for another location; `envFile` resolves relative to that config. Existing environment variables take precedence over `.env`. `--port 4320` overrides the config port. All settings are optional; you can omit `envFile` when your shell or secret manager already supplies `AI_GATEWAY_API_KEY`. Unknown configuration keys fail clearly. Never put an API key directly in the JSON.

| Setting | Default | Meaning |
| --- | --- | --- |
| `envFile` | None | Local dotenv file to load; explicit missing files fail startup |
| `port` | `4318` | Local HTTP receiver port |
| `retainBelow` | `0.1` | Actionable-probability threshold, from 0 through 0.5; low value and low priority are also required to retain |
| `timeoutMs` | `2000` | Per-record model timeout; failures remain eligible for analysis |
| `maxInputChars` | `8000` | Maximum serialized model input; oversized input remains eligible for analysis |
| `forwardUrl` | None | OTLP HTTP/JSON logs endpoint that receives the annotated batch, for example your Collector at `http://127.0.0.1:4320/v1/logs` |
| `forwardMode` | `annotate` | `annotate` forwards every record with `jev.*` attributes; `analysis-only` forwards only records routed to analysis |
| `rules` | `[]` | Regular expressions tested against the redacted body before any model call; first match wins |
| `cacheSize` | `1000` | Decisions kept in memory, keyed by a hash of the normalized redacted input; `0` disables the cache |
| `cacheTtlMs` | `300000` | How long a cached decision stays valid |
| `normalizeTemplates` | `true` | Collapse IPs, UUIDs, timestamps, paths, and long ids in the cache key. The model still sees the redacted original. `false` caches exact inputs |
| `maxModelCalls` | None | Stop calling the model after this many invocations. Later analysis records stay eligible with `reason: "budget"`. The pager holds |
| `suppressForMs` | `0` | With `--page`, hold repeats of a template that already paged, for up to 24 hours |

### Send logs from your application

POST OTLP HTTP to `/v1/logs` as JSON (`application/json`) or protobuf (`application/x-protobuf`). gzip is accepted. gRPC is not supported and returns HTTP 501. Java, Go, Python, and Collector HTTP exporters already default to protobuf, so they do not need `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json`.

With the JavaScript JSON exporter:

```sh
npm install @opentelemetry/sdk-logs@0.222.0 @opentelemetry/exporter-logs-otlp-http@0.222.0
```

```ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const provider = new LoggerProvider({
  processors: [new BatchLogRecordProcessor({
    exporter: new OTLPLogExporter({
      url: 'http://127.0.0.1:4318/v1/logs',
    }),
    maxExportBatchSize: 16,
    exportTimeoutMillis: 15000,
  })],
});
provider.getLogger('my-app').emit({
  body: 'GET /health returned 200',
  severityNumber: 9,
});
await provider.shutdown(); // Flush once when your application exits.
```

For other language SDKs, point the logs endpoint at the receiver. Protobuf is the default:

```dotenv
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:4318/v1/logs
```

JSON still works if you set `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json`. Environment variables configure an installed exporter; they do not instrument your application automatically. Keep batches at 16 records for the default timeouts. The receiver accepts uncompressed or gzip JSON and protobuf, up to 1 MiB and 100 records per request, with four evaluations in flight. Concurrent batches receive HTTP 503 with `Retry-After`; let a retry-capable exporter handle backpressure. It binds to loopback only. This preview is a local development receiver, not a remote hosted collector.

### Embed the same receiver in an npm application

```ts
import { startJevLogsServer, loadJevConfig } from 'jevlogs/server';

const server = await startJevLogsServer({
  ...await loadJevConfig(),
  async onLog({ resource, scope, logRecord, decision }) {
    // Original OTLP fields are preserved. Connect your own durable sink here.
    // decision.route tells you whether deeper LLM analysis is recommended.
    console.log(JSON.stringify({ decision, traceId: logRecord.traceId }));
  },
});
console.log(server.url);
// During application shutdown: await server.close();
```

`onLog` is called for every record, including those marked `retain`. Redaction applies to model input; the callback receives the original record, so apply your own storage policy. HTTP success acknowledges callback completion, not durable storage. Callback failures return OTLP partial-success counts; compliant clients do not retry rejected records in a partial-success response. Persist within your callback if delivery matters. Retried requests are not deduplicated.

Only the body, severity, and `service.name` go into model input, after the SDK's redaction. Other resource attributes, scope, and trace IDs stay on the callback record and are not sent. Errors and `jev.protected=true` records bypass inference. Default redaction is a starting point, not a complete sensitive-data policy.

For a one-time model demonstration instead of starting the receiver, run `npx jevlogs --live --sample`. File and stdin modes still work as finite batches.
### Forward annotated logs to your collector

Point your application at Jev Logs and Jev Logs at the collector you already run. Every record continues on with `jev.*` attributes attached; nothing is stored in between.

```json
{
  "envFile": ".env",
  "forwardUrl": "http://127.0.0.1:4320/v1/logs",
  "forwardMode": "annotate",
  "rules": [
    { "name": "health", "match": "^GET /health", "route": "retain" }
  ]
}
```

```text
your app ──OTLP HTTP (JSON or protobuf)──▶ jevlogs :4318 ──annotated OTLP JSON──▶ collector :4320
```

Forwarding happens before the local decision output, so an upstream failure returns HTTP 503 with `Retry-After` and your exporter resends the batch. Authentication headers for the upstream come from `OTEL_EXPORTER_OTLP_LOGS_HEADERS` or `OTEL_EXPORTER_OTLP_HEADERS` in the receiver's environment, using the standard `key=value,key=value` syntax. `analysis-only` mode forwards just the records routed to analysis, which is how you feed a separate LLM-analysis pipeline without touching your archive.

Rules run after protection and redaction and before the cache or the model, so known noise costs nothing. A `retain` rule produces `value: 0`, `priority: low`; an `analyze` rule produces the conservative fallback. ERROR/FATAL and `jev.protected` records are never affected by rules. Identical redacted inputs share one model call and are then served from an in-memory cache, marked `cached: true`. `GET /stats` reports requests, records, forwarded batches, cache hits, rule hits, model latency and reported input tokens.


## What you can build today

| Use case | How to use Jev Logs | What stays in your application |
| :--- | :--- | :--- |
| **Triage a batch of application logs** | Run the live CLI on a text file or JSONL snapshot. | Log collection, retention, and human investigation. |
| **Prioritize an incident-analysis queue** | Call `triage()` before enqueueing expensive reasoning work. | The queue, retries, and downstream analysis model. |
| **Explore signal quality in an OTel backend** | Wrap your exporter in annotation mode and inspect `jev.*` attributes. | Your exporter, backend queries, alerts, and dashboards. |
| **Filter only the LLM analysis branch** | Preserve an archive processor and add a separate `analysis-only` processor. | Archive delivery and analysis-queue delivery. |
| **Keep audit events eligible for analysis** | Set `protected: true` in standalone/CLI input or `jev.protected: true` in OTel attributes. | Your policy for deciding which records are protected. |
| **Plan an analysis budget** | Use `estimateSavings()` with measured volume and your model prices. | Actual token metering and billing verification. |

**[Read the capability and integration guide](https://jevlogs.com/guide/)**

The guide includes the full CLI reference, JSONL schema, decision fields, configuration defaults, an archive-plus-analysis pipeline, redaction examples, cost calculation, and troubleshooting. [Read the same guide on GitHub](docs/guide.md).

## Try it in one command

```sh
npx jevlogs
```

No setup. No API key. A clearly labeled **offline demo** walks through four sample logs with fixed answers:

```text
   0 / 100  low      RETAIN   GET /health returned 200 in 2ms
  25 / 100  low      RETAIN   Cache hit for product:482
 100 / 100  critical ANALYZE  Payment capture failed after three retries
  75 / 100  high     ANALYZE  Database connection pool at 94% capacity

4 logs preserved · 2 selected for analysis · 2 may skip deeper analysis.
```

*Illustrative output. The default demo makes no network requests and does not run Jev inference.*

### Try real Jev

Set `AI_GATEWAY_API_KEY` in your environment, then choose your input:

```sh
# Evaluate the included sample logs with Jev
npx jevlogs --live --sample

# Evaluate a local log file
npx jevlogs --live --file ./app.log --limit 20

# Pipe JSONL in; get machine-readable decisions out
cat app.jsonl | npx jevlogs --live --stdin --json

# Follow a live stream; each line is evaluated as it arrives
tail -f app.log | npx jevlogs --live --stdin --follow --json
```

Live mode sends redacted log bodies to Vercel AI Gateway / TypeSafe and incurs provider charges. Your files remain unchanged. Get access through [AI Gateway](https://vercel.com/ai-gateway/models/jev).

<details>
<summary><strong>CLI input, limits, and exit codes</strong></summary>

- Accepts plain text or JSONL with `body`/`message`/`msg`, `severityNumber`, `severityText`/`level`, `service`, and `protected`.
- Pino levels 10, 20, 30, 40, 50, and 60 map to TRACE, DEBUG, INFO, WARN, ERROR, and FATAL.
- Processes 20 records by default, up to 100 with `--limit`; total input is capped at 1 MiB.
- `--follow` streams stdin line by line with no record limit, four evaluations in flight, and ends at EOF.
- `--json` emits one decision per line without raw bodies. Headers and summaries go to stderr.
- Provider failures conservatively keep records for analysis and exit with code `2`.
- Usage and input errors exit with code `1`.
- Run `npx jevlogs --help` for the complete command reference.

</details>

## Add it to your application

```sh
npm install jevlogs
```

```ts
import { createJevLogs } from 'jevlogs';

const jev = createJevLogs();
const decision = await jev.triage({
  body: 'Database connection pool at 94% capacity',
  severityText: 'WARN',
});

console.log(decision);
// value · priority · route · actionableProbability · reason
```

### Page from a probability

Analysis routing and paging are different decisions. Paging on `ERROR`, or on a discrete label such as `urgency: "page"`, either misses quiet incidents or wakes people up for expected errors. Ask one boolean question and keep the threshold in your code:

```ts
import { createJevPager } from 'jevlogs';

const pager = createJevPager({ pageAbove: 0.5 });
const decision = await pager.decide({
  service: 'orders-db',
  severityText: 'INFO',
  body: 'Replica lag 47m on primary still accepting writes',
});

if (decision.page) console.log(`page p=${decision.probability}`);
```

`decision.page` is `probability >= pageAbove`. ERROR lines are still sent to the model. FATAL, CRITICAL, and `protected: true` page immediately. A timeout holds (`page: false`) unless you set `pageOnUnavailable: true`. `suppressForMs` holds later copies of a template that already paged, so a crash loop pages once per window. The same policy is available as `npx jevlogs --page` and `npx jevlogs --live --page --file app.log`. `--page-above` accepts 0.05–0.95. The OTLP receiver continues to emit analysis routes.

### Score a labeled file before you filter

```sh
npx jevlogs --live --file incidents.jsonl --labels --json
```

Each record can set `important: true` or `label: "incident"` when a human needed it, and `important: false` or `label: "noise"` when it should be skipped. The summary prints recall and precision. A missed important record exits 2. `scoreDecisions()` is the same calculation in code. `maxModelCalls` caps how many of those lines can reach the model; past the cap, analysis routing keeps the record and the pager holds.

Requires **Node.js 22+** and a server-side `AI_GATEWAY_API_KEY` for live evaluation. The standalone API and CLI do not require OpenTelemetry at runtime. TypeScript projects checking dependency declarations may also need the OTel peer because the package exports its exporter types. Importing the library does not run the CLI.

### Already using OpenTelemetry?

```sh
npm install jevlogs @opentelemetry/sdk-logs@0.222.0
```

Wrap the exporter you already use:

```ts
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';

const provider = new LoggerProvider({
  processors: [
    new BatchLogRecordProcessor({
      exporter: new JevLogExporter({
        exporter: new ConsoleLogRecordExporter(), // or your OTLP exporter
        mode: 'annotate', // keeps every log
      }),
      maxExportBatchSize: 16,
      exportTimeoutMillis: 15_000,
    }),
  ],
});

provider.getLogger('app').emit({
  body: 'GET /health returned 200',
  severityNumber: 9,
});

// Flush during application shutdown, not after each log.
await provider.shutdown();
```

**Annotate first. Route when you are ready.** Keep your original archive processor, then add a separate analysis-queue exporter with `mode: 'analysis-only'`. Annotation alone does not reduce LLM billing; the downstream analysis pipeline must act on the routing decision.

[Read the integration guide →](https://github.com/reachjalil/jevlogs/blob/main/docs/guide.md) · [Open the runnable example →](https://github.com/reachjalil/jevlogs/blob/main/examples/telemetry.ts)

## What gets analyzed?

```text
                           ┌─ Existing archive → all logs
OpenTelemetry logs ────────┤
                           └─ Jev Logs → value + priority + probability
                                           │
                               ┌───────────┴────────────┐
                               ▼                        ▼
                         Deeper analysis         Retain in archive
                         Useful / uncertain      Confidently low-value
```

A log may skip the analysis branch only when **all three** conditions hold:

- Priority is `low`.
- Diagnostic value is **25 or below**.
- Actionable probability is **below 0.1**, the default threshold.

ERROR/FATAL records and records marked `jev.protected: true` always remain eligible for analysis. So do invalid outputs, timeouts, and provider failures. Nothing in this SDK deletes your archive.

<details>
<summary><strong>Decision fields and tuning</strong></summary>

| Field | Meaning |
| :--- | :--- |
| `value` | Five-level diagnostic rubric mapped to 0–100. Not money or confidence. |
| `priority` | `critical`, `high`, `normal`, or `low`. |
| `route` | `analyze` or `retain`. |
| `actionableProbability` | Jev's boolean estimate; `null` when no model decision is available. |
| `reason` | `model`, `protected`, `uncertain`, `unavailable`, or `rule`. |
| `cached` | `true` when served from the local decision cache instead of a new model call. |
| `rule` | Name of the matching configured rule when `reason` is `rule`. |

```ts
const jev = createJevLogs({
  retainBelow: 0.1, // 0–0.5; 0 disables analysis bypass
  timeoutMs: 2000,
  maxInputChars: 8000,
  rules: [{ name: 'health', match: '^GET /health', route: 'retain' }],
  cache: { maxEntries: 1000, ttlMs: 300_000 }, // or false
});
jev.stats(); // decisions, model calls, cache hits, rule hits, latency, input tokens
```

The exporter defaults to four concurrent requests, configurable from 1–32. Use OTel batches of 16; larger batches may exceed export deadlines. Overlapping exports bypass scoring and forward all records unchanged. Consumers should analyze records with missing decisions.

Fallback value `100` means "conservatively keep", not model certainty. Protected severity means `severityNumber >= 17` or severity text `ERROR`, `FATAL`, or `CRITICAL`. Reserve the `jev.*` attribute prefix for SDK annotations. Downstream exporter errors propagate through OTel callbacks; this package does not provide a durable queue.

</details>

## Cost estimate

**A $1,000 monthly analysis bill can model as $129.40 when 10% of logs still need deeper analysis.** That is 87.06% lower modeled LLM spend, including Jev triage. It is not a measured production result.

The mechanism is simple: pay Jev for a small structured decision, then pay your analysis model only for the selected records. Your existing archive still keeps every log. Annotation alone does not save analysis cost; connect an analysis branch and enable routing to reduce calls.

| Logs still sent to GPT-4.1 | Jev triage | Downstream analysis | Combined monthly cost | Reduction vs. $1,000 |
| :--- | ---: | ---: | ---: | ---: |
| 100% | $29.40 | $1,000.00 | $1,029.40 | −2.94% |
| 50% | $29.40 | $500.00 | $529.40 | 47.06% |
| 25% | $29.40 | $250.00 | $279.40 | 72.06% |
| 10% | $29.40 | $100.00 | **$129.40** | **87.06%** |

*Illustrative assumptions: 1M logs/month, 300 input and 50 output tokens per analyzed log; GPT-4.1 at $2/$8 per million input/output tokens; Jev at $0.042/M input with free output; 400 assumed question/context tokens per record. We conservatively charge Jev for every record, even though protected errors bypass evaluation. The routing percentages and token counts are assumptions, not measured Jev Logs accuracy or usage.*

A cheaper downstream model changes the economics: at GPT-4.1 mini's published $0.40/$1.60 rates, the same 10% scenario falls from **$200 to $49.40 (75.3%)**. These examples compare routing costs, not model quality. Filtering must be evaluated against incident recall on your own logs.

[Try the savings calculator](https://jevlogs.com/#savings)

```text
Baseline = logs × (input tokens × input rate + output tokens × output rate) / 1M
Triage   = logs × (input tokens + question tokens) × Jev input rate / 1M
With Jev = triage + baseline × fraction still analyzed
```

Use the same calculation in code with `estimateSavings()`. `breakEvenSkipFraction` is the share of logs that must skip downstream analysis for triage not to increase the bill. Above 1, triage costs more than analyzing every log. Excludes storage, ingestion, hosting, retries, discounts, caching, and additional analysis prompt overhead. Savings can be negative when too many records still need analysis. This reduces analysis spend, not archive storage charges.

<details>
<summary><strong>Published pricing and model context</strong></summary>

Sources checked September 16, 2026:

- [TypeSafe Jev launch pricing](https://typesafe.ai/blog/introducing-system-one-models-and-jev): $0.042/M input, free output. Structured choices, rubric scores, and probabilities make it suitable for routing without generating a paragraph.
- [Vercel GPT-4.1 pricing](https://vercel.com/ai-gateway/models/gpt-4.1): $2/M input, $8/M output.
- [Vercel GPT-4.1 mini pricing](https://vercel.com/ai-gateway/models/gpt-4.1-mini): $0.40/M input, $1.60/M output.
- [Vercel Jev integration](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway): experimental evaluation API in AI SDK 7.0.105 onward.

Check actual billing and token usage before budgeting. Provider speed and cost benchmarks are not Jev Logs benchmarks. Typed outputs can still be wrong.

</details>

## Data stays under your control

Only the log body and severity enter the model request; arbitrary OTel attributes are not sent. The SDK redacts common labeled secrets, Bearer tokens, and email addresses before transmission. Supply a domain-specific `redact(text)` hook for your own data policy. The default is not comprehensive PII detection.

Keep Gateway credentials on the server. Mark audit, security, and compliance records as protected. Evaluate incident recall on labeled logs before enabling analysis filtering, and periodically review a sample of bypassed events. Typed outputs can still contain incorrect decisions.

## Current scope and limits

This release handles **Node.js log records** and OTLP HTTP JSON or protobuf from any language through the local receiver. It does not include a hosted dashboard, log storage, a Collector plugin, trace/metric sampling, automatic logger instrumentation, a durable queue, or a downstream reasoning-model client. It does not explain root causes or automatically remediate incidents.

The file/stdin CLI modes process finite input after EOF, up to 1 MiB and 100 selected records. Plain text and simple JSONL are supported in those modes, including Pino's `msg` and levels 10–60. `--live` alone runs the local OTLP HTTP receiver documented above. `--stdin --follow` evaluates a live stream line by line. There is no gRPC receiver. Other numeric level schemes still need a `severityText` or an OpenTelemetry `severityNumber`.

The default redactor transforms the **model-bound copy**, not the original record sent to your exporter. Zero-data-retention is requested through Gateway, while your archive policies remain your responsibility. Identical templates share one model call and are cached in memory for five minutes by default. The cache key collapses identifiers; the model still receives the redacted original, so `47m` and `12s` do not share a decision. There are no automatic model retries.

`estimateSavings().retainedFraction` is the fraction **still sent to the downstream LLM**, including protected and uncertain records; it is not your archive retention rate. Start with annotation, measure incident recall and costs, then choose whether to enable filtering.

## Project status

**Public preview · MIT licensed · TypeScript first**

| Component | Status |
| :--- | :--- |
| npm library and `npx jevlogs` CLI | 0.5.0 in this repository |
| OpenTelemetry Logs integration | Annotation, analysis-branch routing, local OTLP receiver with forwarding |
| Astro website and guide | [Deployed on Cloudflare](https://jevlogs.workspaceagent.workers.dev) |
| Automated checks | [Live CI status](https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml) |
| Live Jev accuracy and production savings | Not yet independently validated for this project |
| `jevlogs.com` | Domain connection pending |

The AI SDK's `experimental_evaluate` API is pinned and experimental. Jev is a hosted model; this repository makes the **integration SDK** open source. This is an independent project, not an official GitHub, TypeSafe, Vercel, or OpenTelemetry product.

## Launch artwork

[Download the compact "Introducing Jev Logs" image](site/public/images/introducing-jevlogs.jpg). Both the launch card and README banner carry a `jevlogs.com` signature.

## Agent skill

Coding agents can learn this workflow from the [`jevlogs` skill](skills/jevlogs/SKILL.md) in this repository. It covers choosing an entry point, reading decisions, wiring the archive and analysis branches, handling real logs safely, measuring recall and cost before filtering, and troubleshooting, with runnable examples under [`skills/jevlogs/examples/`](skills/jevlogs/examples/).

Install it with the [skills CLI](https://skills.sh) into Claude Code, Cursor, Codex, or any supported agent:

```sh
npx skills add reachjalil/jevlogs --skill jevlogs
```

Then ask your agent things like "use Jev to prioritize these logs", "add Jev Logs to my OpenTelemetry pipeline", or "estimate what routing would save us". Run `npx skills add reachjalil/jevlogs --list` to see it before installing. Copying the `skills/jevlogs` folder into your agent's skills directory works too.

## Build with us

Small improvements welcome: integration examples, clearer docs, reproducible bugs, and evaluations on synthetic or sanitized logs. Please don't attach credentials or sensitive production logs to issues.

```sh
git clone https://github.com/reachjalil/jevlogs.git
cd jevlogs
pnpm install --frozen-lockfile
pnpm test
pnpm check:examples
pnpm site:build
```

For the website, run `pnpm --filter jevlogs-site dev`. To inspect the publishable library, run `pnpm pack`.

[Report a bug](https://github.com/reachjalil/jevlogs/issues) · [Release guide](https://github.com/reachjalil/jevlogs/blob/main/docs/release.md) · [Deployment guide](https://github.com/reachjalil/jevlogs/blob/main/docs/deployment.md) · [Design provenance](https://github.com/reachjalil/jevlogs/blob/main/docs/provenance.md)

---

<p align="center">
  <strong>Keep every log. Spend analysis on the records that need it.</strong><br />
  <sub>MIT licensed. <a href="https://github.com/reachjalil/jevlogs/blob/main/LICENSE">License</a></sub>
</p>
