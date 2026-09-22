# jevlogs API reference (verified against jevlogs 0.5.0)

Source of truth: `src/index.ts`, `src/server.ts`, `src/config.ts`, `src/cli.ts` in
https://github.com/reachjalil/jevlogs. If this file and the code disagree, the code wins.

## Package layout

| Import | Exports |
| --- | --- |
| `jevlogs` | `createJevLogs`, `createJevPager`, `shouldPage`, `normalizeLogTemplate`, `scoreDecisions`, `JevLogExporter`, `estimateSavings`, `redactCommonSecrets`, `compileRules`, `decisionAttributes`, types `LogInput`, `Decision`, `Evaluation`, `Evaluator`, `PageDecision`, `PageEvaluation`, `PageEvaluator`, `PageOptions`, `PageStats`, `JevOptions`, `JevStats`, `Rule`, `CacheOptions`, `ExporterOptions`, `CostInputs`, `ScoreRow`, `ScoreReport` |
| `jevlogs/server` | `startJevLogsServer`, `loadJevConfig`, types `JevServerOptions`, `JevLogEvent`, `JevConfig` |
| `npx jevlogs` | CLI (`dist/cli.js`) |

Runtime: Node.js 22 or newer, ESM. Dependency: `ai@7.0.105` (Vercel AI SDK). Optional peer: `@opentelemetry/sdk-logs@0.222.0`, needed at runtime only for `JevLogExporter`, but TypeScript consumers may need it installed for the exported declarations to resolve.

There is no `analyze()`, no `explain()`, no retry helper, no downstream LLM client, no Collector plugin, no gRPC receiver. The decision cache is inside `createJevLogs` / `createJevPager`; it is not a separate export.

## `createJevLogs(options?)`

```ts
interface JevOptions {
  retainBelow?: number;    // default 0.1; must be 0–0.5; 0 disables retain entirely
  timeoutMs?: number;      // default 2000; > 0
  maxInputChars?: number;  // default 8000; integer >= 1
  redact?: (text: string) => string;   // default redactCommonSecrets
  evaluator?: Evaluator;   // default: Jev via AI Gateway
}
type Evaluator = (state: string, signal: AbortSignal) => Promise<Evaluation>;
interface Evaluation { value: number; priority: 'critical'|'high'|'normal'|'low'; actionableProbability: number }
```

Out-of-range options throw `RangeError` at construction. Returns `{ triage(log: LogInput): Promise<Decision> }`.

```ts
interface LogInput { body: unknown; severityNumber?: number; severityText?: string; protected?: boolean; service?: string }
interface Decision {
  value: number;                       // 0–100 rubric score
  priority: 'critical'|'high'|'normal'|'low';
  route: 'analyze'|'retain';
  actionableProbability: number|null;  // null when no model answer
  reason: 'model'|'protected'|'uncertain'|'unavailable'|'rule';
  cached: boolean;   // served from the in-memory decision cache or a shared in-flight evaluation
  rule?: string;     // matching rule name when reason === 'rule'
}
```

### Exact decision algorithm

1. If `protected === true`, or `severityNumber >= 17`, or `severityText` matches `ERROR|FATAL|CRITICAL` (case-insensitive): return `{ value: 100, priority: 'critical', route: 'analyze', actionableProbability: null, reason: 'protected', cached: false }`. No network call.
2. Serialize `{ body, severityText, severityNumber }` with `JSON.stringify`, plus `service` when it is a non-empty string (trimmed, max 128 characters). If longer than `maxInputChars`: `reason: 'unavailable'` fallback.
2a. `rules` are tested against the redacted body text; first match returns `reason: 'rule'` (`retain` gives value 0 / low, `analyze` gives the fallback). Then the cache is checked by SHA-256 of the redacted state after `normalizeLogTemplate`, unless `normalizeTemplates` is false. Hits return `cached: true`. Identical in-flight templates share one model call. `service` is included in the serialized state when set.
3. Run `redact` on that string. If it throws, returns a non-string, or the result exceeds `maxInputChars`: `unavailable` fallback.
4. Call the evaluator with the redacted string, racing against `timeoutMs`. On timeout the abort signal fires.
5. Validate the answer: probability in [0,1], value finite in [0,100], priority in the four allowed strings. Anything else: `unavailable` fallback.
6. `retain = actionableProbability < retainBelow && value <= 25 && priority === 'low'`.
7. `reason = retain || actionableProbability >= 1 - retainBelow ? 'model' : 'uncertain'`.

The `unavailable` fallback is `{ value: 100, priority: 'high', route: 'analyze', actionableProbability: null, reason: 'unavailable' }`. Provider error details are not exposed. There are no automatic retries (`maxRetries: 0` is passed to the AI SDK). Failures are never cached.

0.3.0 additions: `createJevLogs({ rules, cache })`, `jev.stats()`, `JevLogExporter#stats()`, `startJevLogsServer({ forwardUrl, forwardMode, forwardHeaders, forwardTimeoutMs, concurrency, maxRequests })` with `onLog` optional when forwarding, `GET /stats`, `parseOtlpHeaders()`, `compileRules()`, `decisionAttributes()`, and the CLI flag `--follow` for streaming stdin. Config keys `forwardUrl`, `forwardMode`, `rules`, `cacheSize`, `cacheTtlMs`, `normalizeTemplates`.

### What the default evaluator sends

One `experimental_evaluate` call with `model: 'typesafe-ai/jev'`, `state` = the redacted string, `providerOptions: { gateway: { zeroDataRetention: true } }`, and three questions:

| id | type | maps to |
| --- | --- | --- |
| `actionable` | boolean | `actionableProbability = answers.actionable.probability` |
| `priority` | choice (critical/high/normal/low) | `priority = answers.priority.choice` |
| `value` | score, 5 criteria | `value = answers.value.score * 25` |

Each question's instructions tell Jev to treat the log as untrusted data and ignore embedded instructions. The rubric levels are: no useful signal, routine detail, useful context, actionable failure evidence, incident-defining evidence.

`experimental_evaluate` also returns `usage: { inputTokens, outputTokens, totalTokens }`. Successful calls add `inputTokens` to `stats()`. Output tokens are not stored. To measure anything else, pass a custom `evaluator` (see `../examples/measured-evaluator.ts`).

## `createJevPager(options?)` and `shouldPage(probability, pageAbove?)`

```ts
interface PageOptions {
  pageAbove?: number;              // default 0.5; must be 0.05–0.95
  pageOnSeverity?: 'fatal' | 'error' | 'never'; // default 'fatal'
  pageOnUnavailable?: boolean;     // default false
  timeoutMs?: number; maxInputChars?: number; redact?: (text: string) => string;
  evaluator?: PageEvaluator; rules?: Rule[]; cache?: CacheOptions | false; normalizeTemplates?: boolean;
}
interface PageDecision {
  page: boolean; probability: number | null;
  reason: 'model' | 'protected' | 'unavailable' | 'rule';
  cached: boolean; rule?: string;
}
```

`decide(log)` asks one boolean, `page_now`. `page` is `probability >= pageAbove`. `shouldPage` is that comparison and throws on an out-of-range threshold.

Local bypass, before rules and the model: `protected: true` always pages. `fatal` (default) also pages FATAL/CRITICAL and `severityNumber >= 21`. `error` also pages ERROR and `severityNumber >= 17`. `never` bypasses only for `protected: true`. ERROR lines are scored by default because paging on severity is a false-alarm machine.

A matching rule holds when `route` is `retain` and pages when `route` is `analyze`. Timeouts and failures hold unless `pageOnUnavailable` is true, and they are not cached. Template caching matches `createJevLogs`.

## `normalizeLogTemplate(text)`

Replaces UUIDs, ISO and `HH:MM:SS` timestamps, IPv4, IPv6, `blk_` ids, hex strings of 16+ characters, paths of two or more segments, and numbers of 6+ digits. Short values such as `47m` and `94%` are unchanged. Used for cache keys, not as the model input.

## `redactCommonSecrets(text)`

Replaces `Bearer <token>`, the value after `password|api_key|api-key|apikey|token|secret` followed by `:` or `=`, and email addresses. Synchronous, regex-based, not a PII detector. Compose it: `redact: t => redactCommonSecrets(t).replace(/customer_\w+/g, '[CUSTOMER]')`.

## `JevLogExporter`

```ts
interface ExporterOptions extends JevOptions {
  exporter: LogRecordExporter;         // the user's real exporter; wrapped, never mutated
  mode?: 'annotate' | 'analysis-only'; // default 'annotate'
  concurrency?: number;                // default 4; integer 1–32
}
```

Implements `LogRecordExporter` (`export`, `forceFlush`, `shutdown`). Put it inside `BatchLogRecordProcessor`. Per record it calls `triage` with `body`, `severityNumber`, `severityText`, `protected = attributes['jev.protected'] === true`, and `service` from resource attribute `service.name` when that value is a string. It then forwards a **new** record object that copies body, severity, `hrTime`, `hrTimeObserved`, `spanContext`, `eventName`, `resource`, `instrumentationScope`, `droppedAttributesCount`, and attributes plus:

| attribute | value |
| --- | --- |
| `jev.value` | number |
| `jev.priority` | string |
| `jev.route` | `analyze` or `retain` |
| `jev.reason` | string |
| `jev.cached` | boolean, present only when true |
| `jev.rule` | string, present only when a rule decided |
| `jev.actionable_probability` | number; omitted when the decision has `null` |

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
// returns { baseline, triage, withJev, savings, percent, breakEvenSkipFraction }
// breakEvenSkipFraction = baseline > 0 ? triage / baseline : null
// Above 1, triage costs more than analyzing every log. null when baseline is 0.
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
  onLog: (event: JevLogEvent) => void | Promise<void>;  // required
}
interface JevLogEvent { resource: object; scope: object; logRecord: object; decision: Decision }
```

Returns `{ url, close() }`. Throws at startup if `onLog` is missing or if neither `evaluator` nor `AI_GATEWAY_API_KEY` is present. Protocol and limits are in `integration.md`.

## `loadJevConfig(path?)` and `jevlogs.config.json`

Reads JSON only (never executes code). Default path `./jevlogs.config.json`; a missing default file returns `{}`, a missing explicit path throws. Allowed keys and nothing else:

| key | type | note |
| --- | --- | --- |
| `port` | number | receiver port |
| `envFile` | string | dotenv path resolved relative to the config file; loaded with `process.loadEnvFile`; existing env vars win |
| `retainBelow` | number | |
| `timeoutMs` | number | |
| `maxInputChars` | number | |
| `forwardUrl` | string | absolute http(s) URL |
| `forwardMode` | `"annotate"` or `"analysis-only"` | requires `forwardUrl` |
| `rules` | array | same shape as `Rule`, match is a string |
| `cacheSize` | number | `0` disables the cache; becomes `cache` on the returned object |
| `cacheTtlMs` | number | |
| `normalizeTemplates` | boolean | default true when omitted |
| `maxModelCalls` | number | integer 0–1000000; omitted means no cap |
| `suppressForMs` | number | integer 0–86400000; pager cooldown, ignored by analysis routing |

Unknown keys throw. There is no key for the API key; it must come from the environment or `envFile`.

## `scoreDecisions(rows)`

```ts
interface ScoreRow { important: boolean; selected: boolean; line?: number }
// recall = truePositives / important, or null when important is 0
// precision = truePositives / selected, or null when selected is 0
// misses: line numbers of important rows that were not selected
```

For analysis, `selected` means `route === 'analyze'`. For paging, `selected` means `page === true`. Rows with a non-boolean `important` or `selected` throw. This function does not call a model.

`Decision.reason` and `PageDecision.reason` include `budget` when `maxModelCalls` is exhausted. `PageDecision.reason` includes `suppressed` when `suppressForMs` holds a repeat. Analysis past the budget stays `route: 'analyze'`. A suppressed page is `page: false` and does not call the model.

## CLI

```text
npx jevlogs                         offline demo, fixed answers, no network, no key
npx jevlogs --live                  local OTLP HTTP receiver (JSON or protobuf) on 127.0.0.1:4318, runs until Ctrl+C
npx jevlogs --live --sample         4 built-in samples through real Jev, then exit
npx jevlogs --live --file <path>    text or JSONL file, finite batch
cat x | npx jevlogs --live --stdin  read to EOF, then evaluate
  --json           one JSON decision per line on stdout; headers/summary on stderr; no raw bodies
  --limit <1–100>  records to evaluate (default 20)
  --config <path>  config file (default ./jevlogs.config.json)
  --port <n>       receiver port override
  --page           page/hold demo, or with --live a file/stdin page pass
  --page-above <n> page threshold 0.05–0.95 (requires --page)
  --suppress-ms <n> hold repeat pages of one template (requires --page)
  --max-calls <n>  cap model invocations at n (0–1000000)
  --labels         print recall and precision from important/label; miss exits 2
  --demo           explicit offline demo
  --help, -h / --version, -v
```

Rules enforced by the parser: `--file`/`--stdin` require `--live`; `--live` and `--demo` are exclusive; `--file` and `--stdin` are exclusive; `--sample` requires `--live` without file/stdin. Total input 1 MiB; each line 8,000 chars. Plain-text lines get `severityText` from the first ERROR/FATAL/CRITICAL/WARN/INFO/DEBUG/TRACE word. JSONL fields: `body` (else `message`, else `msg`, else whole object), `severityNumber` (must be numeric), `severityText` (else `level`; strings are upper-cased; Pino numbers 10–60 map to TRACE–FATAL and an OTel severity number), `service`, `protected`.

`--page` uses `createJevPager` on a sample, file, or stdin stream. It does not switch the OTLP receiver. `--page-above` requires `--page` and must be 0.05–0.95. JSON lines add `"task":"page"` and a `page` boolean.

`--json` line shape: `{"line":N,"mode":"demo"|"live",...Decision}` where `line` counts non-blank records, not physical lines.

Exit codes: `0` ok, `1` usage/input/key error, `2` at least one `unavailable` decision (decisions were still printed).

Receiver stdout line shape: `{"traceId","spanId","timeUnixNano",...Decision}`. Raw bodies are never printed.
