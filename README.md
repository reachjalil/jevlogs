<p align="center">
  <img src="https://raw.githubusercontent.com/reachjalil/jevlogs/main/docs/assets/readme-banner.png" alt="Jev Logs — Keep your logs. Spend on the signal. A relaxed robot in blue headphones sorts log records into background and signal." width="100%" />
</p>

<h1 align="center">Jev Logs</h1>

<p align="center">
  <strong>A little intelligence between your logs and your LLM bill.</strong><br />
  Score, prioritize, and route OpenTelemetry logs with Jev. Keep the signal. Keep your stack.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/jevlogs"><img src="https://img.shields.io/npm/v/jevlogs?style=flat-square&color=2448ff" alt="npm version" /></a>
  <a href="https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml"><img src="https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/reachjalil/jevlogs/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2448ff?style=flat-square" alt="MIT license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A522-11131b?style=flat-square" alt="Node.js 22 or later" /></a>
  <a href="#project-status"><img src="https://img.shields.io/badge/status-preview-8b5cf6?style=flat-square" alt="Status: preview" /></a>
</p>

<p align="center">
  <a href="https://jevlogs.workspaceagent.workers.dev"><strong>Website</strong></a> ·
  <a href="https://jevlogs.workspaceagent.workers.dev/guide/"><strong>Guide</strong></a> ·
  <a href="https://www.npmjs.com/package/jevlogs"><strong>npm</strong></a> ·
  <a href="https://github.com/reachjalil/jevlogs/issues"><strong>Feedback</strong></a>
</p>

---

## Meet your log filter’s smarter friend

Health checks. Cache hits. A payment failure hiding in the middle. Sending every event to a reasoning model adds cost before the investigation even starts.

**Jev Logs makes the first decision:** how useful is this log, how urgent is it, and does it deserve deeper analysis? It uses [TypeSafe’s Jev](https://typesafe.ai/) through the Vercel AI SDK, with a small TypeScript API and an OpenTelemetry exporter wrapper.

| A small layer | What you get |
| :--- | :--- |
| **Score the signal** | A 0–100 diagnostic-value score, priority, and actionable probability. |
| **Keep your pipeline** | Wrap your existing exporter; preserve resource, scope, timestamps, and trace context. |
| **Start with visibility** | Annotation mode keeps every record and attaches `jev.*` attributes. |
| **Spend selectively** | Route confidently low-value events away from a separate LLM-analysis branch. |
| **Keep the uncertain ones** | Errors, protected records, ambiguity, and provider failures remain eligible for analysis. |

## What you can build today

| Use case | How to use Jev Logs | What stays in your application |
| :--- | :--- | :--- |
| **Triage a batch of application logs** | Run the live CLI on a text file or JSONL snapshot. | Log collection, retention, and human investigation. |
| **Prioritize an incident-analysis queue** | Call `triage()` before enqueueing expensive reasoning work. | The queue, retries, and downstream analysis model. |
| **Explore signal quality in an OTel backend** | Wrap your exporter in annotation mode and inspect `jev.*` attributes. | Your exporter, backend queries, alerts, and dashboards. |
| **Filter only the LLM analysis branch** | Preserve an archive processor and add a separate `analysis-only` processor. | Archive delivery and analysis-queue delivery. |
| **Keep audit events eligible for analysis** | Set `protected: true` in standalone/CLI input or `jev.protected: true` in OTel attributes. | Your policy for deciding which records are protected. |
| **Plan an analysis budget** | Use `estimateSavings()` with measured volume and your model prices. | Actual token metering and billing verification. |

**[Read the complete capability and integration guide →](https://jevlogs.workspaceagent.workers.dev/guide/)**

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
npx jevlogs --live

# Evaluate a local log file
npx jevlogs --live --file ./app.log --limit 20

# Pipe JSONL in; get machine-readable decisions out
cat app.jsonl | npx jevlogs --live --stdin --json
```

Live mode sends redacted log bodies to Vercel AI Gateway / TypeSafe and incurs provider charges. Your files remain unchanged. Get access through [AI Gateway](https://vercel.com/ai-gateway/models/jev).

<details>
<summary><strong>CLI input, limits, and exit codes</strong></summary>

- Accepts plain text or JSONL with `body`/`message`, `severityNumber`, `severityText`/`level`, and `protected`.
- Processes 20 records by default, up to 100 with `--limit`; total input is capped at 1 MiB.
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

**Annotate first. Route when you’re ready.** Keep your original archive processor, then add a separate analysis-queue exporter with `mode: 'analysis-only'`. Annotation alone does not reduce LLM billing; the downstream analysis pipeline must act on the routing decision.

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
| `actionableProbability` | Jev’s boolean estimate; `null` when no model decision is available. |
| `reason` | `model`, `protected`, `uncertain`, or `unavailable`. |

```ts
const jev = createJevLogs({
  retainBelow: 0.1, // 0–0.5; 0 disables analysis bypass
  timeoutMs: 2000,
  maxInputChars: 8000,
});
```

The exporter defaults to four concurrent requests, configurable from 1–32. Use OTel batches of 16; larger batches may exceed export deadlines. Overlapping exports bypass scoring and forward all records unchanged. Consumers should analyze records with missing decisions.

Fallback value `100` means “conservatively keep,” not model certainty. Protected severity means `severityNumber >= 17` or severity text `ERROR`, `FATAL`, or `CRITICAL`. Reserve the `jev.*` attribute prefix for SDK annotations. Downstream exporter errors propagate through OTel callbacks; this package does not provide a durable queue.

</details>

## Smaller bill. Transparent math.

**A $1,000 monthly analysis bill could become $129.40 when only 10% of logs need deeper analysis.** That is **87.06% lower modeled LLM spend**, including Jev triage—not a measured production result.

The mechanism is simple: pay Jev for a small structured decision, then pay your analysis model only for the selected records. Your existing archive still keeps every log. Annotation alone does not save analysis cost; connect an analysis branch and enable routing to reduce calls.

| Logs still sent to GPT-4.1 | Jev triage | Downstream analysis | Combined monthly cost | Reduction vs. $1,000 |
| :--- | ---: | ---: | ---: | ---: |
| 100% | $29.40 | $1,000.00 | $1,029.40 | −2.94% |
| 50% | $29.40 | $500.00 | $529.40 | 47.06% |
| 25% | $29.40 | $250.00 | $279.40 | 72.06% |
| 10% | $29.40 | $100.00 | **$129.40** | **87.06%** |

*Illustrative assumptions: 1M logs/month, 300 input and 50 output tokens per analyzed log; GPT-4.1 at $2/$8 per million input/output tokens; Jev at $0.042/M input with free output; 400 assumed question/context tokens per record. We conservatively charge Jev for every record, even though protected errors bypass evaluation. The routing percentages and token counts are assumptions, not measured Jev Logs accuracy or usage.*

A cheaper downstream model changes the economics: at GPT-4.1 mini’s published $0.40/$1.60 rates, the same 10% scenario falls from **$200 to $49.40 (75.3%)**. These examples compare routing costs, not model quality. Filtering must be evaluated against incident recall on your own logs.

[Try the editable savings calculator →](https://jevlogs.workspaceagent.workers.dev/#savings)

```text
Baseline = logs × (input tokens × input rate + output tokens × output rate) / 1M
Triage   = logs × (input tokens + question tokens) × Jev input rate / 1M
With Jev = triage + baseline × fraction still analyzed
```

Use the same calculation in code with `estimateSavings()`. Excludes storage, ingestion, hosting, retries, discounts, caching, and additional analysis prompt overhead. Savings can be negative when too many records still need analysis. This reduces analysis spend, not archive storage charges.

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

Only the log body and severity enter the model request; arbitrary OTel attributes are not sent. The SDK redacts common labeled secrets, Bearer tokens, and email addresses before transmission. Supply a domain-specific `redact(text)` hook for your own data policy—the default is not comprehensive PII detection.

Keep Gateway credentials on the server. Mark audit, security, and compliance records as protected. Evaluate incident recall on labeled logs before enabling analysis filtering, and periodically review a sample of bypassed events. Typed outputs can still contain incorrect decisions.

## Current scope and limits

This release handles **Node.js log records**. It does not include a hosted dashboard, log storage, a Collector plugin, trace/metric sampling, automatic logger instrumentation, a durable queue, or a downstream reasoning-model client. It does not explain root causes or automatically remediate incidents.

The CLI processes finite input after EOF; it is not a streaming `tail -f` agent. It reads at most 1 MiB, evaluates up to 100 selected records, and emits routing recommendations. Plain text and simple JSONL are supported; OTLP JSON and arbitrary numeric logger levels require normalization. For a continuous application pipeline, use the SDK with your own bounded queue.

The default redactor transforms the **model-bound copy**, not the original record sent to your exporter. Zero-data-retention is requested through Gateway, while your archive policies remain your responsibility. No cache, deduplication, or automatic model retries are implemented.

`estimateSavings().retainedFraction` is the fraction **still sent to the downstream LLM**, including protected and uncertain records; it is not your archive retention rate. Start with annotation, measure incident recall and costs, then choose whether to enable filtering.

## Project status

**Public preview · MIT licensed · TypeScript first**

| Component | Status |
| :--- | :--- |
| npm library and `npx jevlogs` CLI | Available in `jevlogs@0.1.1` |
| OpenTelemetry Logs integration | Annotation + optional analysis-branch routing |
| Astro website and guide | [Deployed on Cloudflare](https://jevlogs.workspaceagent.workers.dev) |
| Automated checks | [Live CI status](https://github.com/reachjalil/jevlogs/actions/workflows/ci.yml) |
| Live Jev accuracy and production savings | Not yet independently validated for this project |
| `jevlogs.com` | Domain connection pending |

The AI SDK’s `experimental_evaluate` API is pinned and experimental. Jev is a hosted model; this repository makes the **integration SDK** open source. This is an independent project, not an official GitHub, TypeSafe, Vercel, or OpenTelemetry product.

## Build with us

Small improvements welcome: integration examples, clearer docs, reproducible bugs, and evaluations on synthetic or sanitized logs. Please don’t attach credentials or sensitive production logs to issues.

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
  <strong>Keep the logs. Save the reasoning for the interesting part.</strong><br />
  <sub>Made for developers who like useful signals and smaller bills. <a href="https://github.com/reachjalil/jevlogs/blob/main/LICENSE">MIT licensed.</a></sub>
</p>
