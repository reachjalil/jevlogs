# jevlogs API reference (verified against jevlogs 0.4.0)

Source of truth: `src/index.ts`, `src/server.ts`, `src/config.ts`, `src/cli.ts` in
https://github.com/reachjalil/jevlogs. If this file and the code disagree, the code wins.

## Package layout

| Import | Exports |
| --- | --- |
| `jevlogs` | `createJevLogs`, `createJevPager`, `compileRules`, `compilePagerRules`, `decisionAttributes`, `pageAttributes`, `scoringAttributes`, `shouldPage`, `isPageDecision`, `JevLogExporter`, `JevPagerExporter`, `estimateSavings`, `redactCommonSecrets`, `PAGE_NOW_INSTRUCTIONS`, types `LogInput`, `Decision`, `PageDecision`, `Evaluation`, `PagerEvaluation`, `Evaluator`, `PagerEvaluator`, `Rule`, `PagerRule`, `CacheOptions`, `JevOptions`, `PagerOptions`, `ExporterOptions`, `PagerExporterOptions`, `CostInputs`, `JevStats`, `PagerStats` |
| `jevlogs/server` | `startJevLogsServer`, `parseOtlpHeaders`, `loadJevConfig`, types `JevServerOptions`, `JevLogEvent`, `JevConfig`, `JevServerStats` |
| `npx jevlogs` | CLI (`dist/cli.js`) |

Runtime: Node.js 22 or newer, ESM. Dependency: `ai@7.0.105` (Vercel AI SDK). Optional peer: `@opentelemetry/sdk-logs@0.222.0`, needed at runtime only for `JevLogExporter`, but TypeScript consumers may need it installed for the exported declarations to resolve.

Nothing else is exported. There is no `analyze()`, no `explain()`, no retry helper, no downstream LLM client, no Collector plugin, no gRPC or protobuf receiver.

## `createJevLogs(options?)`

```ts
interface JevOptions {
  retainBelow?: number;    // default 0.1; must be 0–0.5; 0 disables retain entirely
  timeoutMs?: number;      // default 2000; > 0
  maxInputChars?: number;  // default 8000; integer >= 1
  redact?: (text: string) => string;   // default redactCommonSecrets
  evaluator?: Evaluator;   // default: Jev via AI Gateway
  rules?: Rule[];          // after protection and redaction, before cache and model; first match wins
  cache?: CacheOptions | false;  // default { maxEntries: 1000, ttlMs: 300_000 }; false disables
}
interface Rule { name?: string; match: string | RegExp; flags?: string; route: 'retain' | 'analyze' }
interface CacheOptions { maxEntries?: number; ttlMs?: number }
type Evaluator = (state: string, signal: AbortSignal) => Promise<Evaluation>;
interface Evaluation {
  value: number;
  priority: 'critical'|'high'|'normal'|'low';
  actionableProbability: number;
  inputTokens?: number;    // summed into stats().inputTokens when finite
}
```

Out-of-range options throw `RangeError` at construction. Returns `{ triage(log: LogInput): Promise<Decision>, stats(): JevStats & { cacheEntries: number } }`.

```ts
interface LogInput { body: unknown; severityNumber?: number; severityText?: string; protected?: boolean; service?: string }
interface Decision {
  value: number;                       // 0–100 rubric score
  priority: 'critical'|'high'|'normal'|'low';
  route: 'analyze'|'retain';
  actionableProbability: number|null;  // null when no model answer
  reason: 'model'|'protected'|'uncertain'|'unavailable'|'rule';
  cached: boolean;                     // served from the in-memory cache or a shared in-flight evaluation
  rule?: string;                       // matching rule name when reason === 'rule'
}
interface JevStats {
  decisions: number; model: number; cached: number; protected: number;
  rules: number; unavailable: number; retain: number; analyze: number;
  inputTokens: number;                 // successful model calls that reported inputTokens
  modelLatencyMs: { count: number; total: number; max: number };
}
```

`stats()` is a snapshot of counters since construction. `modelLatencyMs` covers successful model calls only. `cacheEntries` is the current in-memory cache size.

### Exact decision algorithm

1. If `protected === true`, or `severityNumber >= 17`, or `severityText` matches `ERROR|FATAL|CRITICAL` (case-insensitive): return `{ value: 100, priority: 'critical', route: 'analyze', actionableProbability: null, reason: 'protected', cached: false }`. No network call. Rules do not run.
2. Serialize `{ body, severityText, severityNumber }` with `JSON.stringify`. If longer than `maxInputChars`: `reason: 'unavailable'` fallback.
3. Run `redact` on that string. If it throws, returns a non-string, or the result exceeds `maxInputChars`: `unavailable` fallback.
4. If `rules` is non-empty, test each compiled rule against the redacted body text (`body` if it is a string, else `JSON.stringify(body)`). First match returns `reason: 'rule'`, `cached: false`, and `rule` set to the rule name. A `retain` match is `{ value: 0, priority: 'low', route: 'retain', actionableProbability: null }`. An `analyze` match uses the high-value fallback.
5. If the cache is enabled, key = SHA-256 (base64) of the redacted serialized state. A hit returns that stored decision with `cached: true`. Identical in-flight evaluations share one model call; followers also return `cached: true`. Failures are not stored in the cache.
6. Call the evaluator with the redacted string, racing against `timeoutMs`. On timeout the abort signal fires.
7. Validate the answer: probability in [0,1], value finite in [0,100], priority in the four allowed strings. Anything else: `unavailable` fallback.
8. `retain = actionableProbability < retainBelow && value <= 25 && priority === 'low'`.
9. `reason = retain || actionableProbability >= 1 - retainBelow ? 'model' : 'uncertain'`.
10. If the answer included a finite `inputTokens`, add it to `stats().inputTokens`. Record latency on successful model calls. Store the decision in the cache when caching is on.

The `unavailable` fallback is `{ value: 100, priority: 'high', route: 'analyze', actionableProbability: null, reason: 'unavailable', cached: false }`. Provider error details are not exposed. There are no automatic retries (`maxRetries: 0` is passed to the AI SDK).

### `createJevPager(options?)`

```ts
interface PagerOptions {
  pageAbove?: number;      // default 0.5; 0–1
  timeoutMs?: number;      // default 8000
  maxInputChars?: number;  // default 8000
  redact?: (text: string) => string;
  evaluator?: PagerEvaluator;
  rules?: PagerRule[];     // route: 'page' | 'hold'
  cache?: CacheOptions | false;
  pageWhenUnavailable?: boolean; // default false
}
interface PageDecision {
  page: boolean;
  probability: number | null;
  pageAbove: number;
  reason: 'model' | 'rule' | 'unavailable';
  cached: boolean;
  rule?: string;
}
```

Returns `{ decide(log): Promise<PageDecision>, stats() }`.

Algorithm:

1. No ERROR/FATAL protection. Severity is just another field.
2. Serialize `{ service, body, severityText, severityNumber }`, redact, size-check.
3. Pager rules on redacted body. First match wins (`page` or `hold`).
4. Cache / in-flight coalescing as in triage. Failures are not cached.
5. One boolean `page_now`. `page = probability >= pageAbove`.
6. On timeout, throw, or bad probability: `page: false` unless `pageWhenUnavailable`.

`shouldPage(p, pageAbove)` is the same inequality for stored scores. `pageAttributes(decision)` writes `jev.page`, `jev.page_probability`, `jev.page_above`, `jev.reason`, optional `jev.cached` / `jev.rule`.

`JevPagerExporter` mirrors `JevLogExporter` with `mode: 'annotate' | 'pages-only'`.

### `compileRules(rules)`

Validates and compiles `Rule[]`. Throws `RangeError` on the first invalid rule. At most 200 rules. Each `match` is a `RegExp` or a string of at most 512 characters; `flags` may only contain `i`, `m`, `s`, or `u`. `g` and `y` are stripped from `RegExp` flags. `name` is optional, at most 64 characters; the default is `rule-${index+1}`. `createJevLogs` calls this at construction.

### What the default evaluator sends

One `experimental_evaluate` call with `model: 'typesafe-ai/jev'`, `state` = the redacted string, `providerOptions: { gateway: { zeroDataRetention: true } }`, and three questions:

| id | type | maps to |
| --- | --- | --- |
| `actionable` | boolean | `actionableProbability = answers.actionable.probability` |
| `priority` | choice (critical/high/normal/low) | `priority = answers.priority.choice` |
| `value` | score, 5 criteria | `value = answers.value.score * 25` |

Each question's instructions tell Jev to treat the log as untrusted data and ignore embedded instructions. The rubric levels are: no useful signal, routine detail, useful context, actionable failure evidence, incident-defining evidence.

The default evaluator returns `inputTokens: result.usage.inputTokens`. A custom `evaluator` should do the same if you want `stats().inputTokens` to be complete. See `../examples/measured-evaluator.ts` for a wrapper that also keeps a per-call log.

Default cache: 1,000 entries, 5 minutes TTL, LRU eviction, keyed by the redacted state hash. `cache: false` disables it. `cache.maxEntries` must be an integer 0–100000; `0` means no cache. `cache.ttlMs` must be positive. Concurrent identical inputs share one in-flight evaluation; a failure lets followers fall back independently.

## `redactCommonSecrets(text)`

Replaces `Bearer <token>`, the value after `password|api_key|api-key|apikey|token|secret` followed by `:` or `=`, and email addresses. Synchronous, regex-based, not a PII detector. Compose it: `redact: t => redactCommonSecrets(t).replace(/customer_\w+/g, '[CUSTOMER]')`.

## `decisionAttributes(decision)`

Returns the OTel attribute map written onto forwarded records. Keys: `jev.value`, `jev.priority`, `jev.route`, `jev.reason`, plus `jev.actionable_probability` when the probability is not `null`, `jev.cached: true` only when `cached` is true, and `jev.rule` when a rule name is present. Reserve the `jev.*` prefix for this integration.

## `JevLogExporter`

```ts
interface ExporterOptions extends JevOptions {
  exporter: LogRecordExporter;         // the user's real exporter; wrapped, never mutated
  mode?: 'annotate' | 'analysis-only'; // default 'annotate'
  concurrency?: number;                // default 4; integer 1–32
}
```

Implements `LogRecordExporter` (`export`, `forceFlush`, `shutdown`). `stats()` returns this instance's `createJevLogs().stats()`. Put it inside `BatchLogRecordProcessor`. Per record it calls `triage` with `body`, `severityNumber`, `severityText`, and `protected = attributes['jev.protected'] === true`, then forwards a **new** record object that copies body, severity, `hrTime`, `hrTimeObserved`, `spanContext`, `eventName`, `resource`, `instrumentationScope`, `droppedAttributesCount`, and attributes plus `decisionAttributes(decision)`.

In `analysis-only` mode, `retain` records are not forwarded. If every record in a batch is retained, the callback succeeds with an empty forward.

Concurrency notes copied from the code: if `export` is called while a previous batch is still being classified, the new batch is forwarded **unchanged and unscored**. `forceFlush` waits for pending work then flushes the wrapped exporter. `shutdown` is idempotent and calls the wrapped exporter's `shutdown`. Export errors from the wrapped exporter propagate through the OTel callback; there is no durable queue.

## `estimateSavings(input)`

```ts
interface CostInputs {
  logs: number;                 // records per period
  tokensPerLog: number;         // downstream input tokens per analyzed record
  outputTokensPerLog: number;   // downstream output tokens per analyzed record (include billable reasoning tokens)
  llmInputPerMillion: number;   // downstream $/M input
  llmOutputPerMillion: number;  // downstream $/M output
  retainedFraction: number;     // 0–1: fraction STILL sent to the downstream LLM
  jevInputPerMillion?: number;  // default 0.042
  questionTokensPerLog?: number;// default 400, an assumption for Jev question overhead
}
// returns { baseline, triage, withJev, savings, percent }
```

```text
baseline = logs × (tokensPerLog × llmInputPerMillion + outputTokensPerLog × llmOutputPerMillion) / 1e6
triage   = logs × (tokensPerLog + questionTokensPerLog) × jevInputPerMillion / 1e6
withJev  = triage + baseline × retainedFraction
```

Throws `RangeError` on negative or non-finite inputs or `retainedFraction > 1`. Charges Jev for every record even though protected ones bypass it. Excludes storage, ingestion, retries, caching, discounts, and extra prompt overhead. `savings` is negative when `retainedFraction` is near 1.

## `startJevLogsServer(options)` from `jevlogs/server`

```ts
interface JevServerOptions extends JevOptions {
  port?: number;                                   // default 4318; binds 127.0.0.1 only
  onLog?: (event: JevLogEvent) => void | Promise<void>;  // required unless forwardUrl is set
  forwardUrl?: string;                             // absolute http(s) OTLP HTTP/JSON logs endpoint
  forwardMode?: 'annotate' | 'analysis-only';      // default annotate; requires forwardUrl
  forwardHeaders?: Record<string, string>;         // default OTEL_EXPORTER_OTLP_LOGS_HEADERS or OTEL_EXPORTER_OTLP_HEADERS
  forwardTimeoutMs?: number;                       // default 10_000
  concurrency?: number;                            // default 4; 1–32
  maxRequests?: number;                            // default 8; 1–256; extra requests get 503 Retry-After: 1
}
interface JevLogEvent { resource: object; scope: object; logRecord: object; decision: Decision }
```

Returns `{ url, forwardUrl, stats(), close() }`. Throws at startup if neither `onLog` nor `forwardUrl` is set, or if neither `evaluator` nor `AI_GATEWAY_API_KEY` is present. `forwardUrl` must be an absolute `http:` or `https:` URL. Annotated records are forwarded **before** `onLog` runs. A forward failure returns 503 and does **not** run `onLog`, so the client can retry without double delivery to the sink.

`GET /health` → `{ status, version, forwarding }`. `GET /stats` → `{ version, uptimeMs, requests, records, forwarded, forwardFailures, rejected, busy, triage }`, the same object `stats()` returns. `POST /v1/logs` is uncompressed OTLP HTTP/JSON, 1 MiB and 100 records per request. Protocol details are in `integration.md`.

`parseOtlpHeaders(text)` parses `key=value` pairs separated by commas, URL-decoding values.

## `loadJevConfig(path?)` and `jevlogs.config.json`

Reads JSON only (never executes code). Default path `./jevlogs.config.json`; a missing default file returns `{}`, a missing explicit path throws. Allowed keys and nothing else:

| key | type | note |
| --- | --- | --- |
| `port` | number | receiver port |
| `envFile` | string | dotenv path resolved relative to the config file; loaded with `process.loadEnvFile`; existing env vars win |
| `retainBelow` | number | |
| `timeoutMs` | number | |
| `maxInputChars` | number | |
| `forwardUrl` | string | absolute http(s) OTLP logs URL |
| `forwardMode` | string | `annotate` or `analysis-only`; requires `forwardUrl` |
| `rules` | array | compiled with `compileRules` |
| `cacheSize` | number | `0` disables the cache; otherwise `cache.maxEntries` |
| `cacheTtlMs` | number | `cache.ttlMs` |
| `intent` | string | `triage` or `page` |
| `pageAbove` | number | pager threshold, 0–1 |

Unknown keys throw. There is no key for the API key; it must come from the environment or `envFile`.

## CLI

```text
npx jevlogs                         offline demo, fixed answers, no network, no key
npx jevlogs --page                  offline pager demo (ERROR coupon holds; INFO lag pages)
npx jevlogs --live --page --sample
npx jevlogs --live --page --file <path>
npx jevlogs --live                  local OTLP HTTP/JSON receiver on 127.0.0.1:4318, runs until Ctrl+C
npx jevlogs --live --sample         4 built-in samples through real Jev, then exit
npx jevlogs --live --file <path>    text or JSONL file, finite batch
cat x | npx jevlogs --live --stdin  read to EOF, then evaluate
tail -f x | npx jevlogs --live --stdin --follow --json
  --json           one JSON decision per line on stdout; headers/summary on stderr; no raw bodies
  --limit <1–100>  records to evaluate (default 20; ignored with --follow)
  --follow         with --stdin: evaluate each line as it arrives, no --limit cap, concurrency 4
  --config <path>  config file (default ./jevlogs.config.json)
  --port <n>       receiver port override
  --demo           explicit offline demo
  --help, -h / --version, -v
```

Rules enforced by the parser: `--file`/`--stdin` require `--live`; `--live` and `--demo` are exclusive; `--file` and `--stdin` are exclusive; `--sample` requires `--live` without file/stdin; `--follow` requires `--stdin`. Total input 1 MiB (file and non-follow stdin); each line 8,000 chars. `--follow` output order follows completion, not line order. Plain-text lines get `severityText` from the first ERROR/FATAL/CRITICAL/WARN/INFO/DEBUG/TRACE word. JSONL fields: `body` (else `message`, else whole object), `severityNumber` (must be numeric), `severityText` (else `level`, upper-cased), `protected`.

`--json` line shape: `{"line":N,"mode":"demo"|"live",...Decision}` where `line` counts non-blank records, not physical lines. Human output tags `cached` and `rule <name>` when those fields are set. Live summary includes cache hits, rule hits, Jev call count/avg ms, and `stats().inputTokens` when present.

Exit codes: `0` ok, `1` usage/input/key error, `2` at least one `unavailable` decision (decisions were still printed).

Receiver stdout line shape: `{"traceId","spanId","timeUnixNano",...Decision}`. Raw bodies are never printed. The CLI receiver always supplies `onLog` (stdout). Set `forwardUrl` in the config to also send annotated records to a collector.
