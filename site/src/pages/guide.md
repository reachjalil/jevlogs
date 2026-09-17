---
layout: ../layouts/Guide.astro
---
# What you can do with Jev Logs

Jev Logs is a small decision layer before expensive LLM log analysis. Use it from a terminal, in a TypeScript job, or inside your existing Node.js OpenTelemetry Logs pipeline. It assigns diagnostic value, urgency, and an analysis recommendation. Your existing system remains responsible for storing logs, delivering events, and running deeper analysis.

**Current release: 0.1.1, public preview.** The SDK and CLI are on npm. The default demo is offline; live evaluation needs `AI_GATEWAY_API_KEY` and Jev access through Vercel AI Gateway. Production accuracy and savings have not been independently validated for this project.

## Choose your starting point

| You want to… | Start here | What you get |
| --- | --- | --- |
| Understand the workflow in seconds | `npx jevlogs` | Four fixed sample decisions, without a key or inference |
| Try the actual model | `npx jevlogs --live` | Jev evaluates the included sample logs; errors bypass the model |
| Inspect a log file | `--live --file app.log` | A bounded, one-time triage of text or JSONL |
| Feed decisions into a script | `--live --stdin --json` | One decision per input record on stdout |
| Add triage to an existing queue | `createJevLogs().triage()` | A typed decision your application can act on |
| See scores in your observability backend | `JevLogExporter`, `annotate` mode | Every record exported with `jev.*` annotations |
| Reduce calls to your analysis model | A separate `analysis-only` branch | Confidently low-value records skip that branch |
| Estimate whether triage pays off | `estimateSavings()` or the website calculator | An estimate including Jev overhead and downstream LLM costs |

## 1. Try the CLI

```sh
npx jevlogs
npx jevlogs --help
```

The default command uses fixed answers for four sample records. It does not call Jev. It demonstrates the SDK's routing policy and output format.

For actual inference, set your Gateway key through your shell's environment or secret manager, then run:

```sh
npx jevlogs --live
npx jevlogs --live --file ./app.log --limit 20
cat ./app.jsonl | npx jevlogs --live --stdin --json > decisions.jsonl
```

The key is read from `AI_GATEWAY_API_KEY`; there is no API-key command-line flag. Live mode sends redacted log bodies and severity to Vercel AI Gateway / TypeSafe and incurs provider charges. Your input file is never modified.

### Accepted input

Plain text: one non-empty line per record. Recognized severity words include ERROR, FATAL, CRITICAL, WARN, INFO, DEBUG, and TRACE.

```text
INFO GET /health returned 200
WARN Database connection pool approaching capacity
ERROR Payment capture failed
```

JSONL: one JSON value per line. Objects can use these fields:

```json
{"message":"GET /health returned 200","level":"INFO"}
{"body":"Connection pool at 94% for five minutes","severityText":"WARN"}
{"body":"Payment capture failed","severityNumber":17}
{"body":"Audit: administrator role changed","protected":true}
```

`body` takes precedence over `message`; `severityText` takes precedence over `level`. If neither body field exists, the whole object becomes the body. Arbitrary nested data inside that body may therefore be sent for evaluation. This is not an OTLP JSON decoder. Numeric `level` conventions from other loggers are not automatically translated to OTel severity; normalize them first.

### CLI reference

| Option | Behavior |
| --- | --- |
| No arguments / `--demo` | Offline sample demo; custom files are not accepted |
| `--live` | Enable actual Jev evaluation |
| `--file <path>` | Read a text or JSONL file; requires `--live` |
| `--stdin` | Read stdin until EOF; requires `--live` |
| `--limit <1–100>` | Maximum records processed; default 20 |
| `--json` | JSONL decisions on stdout, summaries on stderr |
| `--help`, `-h` | Print usage |
| `--version`, `-v` | Print package version |

Total input is limited to 1 MiB. Each selected input line is limited to 8,000 characters; the SDK also caps its serialized model state at 8,000 characters. More than the selected record limit triggers a stderr notice and only the first records are processed. The command is a finite batch tool, not a continuous `tail -f` agent: stdin is consumed until EOF before triage starts.

`--json` omits raw bodies. Example from the **offline demo**:

```json
{"line":1,"mode":"demo","value":0,"priority":"low","actionableProbability":0.01,"route":"retain","reason":"model"}
```

`line` is the one-based processed record index after blank lines are removed, not necessarily the physical file line number. `mode` distinguishes sample answers from live mode. In live mode, `reason: "protected"` means the local protection rule ran without calling the model.

| Exit code | Meaning |
| --- | --- |
| `0` | Command completed without unavailable evaluations; this can include protected records or an offline demo |
| `1` | Invalid arguments, missing key, unreadable input, or another command error |
| `2` | One or more evaluations unavailable; decisions still emitted and affected records kept eligible for analysis |

For automation, check both the exit code and each decision's `reason`. Redirecting stdout to a file does not hide the stderr summary.

## 2. Use the TypeScript API

Requires Node.js 22 or newer.

```sh
npm install jevlogs
```

```ts
import { createJevLogs } from 'jevlogs';

const jev = createJevLogs({
  retainBelow: 0.1,
  timeoutMs: 2000,
  maxInputChars: 8000,
});

const decision = await jev.triage({
  body: 'Database connection pool at 94% capacity for five minutes',
  severityText: 'WARN',
});

console.log(decision.value, decision.priority, decision.route);
// Your consumer decides whether to enqueue deeper analysis.
```

The standalone API has no OpenTelemetry runtime dependency. The package's exported declarations also reference OpenTelemetry types for its exporter; TypeScript consumers that check dependency declarations may need the OTel peer installed even when using only the standalone API.

### What a decision means

| Field | Meaning |
| --- | --- |
| `value` | Five-level diagnostic rubric scaled to 0–100; not dollars or confidence |
| `priority` | `critical`, `high`, `normal`, or `low` |
| `route` | `analyze` for deeper analysis; `retain` for keeping in your archive without that analysis |
| `actionableProbability` | Boolean probability that deeper investigation would be useful; `null` when there is no model answer |
| `reason` | `model`, `protected`, `uncertain`, or `unavailable` |

The rubric describes no useful signal, low diagnostic detail, moderate context, actionable failure evidence, and incident-defining evidence. Jev's score is mapped by multiplying it by 25. A fallback value of 100 is a conservative policy value, not an inferred judgment or certainty.

Only records satisfying **all three** conditions may receive `retain`:

1. Priority is `low`.
2. Value is at most 25.
3. Actionable probability is strictly less than `retainBelow` (default 0.1).

All other records receive `analyze`. A record recommended for analysis can still carry `reason: "uncertain"`; the reason is not a separate filter.

### Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `retainBelow` | `0.1` | Probability threshold, from 0 to 0.5; 0 disables bypass |
| `timeoutMs` | `2000` | Per-evaluation deadline in milliseconds |
| `maxInputChars` | `8000` | Maximum serialized state length before and after redaction |
| `redact` | `redactCommonSecrets` | Synchronous text transform before model transmission |
| `evaluator` | Jev through AI Gateway | Injectable evaluator for tests or custom integrations |

Timeouts, malformed answers, serialization errors, oversized state, redactor failures, and provider failures produce `reason: "unavailable"` with `route: "analyze"`. The SDK does not expose provider error details in the returned decision and performs no automatic retries. Changing the evaluator replaces the model integration; it does not change the conservative routing rules.

## 3. Annotate your OpenTelemetry logs

```sh
npm install jevlogs @opentelemetry/sdk-logs@0.222.0
```

```ts
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';

const provider = new LoggerProvider({
  processors: [new BatchLogRecordProcessor({
    exporter: new JevLogExporter({
      exporter: new ConsoleLogRecordExporter(), // replace with your exporter
      mode: 'annotate',
    }),
    maxExportBatchSize: 16,
    exportTimeoutMillis: 15_000,
  })],
});

provider.getLogger('checkout').emit({
  body: 'Payment capture failed',
  severityNumber: 17,
});

await provider.shutdown(); // at application shutdown, not per record
```

Replace the console exporter with your existing compatible `LogRecordExporter`, such as an OTLP exporter. Instrumentation must already emit OTel log records; Jev Logs does not automatically capture every `console.log` or instrument every logger.

The wrapper exports a new record preserving the original body, timestamps, severity, resource, scope, event name, and span context. It adds:

| Attribute | Value |
| --- | --- |
| `jev.value` | Diagnostic score or conservative fallback value |
| `jev.priority` | Priority string |
| `jev.route` | `analyze` or `retain` |
| `jev.reason` | Decision reason |
| `jev.actionable_probability` | Probability when a model answer exists; otherwise omitted on ordinary input |

Reserve `jev.*` for this integration. Default mode is `annotate`: every record is exported, so annotation alone does not reduce downstream model calls or storage charges.

## 4. Add a separate analysis branch

Keep your archive exporter on its own processor. Add Jev only to the branch that feeds your expensive LLM analysis queue:

```ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';

export function createPipeline(
  archiveExporter: LogRecordExporter,
  analysisQueueExporter: LogRecordExporter,
) {
  return new LoggerProvider({
    processors: [
      new BatchLogRecordProcessor({ exporter: archiveExporter }),
      new BatchLogRecordProcessor({
        exporter: new JevLogExporter({
          exporter: analysisQueueExporter,
          mode: 'analysis-only',
          concurrency: 4,
          retainBelow: 0.1,
        }),
        maxExportBatchSize: 16,
        exportTimeoutMillis: 15_000,
      }),
    ],
  });
}
```

The two exporter arguments are your application's destinations, not built-in Jev Logs services. Use independent exporter instances. This package supplies neither a persistent queue nor a downstream reasoning-model client. All records are offered to the archive branch; actual delivery still depends on your exporter and backend.

Concurrency defaults to 4 and accepts integers 1–32. Concurrent calls to the wrapper while it is classifying bypass scoring and forward those records unchanged. Your analysis consumer should treat missing decisions as eligible for analysis. No records are deleted from the archive by this integration.

## 5. Protect records and redact context

The local policy automatically protects OTel severity numbers 17 and above, and severity text ERROR, FATAL, or CRITICAL. It does not use model inference for those records. Mark additional records explicitly:

```ts
// Standalone API or JSONL CLI input:
await jev.triage({ body: 'Audit event', protected: true });

// OpenTelemetry emission:
provider.getLogger('audit').emit({
  body: 'Administrator role changed',
  attributes: { 'jev.protected': true },
});
```

For domain-specific redaction, compose your rule with the default redactor:

```ts
import { createJevLogs, redactCommonSecrets } from 'jevlogs';

const jev = createJevLogs({
  redact: text => redactCommonSecrets(text)
    .replace(/customer_[A-Za-z0-9]+/g, '[CUSTOMER_ID]'),
});
```

The default removes common labeled secrets, Bearer tokens, and email addresses. It is not complete PII detection. Only body and severity enter the standard model request; arbitrary OTel attributes are not included. Sensitive data embedded in a body still requires redaction. This hook changes the model-bound text, **not** the original log forwarded to your exporter. Apply separate redaction to your archive if necessary.

Gateway requests ask for zero data retention. Check the applicable provider account policies. Keep credentials server-side. Jev's structured outputs can still be wrong, and logs can contain adversarial instructions; protection rules are not a complete security classifier.

## 6. Estimate costs before routing

```ts
import { estimateSavings } from 'jevlogs';

const estimate = estimateSavings({
  logs: 1_000_000,
  tokensPerLog: 300,
  outputTokensPerLog: 50,
  llmInputPerMillion: 2,
  llmOutputPerMillion: 12,
  retainedFraction: 0.1, // fraction STILL sent for deeper LLM analysis
  jevInputPerMillion: 0.042,
  questionTokensPerLog: 400,
});
console.log(estimate);
// baseline: 1200, triage: 29.4, withJev: 149.4,
// savings: 1050.6, percent: approximately 87.55
```

Despite the parameter name, `retainedFraction` means the fraction retained **for downstream LLM analysis**, not the fraction archived. Include uncertainty, protected records, and failures in that fraction. The estimator conservatively budgets Jev triage for all input logs even though protected records bypass it in the SDK.

Question overhead defaults to an estimated 400 tokens per log, not measured usage. The estimate assumes equal average log sizes and excludes storage, ingestion, hosting, retries, prompt caching, and discounts. At 100% analyzed, Jev adds cost. Compare actual bills and incident recall before claiming savings.

Pricing references, checked September 16, 2026: [TypeSafe's launch announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) lists $0.042/M input and free output; [Vercel Gateway](https://vercel.com/ai-gateway/models/jev) displays $0.04/M. The [Vercel announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway) documents the experimental evaluate API used here. Provider benchmarks are not Jev Logs benchmarks.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Default command seems to return the same answers | It is the offline sample demo. Use `--live` for actual Jev inference. |
| Live CLI says key missing | Set `AI_GATEWAY_API_KEY` in the same shell/process; do not paste it into logs or issues. |
| `reason: unavailable`, exit 2 | Check model access, connectivity, serialized input size, and timeout. The CLI does not reveal the provider's underlying error. |
| Every ERROR gets value 100 | The local protection rule bypasses the model and conservatively selects analysis. |
| All logs still appear in the backend | Expected in annotation mode. Inspect `jev.*` attributes or use a separate analysis branch. |
| Some logs have no annotations | Overlapping export calls are forwarded unchanged. Treat missing decisions as analyze. |
| `tail -f` never returns results | The CLI waits for EOF. Use a finite file/snapshot, or integrate the SDK in a bounded worker. |
| Numeric logger levels do not protect errors | Normalize to OTel `severityNumber` or a string `severityText`; arbitrary logger numbering is not translated. |
| A TypeScript declaration cannot resolve OTel | Install `@opentelemetry/sdk-logs@0.222.0`, which provides the exporter's referenced types. |

## What this release does not include

No hosted dashboard, log database, automatic logger instrumentation, Collector plugin, span or metric processing, continuous CLI tailing, deduplication/cache, durable queue, root-cause explanation, or built-in downstream LLM analysis. CLI output is a triage result, not a measured cost report. The model is hosted by TypeSafe; the SDK is the open-source component.

## Suggested rollout

1. Run the offline demo and then a small synthetic live sample.
2. Annotate a bounded workload while retaining your existing archive and analysis behavior.
3. Compare routing with labeled incident logs. Measure false negatives, uncertainty, latency, and actual cost.
4. Enable filtering on a separate analysis branch only after choosing acceptable thresholds.
5. Periodically review a sample of bypassed events and revisit the rubric for your workload.

The current rubric is built into the default evaluator; domain-specific questions require supplying a custom `evaluator`. This guide describes available functionality, not a guarantee of incident detection or savings.
