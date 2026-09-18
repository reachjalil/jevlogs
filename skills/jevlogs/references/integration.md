# Integrating jevlogs with OpenTelemetry and the local receiver

## Two branches, one provider

```text
                        ┌─ BatchLogRecordProcessor(archiveExporter)            → every record, unchanged
LoggerProvider ─────────┤
                        └─ BatchLogRecordProcessor(JevLogExporter{             → analyze records only
                               exporter: analysisQueueExporter,
                               mode: 'analysis-only' })
```

Each `BatchLogRecordProcessor` receives every emitted record independently, so the archive branch is unaffected by anything Jev decides. Give each branch its own exporter instance. The runnable version is `../examples/otel-pipeline.ts`.

Recommended processor settings for the analysis branch, from the README and tests:

```ts
new BatchLogRecordProcessor({
  exporter: new JevLogExporter({ exporter: analysisQueueExporter, mode: 'analysis-only', concurrency: 4 }),
  maxExportBatchSize: 16,     // 16 records × 2 s timeout / 4 in flight ≈ 8 s worst case
  exportTimeoutMillis: 15_000,
})
```

Flush once at shutdown with `await provider.shutdown()`, not per record.

## Rollout order

1. Wrap the archive exporter in `annotate` mode on a bounded workload. Query `jev.*` attributes in the backend. Nothing is filtered yet and nothing is saved yet.
2. Compare decisions with labeled incidents (see `evaluation.md`).
3. Move Jev to a separate `analysis-only` branch and leave the archive exporter bare.
4. Make the analysis consumer honor `jev.route` and treat missing attributes as `analyze`.
5. Periodically sample `retain` records from the archive to check for misses.

## Consuming decisions downstream

The package stops at the exporter. The consumer of the analysis queue (a worker, a Lambda, a cron job) is user code. Its contract:

- `attributes['jev.route'] === 'analyze'` or attributes absent → send to the reasoning model.
- `attributes['jev.route'] === 'retain'` → skip (already excluded by `analysis-only`, but check anyway for annotate-mode queues).
- Use `jev.priority` for ordering the queue: `critical` first.
- Do not use `jev.value` from records whose `jev.reason` is `protected` or `unavailable`; it is the constant 100.
- Log the count of records by `jev.reason` so `unavailable` spikes are visible.

With the standalone API the same logic reads the `Decision` object:

```ts
const decision = await jev.triage({ body, severityText });
if (decision.route === 'analyze') await enqueueForAnalysis({ body, decision });
```

The reasoning model call itself (OpenAI, Anthropic, whatever the user runs) is written by the user with their own SDK. jevlogs does not wrap it.

## Protecting records

| Where | How |
| --- | --- |
| OTel emit | `attributes: { 'jev.protected': true }` |
| standalone `triage` | `{ body, protected: true }` |
| CLI JSONL | `{"body":"...","protected":true}` |
| Any | `severityNumber >= 17` or `severityText` ERROR/FATAL/CRITICAL |

Protected records never reach Jev and are always routed `analyze`. Use it for audit, security, and compliance events, and for anything a regulator would ask about.

## Local OTLP receiver

For applications that are not Node.js, or for trying Jev without touching application code:

```bash
# project root: jevlogs.config.json with {"envFile": ".env", "port": 4318}
npx jevlogs --live
```

Protocol, from `src/server.ts`:

| Aspect | Value |
| --- | --- |
| Endpoint | `POST http://127.0.0.1:4318/v1/logs`, plus `GET /health` (checks the process, not model access) |
| Encoding | `Content-Type: application/json` or `application/x-protobuf`. gzip optional. gRPC (`application/grpc` or the collector LogsService path) returns 501 |
| Limits | 1 MiB body (413), 100 log records per request (400), one request at a time (503 + `Retry-After: 1`) |
| Timeouts | request 15 s, headers 10 s |
| Concurrency | 4 evaluations in flight |
| Bind | loopback only; put an authenticated collector in front for remote traffic |
| Response | `{}` on success; `{ partialSuccess: { rejectedLogRecords, errorMessage } }` when `onLog` threw |

Client side, any OTel SDK that can POST OTLP HTTP:

```dotenv
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:4318/v1/logs
```

Java, Go, Python, and Collector HTTP exporters default to protobuf on that path. JSON still works with `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json`. In JavaScript that is `@opentelemetry/exporter-logs-otlp-http` (`OTLPLogExporter`) with `maxExportBatchSize: 16`. The sending application does not need the Gateway key; only the receiver process does.

Embedded in Node.js:

```ts
import { startJevLogsServer, loadJevConfig } from 'jevlogs/server';
const server = await startJevLogsServer({
  ...await loadJevConfig(),
  async onLog({ logRecord, decision }) { /* persist + route here */ },
});
// later: await server.close();
```

`onLog` receives the **original** OTLP record (body unredacted, all attributes, trace IDs) plus the decision, for every record including `retain`. HTTP 200 means the callback finished, not that anything was stored durably. Compliant OTLP clients do not retry records reported in `partialSuccess`, and retried requests are not deduplicated, so persist inside the callback if delivery matters.

## What is not included

No Collector processor, no trace or metric sampling, no automatic instrumentation of `console.log` or existing loggers, no durable queue, no dedup, no `tail -f`, no hosted service. If the user needs one of these, say so and build it in their stack; do not imply jevlogs provides it.
