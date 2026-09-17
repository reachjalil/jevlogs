---
layout: ../layouts/Guide.astro
---
# From logs to signal.

A small TypeScript integration for your existing OpenTelemetry pipeline. Start in annotation mode, inspect decisions, then route the expensive analysis branch.

**v0.1.1 preview.** Install the npm package or start with `npx jevlogs`. A Gateway key and Jev access are required for live evaluation.

## Try it in one command

```sh
npx jevlogs
```

The default is a clearly labeled **offline sample demo**: no API key, no network, no real inference. To try real Jev, set `AI_GATEWAY_API_KEY` in your environment and run:

```sh
npx jevlogs --live
npx jevlogs --live --file ./app.log --limit 20
cat app.jsonl | npx jevlogs --live --stdin --json
```

Live mode sends redacted log bodies to Vercel AI Gateway / TypeSafe and incurs provider charges. Files remain unchanged. `--json` emits decisions as JSONL without raw bodies; headers and summaries go to stderr. Supports plain text or JSONL (`body`/`message`, `severityNumber`, `severityText`/`level`, `protected`). Default 20 records, maximum 100; 1 MiB input cap. Provider failures keep records eligible for analysis and exit with code 2. Usage/input failures exit 1. `--help` lists all options.

## Install the library

```sh
pnpm add jevlogs @opentelemetry/sdk-logs@0.222.0
# or: npm install jevlogs @opentelemetry/sdk-logs@0.222.0
```

Node.js 22+. The OpenTelemetry peer is optional for standalone `createJevLogs()` and CLI usage; install it when using the OTel integration. Library imports have no CLI side effects.

For contributors: clone this repo, run `pnpm install --frozen-lockfile`, then `pnpm test`. Build an installable archive with `pnpm pack`.

Set `AI_GATEWAY_API_KEY` in your server environment. Obtain access through [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev). Never put the key in frontend code. Logs selected for evaluation leave your process for the Gateway and TypeSafe; install a domain-specific redactor first. Default redaction covers common labeled secrets, Bearer tokens, and email addresses, not every kind of sensitive data. Only body and severity are sent; arbitrary OTel attributes are not sent. Protected/error records bypass the model.

```ts
import { LoggerProvider, BatchLogRecordProcessor,
  ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';

const provider = new LoggerProvider({
  processors: [new BatchLogRecordProcessor({ exporter: new JevLogExporter({
    exporter: new ConsoleLogRecordExporter(), // or your OTLP exporter
    mode: 'annotate', // default: preserve all records
  }), maxExportBatchSize: 16, exportTimeoutMillis: 15000 })],
});
provider.getLogger('app').emit({
  body: 'GET /health returned 200', severityNumber: 9,
});
await provider.shutdown(); // flush at application shutdown, not per log
```

See [examples/telemetry.ts](https://github.com/reachjalil/jevlogs/blob/main/examples/telemetry.ts) and the [guide](https://github.com/reachjalil/jevlogs/blob/main/docs/guide.md).

## Route expensive analysis separately

Keep your original archive processor. Add a second processor wrapping an exporter for your LLM analysis queue with `mode: 'analysis-only'`. Only low-priority logs with value ≤25 and actionable probability <0.1 skip that branch. No raw archive records are deleted. In annotation mode, your downstream LLM must honor `jev.route` to save money; annotation alone doesn't reduce billing.

A record with severityNumber ≥17 (ERROR/FATAL), severityText ERROR/FATAL/CRITICAL, or attribute `jev.protected: true` is never filtered. Mark audit/security/compliance records explicitly. These rules aren't semantic guarantees; evaluate false negatives on labeled logs before routing production traffic. Sample bypassed logs for periodic review in your consumer.

## API

```ts
import { createJevLogs, estimateSavings } from 'jevlogs';
const jev = createJevLogs({ retainBelow: 0.1, timeoutMs: 2000 });
const decision = await jev.triage({ body: 'Cache warmed', severityNumber: 9 });
// { value, priority, route, actionableProbability, reason }
```

`value` is a five-level diagnostic rubric mapped to 0–100, not money or confidence. `actionableProbability` is the model's boolean estimate, not Choice/Score confidence. Fallback value 100 means conservatively keep, not model confidence. `reason` distinguishes `model`, `protected`, `uncertain`, `unavailable`. Timeouts and oversized inputs fail open. No unbounded cache or automatic retries. Input cap: 8,000 serialized characters. Concurrency: 4, configurable 1–32. Use OTel batch size 16; huge batches can exceed exporter deadlines. Overlapping export calls bypass scoring and forward all records unchanged. Downstream exporter delivery errors propagate through OTel callbacks; no durable queue is provided.

The wrapper preserves resource, scope, timestamps, body, trace context and existing attributes without mutating the original record. Model-derived attributes use `jev.*`; reserve that prefix. Raw records forwarded during overlap are deliberately unannotated: consumers should analyze missing decisions.

## Honest cost model

`estimateSavings` and the website calculator include Jev input + question overhead and selected LLM input/output. Example assumptions: 1M logs, 300 input tokens/log, 50 output tokens/log, hypothetical LLM prices $2/$12 per million input/output, 10% still analyzed, Jev $0.042/M plus 400 question tokens/log. Baseline $1,200; with triage $149.40; estimated reduction 87.55%. These are assumptions, not observed savings. Storage/ingestion/hosting, caching, retries, and varying log sizes aren't modeled. At 100% analyzed, Jev adds cost.

[TypeSafe launch](https://typesafe.ai/blog/introducing-system-one-models-and-jev) lists $0.042/M input and free output. [Gateway](https://vercel.com/ai-gateway/models/jev) displays $0.04/M. Check actual billing. [Vercel's announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway) confirms AI SDK ≥7.0.105 and the experimental API. Sources checked September 16, 2026. Provider speed/cost benchmarks are not Jev Logs results.


## Data and controls


The SDK sends serialized body and severity only. The default common-secret redactor is a convenience, not a complete PII policy. Supply `redact(text)` for domain-specific needs; it runs before transmission. Zero-data-retention is requested through Gateway. Provider account policies and access still apply. Never put Gateway keys in a browser.

Set `jev.protected: true` on audit, security, and other records that cannot skip analysis. ERROR/FATAL severity is protected automatically. Empty/invalid model outputs, errors, timeouts and oversized inputs stay on the analysis path. Jev's type safety doesn't guarantee correct classifications or resist every adversarial log. Validate real incident recall before enabling filtering.

## Standalone API

`createJevLogs(options).triage({ body, severityNumber?, severityText?, protected? })` returns a Promise of `{ value, priority, route, actionableProbability, reason }`. Use it in your existing job or queue without adopting the OTel wrapper. A custom `evaluator` permits local tests or another implementation of the same typed contract.

## Scope

This release integrates with Node.js OpenTelemetry Logs SDK. It is not an OTel Collector plugin, span sampler, log database, or root-cause explanation engine. It does not run the downstream LLM itself. Instrumentation and durable delivery remain your existing pipeline's responsibility.

## Tuning

`retainBelow` defaults to 0.1 and accepts 0–0.5. Retaining without deeper analysis additionally requires priority `low` and value ≤25. A threshold of 0 disables bypass. Begin with labeled incidents and routine logs, compare recall and routing rate, and review a sample of bypassed events. Calculate savings from actual billed usage and measured downstream volume.
