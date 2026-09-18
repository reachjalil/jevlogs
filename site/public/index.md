# Jev Logs

> Keep your logs. Spend on the signal.

Open-source TypeScript log triage for [OpenTelemetry](https://opentelemetry.io/) logs. Jev Logs sits between your existing pipeline and an expensive reasoning model. It scores diagnostic value, assigns urgency, and recommends whether a record deserves deeper LLM analysis.

- **Package:** [`jevlogs`](https://www.npmjs.com/package/jevlogs) v0.3.0, MIT license, Node.js 22+
- **Site:** https://jevlogs.com
- **Guide (markdown):** https://jevlogs.com/guide.md
- **Source:** https://github.com/reachjalil/jevlogs
- **Agent index:** https://jevlogs.com/llms.txt

## What it does

Jev Logs does **not** store logs, delete archives, or replace your exporter. Every record is kept. A log may skip a separate LLM-analysis branch only when all three are true:

1. Priority is `low`
2. Diagnostic value is 25 or below (0–100 rubric)
3. Actionable probability is below `retainBelow` (default `0.1`)

ERROR/FATAL/CRITICAL records and `jev.protected` records always stay eligible for analysis. Timeouts, malformed answers, and provider failures also stay eligible (`reason: unavailable`). Fallback value `100` means "conservatively keep", not model certainty.

## Try it

```sh
npx jevlogs                 # offline demo, no API key
npx jevlogs --live          # local OTLP HTTP/JSON receiver on 127.0.0.1:4318
npx jevlogs --live --sample # live Jev on bundled sample logs
npm install jevlogs
```

Live evaluation needs `AI_GATEWAY_API_KEY` for [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/authentication-and-byok). The website never receives that key. Provider usage is billed to your Gateway account.

## Typical integration

```ts
import { createJevLogs } from 'jevlogs';

const jev = createJevLogs();
const decision = await jev.triage({
  body: 'Database connection pool at 94% capacity',
  severityText: 'WARN',
});
// decision.value, .priority, .route, .actionableProbability, .reason
```

OpenTelemetry: wrap your existing `LogRecordExporter` with `JevLogExporter`. Default `annotate` mode exports every record with `jev.*` attributes. Use a separate processor with `mode: 'analysis-only'` if you want confidently low-value records to skip the LLM branch. Annotation alone does not reduce analysis spend.

Local receiver: add `jevlogs.config.json` at the project root and run `npx jevlogs@latest --live`. Applications send **OTLP HTTP/JSON** to `http://127.0.0.1:4318/v1/logs`, not gRPC or protobuf. Set `forwardUrl` to pass annotated records on to your collector, `rules` to retain known noise without a model call, and read `GET /stats` for counters. Identical redacted inputs and identifier-only variants are cached in memory. Loopback only; this is a development receiver, not a hosted collector.

## Limits (preview)

No hosted dashboard, log database, Collector plugin, span/metric processing, automatic logger instrumentation, durable queue, root-cause explanations, or built-in downstream reasoning client. File/stdin CLI modes are finite batches after EOF (1 MiB, up to 100 records) unless `--stdin --follow` streams lines as they arrive. Default redaction is not complete PII detection. Production accuracy and savings are not independently validated for this project.

Independent project. Not affiliated with TypeSafe, Vercel, GitHub, or OpenTelemetry.

Read the full guide: https://jevlogs.com/guide.md
