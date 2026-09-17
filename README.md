# Jev Logs

**Keep your logs. Spend on the signal.**

An MIT-licensed TypeScript SDK that uses [TypeSafe's Jev](https://typesafe.ai/) through Vercel AI SDK to prioritize OpenTelemetry logs before expensive LLM analysis.

- Diagnostic value (0–100), priority, actionable probability, and routing attributes.
- Existing OpenTelemetry exporters work unchanged behind the wrapper.
- Annotation mode preserves all logs; optional filtering belongs on a separate analysis branch.
- Errors, explicitly protected records, uncertain decisions, invalid outputs, and API failures remain eligible for analysis.
- Bounded concurrent requests, input limits, timeouts, no provider retries, and a redaction hook.

**v0.1 preview.** The SDK builds and is locally tested. Live Jev access and accuracy on production logs have not been certified. The `experimental_evaluate` dependency is experimental and pinned. Jev is a hosted model; only this SDK is open source. No affiliation with TypeSafe, Vercel, or OpenTelemetry.

## Start from source

Node.js 22+, pnpm 10.15.1. The npm name is proposed; no npm release has been published.

```sh
git clone https://github.com/reachjalil/jevlogs.git
cd jevlogs
pnpm install --frozen-lockfile
pnpm test
pnpm pack
# In your application: pnpm add /path/to/jevlogs/jevlogs-0.1.0.tgz
```

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

## Astro website

```sh
pnpm --filter jevlogs-site dev
pnpm --filter jevlogs-site build
```

Astro emits `site/dist` for any static host. No backend or secret is needed for the website. The interactive pipeline uses labeled illustrative data, not a live model. The theme adapts the owner's CloudBash design; see [provenance](docs/provenance.md).

## Release

See [release checklist and announcement](docs/release.md). Run `pnpm test`, the Astro build, and an authenticated synthetic live smoke before claiming live validation. Publish the npm tarball only after confirming package name ownership. MIT license applies to Jev Logs, not the model or upstream private CloudBash repository.

Website deployed on [Cloudflare](https://jevlogs.workspaceagent.workers.dev). Custom domain setup for `jevlogs.com` is pending; see [deployment guide](docs/deployment.md).
