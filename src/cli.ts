#!/usr/bin/env node
import { loadJevConfig } from './config.js';
import { startJevLogsServer } from './server.js';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { createJevLogs, createJevPager, redactCommonSecrets, isPageDecision, type LogInput, type Evaluation, type Decision, type PageDecision, type JevStats, type PagerStats, type PagerRule, type PagerEvaluation } from './index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const HELP = `
  jevlogs ${version} — keep your logs. spend on the signal.

  npx jevlogs                         Offline sample demo (no key, no network)
  npx jevlogs --live                  Start local OTLP HTTP/JSON receiver
  npx jevlogs --live --page --file app.log
  npx jevlogs --live --page --stdin --json

  --page             PagerDuty trigger: page a human now? (not triage)
  --config <path>    Config file (default ./jevlogs.config.json)
  --sample           Evaluate built-in samples with --live and exit
  --port <number>    Local receiver port (default 4318)
  --demo             Explicit offline sample demo (default)
  --live             Send redacted log bodies to Vercel AI Gateway / TypeSafe
  --file <path>      Read a local text or JSONL file (requires --live)
  --stdin            Read stdin (requires --live; finish input to begin)
  --follow           With --stdin: evaluate each line as it arrives, no limit
  --limit <1–100>    Max records to evaluate; default 20 (ignored with --follow)
  --json             Emit one JSON object per record; summary goes to stderr
  --help, -h         Show help
  --version, -v      Show version

  Live mode requires AI_GATEWAY_API_KEY in your server environment.
  Provider charges apply. Default redaction is not a complete PII policy.
  Input limit: 1 MiB total / 8,000 characters per record. No files are changed.
  JSONL accepts body or message, severityNumber, severityText or level,
  service, and protected: true. Triage: errors bypass the model. --page
  scores every line; ERROR is not a page.
  Receiver: GET /health, GET /stats. Set forwardUrl in the config to send
  annotated records on to your collector. intent: "page" or --page uses the
  on-call trigger (probability >= 0.50) instead of retain/analyze.
`;
const MAX_BYTES = 1024 * 1024;
const samples: LogInput[] = [
  { body: 'GET /health returned 200 in 2ms', severityText: 'INFO' },
  { body: 'Cache hit for product:482', severityText: 'DEBUG' },
  { body: 'Payment capture failed after three retries', severityText: 'ERROR' },
  { body: 'Database connection pool at 94% capacity for five minutes', severityText: 'WARN' },
];
// Fixed sample answers demonstrate the SDK policy. They are not model inference.
const sampleAnswers: Evaluation[] = [
  { value: 0, priority: 'low', actionableProbability: 0.01 },
  { value: 25, priority: 'low', actionableProbability: 0.03 },
  { value: 100, priority: 'critical', actionableProbability: 0.99 },
  { value: 75, priority: 'high', actionableProbability: 0.92 },
];
const pageSamples: LogInput[] = [
  { body: 'GET /health returned 200 in 2ms', severityText: 'INFO', service: 'api' },
  { body: 'INVALID_COUPON rejected at checkout', severityText: 'ERROR', service: 'checkout' },
  { body: 'Payment capture failed after three retries', severityText: 'ERROR', service: 'payments' },
  { body: 'Replica lag 47m on primary still accepting writes; failover would drop recent orders', severityText: 'INFO', service: 'orders-db' },
];
const pageAnswers: PagerEvaluation[] = [
  { probability: 0.05 },
  { probability: 0.06 },
  { probability: 0.97 },
  { probability: 0.91 },
];
function parseRecord(line: string, index: number): LogInput {
  if (line.length > 8000) throw new Error(`Line ${index + 1} exceeds 8,000 characters.`);
  let record: unknown;
  try { record = JSON.parse(line); } catch { return { body: line, severityText: line.match(/\b(ERROR|FATAL|CRITICAL|WARN|INFO|DEBUG|TRACE)\b/i)?.[1]?.toUpperCase() }; }
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    const r = record as Record<string, unknown>;
    if (r.severityNumber !== undefined && (typeof r.severityNumber !== 'number' || !Number.isFinite(r.severityNumber))) throw new Error(`Line ${index + 1}: severityNumber must be numeric.`);
    const level = r.severityText ?? r.level;
    return { body: r.body ?? r.message ?? record, severityNumber: r.severityNumber as number | undefined, severityText: typeof level === 'string' ? level.toUpperCase() : undefined, protected: r.protected === true, service: typeof r.service === 'string' ? r.service : undefined };
  }
  return { body: record };
}
async function stdinText(): Promise<string> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > MAX_BYTES) { process.stdin.destroy(); throw new Error('Input exceeds 1 MiB. Pass a smaller file.'); }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function display(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return redactCommonSecrets(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 110);
}
function printDecision(index: number, mode: 'live' | 'demo', record: LogInput, decision: Decision | PageDecision, json: boolean) {
  if (json) { console.log(JSON.stringify({ line: index + 1, mode, ...decision })); return; }
  if (isPageDecision(decision)) {
    const tags = [decision.reason + (decision.rule ? ` ${decision.rule}` : ''), decision.cached ? 'cached' : '', decision.probability === null ? '' : `p ${(decision.probability * 100).toFixed(0)}% ≥ ${decision.pageAbove}`].filter(Boolean).join(' · ');
    console.log(`  ${decision.page ? 'PAGE ' : 'HOLD '}  ${display(record.body)}\n             ${tags}\n`);
    return;
  }
  const tags = [decision.reason + (decision.rule ? ` ${decision.rule}` : ''), decision.cached ? 'cached' : '', decision.actionableProbability === null ? '' : `actionable ${(decision.actionableProbability * 100).toFixed(0)}%`].filter(Boolean).join(' · ');
  console.log(`  ${String(decision.value).padStart(3)} / 100  ${decision.priority.padEnd(8)} ${decision.route === 'analyze' ? 'ANALYZE' : 'RETAIN '}  ${display(record.body)}\n             ${tags}\n`);
}
function summary(stats: JevStats | (PagerStats & { page?: number }), live: boolean, paging: boolean): string {
  if (paging) {
    const pager = stats as PagerStats;
    const parts = [`${pager.decisions} logs scored`, `${pager.page} page`, `${pager.hold} hold`];
    if (live) {
      if (pager.cached) parts.push(`${pager.cached} served from cache`);
      if (pager.rules) parts.push(`${pager.rules} decided by rules`);
      if (pager.modelLatencyMs.count) parts.push(`${pager.modelLatencyMs.count} Jev calls, avg ${(pager.modelLatencyMs.total / pager.modelLatencyMs.count).toFixed(0)} ms`);
      if (pager.inputTokens) parts.push(`${pager.inputTokens} Jev input tokens`);
    }
    return parts.join(' · ') + '.';
  }
  const triage = stats as JevStats;
  const parts = [`${triage.decisions} logs preserved`, `${triage.analyze} selected for analysis`, `${triage.retain} may skip deeper analysis`];
  if (live) {
    if (triage.cached) parts.push(`${triage.cached} served from cache`);
    if (triage.rules) parts.push(`${triage.rules} decided by rules`);
    if (triage.modelLatencyMs.count) parts.push(`${triage.modelLatencyMs.count} Jev calls, avg ${(triage.modelLatencyMs.total / triage.modelLatencyMs.count).toFixed(0)} ms`);
    if (triage.inputTokens) parts.push(`${triage.inputTokens} Jev input tokens`);
  }
  return parts.join(' · ') + '.';
}
async function main() {
  const args = process.argv.slice(2);
  let sample = false, port: number | undefined, configPath: string | undefined;
  let live = false, demo = false, json = false, stdin = false, follow = false, page = false, file: string | undefined, limit = 20;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(HELP); return; }
    if (arg === '--version' || arg === '-v') { console.log(version); return; }
    if (arg === '--live') live = true;
    else if (arg === '--sample') sample = true;
    else if (arg === '--demo') demo = true;
    else if (arg === '--json') json = true;
    else if (arg === '--stdin') stdin = true;
    else if (arg === '--follow') follow = true;
    else if (arg === '--page') page = true;
    else if (arg === '--file' || arg === '--limit' || arg === '--port' || arg === '--config') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--config') configPath = value;
      else if (arg === '--file') file = value;
      else if (arg === '--port') { port = Number(value); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port'); }
      else { limit = Number(value); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer from 1 to 100.'); }
    } else throw new Error(`Unknown option: ${arg}. Run jevlogs --help.`);
  }
  if (live && demo) throw new Error('Choose --live or --demo, not both.');
  if (file && stdin) throw new Error('Choose --file or --stdin, not both.');
  if ((file || stdin) && !live) throw new Error('Custom logs require --live. The offline demo uses fixed samples only.');
  if (follow && !stdin) throw new Error('--follow requires --stdin.');
  const config = live ? await loadJevConfig(configPath) : {};
  const paging = page || config.intent === 'page';
  if (live && !process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error('Live mode requires AI_GATEWAY_API_KEY. Set it in your environment; do not pass keys on the command line.');
  if (sample && (!live || file || stdin)) throw new Error('--sample requires --live without --file or --stdin');
  if (live && !sample && !file && !stdin) {
    const receiver = await startJevLogsServer({
      ...config,
      port: port ?? config.port,
      intent: paging ? 'page' : config.intent,
      rules: config.rules as never,
      onLog(event) {
      // CLI emits decisions and correlation IDs only, never raw bodies or credentials.
      console.log(JSON.stringify({ traceId: event.logRecord.traceId, spanId: event.logRecord.spanId, timeUnixNano: event.logRecord.timeUnixNano, ...event.decision }));
    } });
    const forwardNote = receiver.forwardUrl ? `Annotated records are forwarded to ${receiver.forwardUrl} (${config.forwardMode ?? 'annotate'}).` : 'No forwardUrl configured: decisions go to stdout only.';
    const job = paging ? 'PAGE trigger (p≥0.50 unless pageAbove is set). ERROR is not auto-paged.' : 'Triage retain/analyze.';
    console.error(`JEV LOGS ${version} · LIVE receiver: ${receiver.url}\n${job} Send OTLP HTTP/JSON logs. ${forwardNote}\nRedacted bodies go to Vercel AI Gateway / TypeSafe. Provider charges apply. GET /stats for counters. Ctrl+C to stop.`);
    const stop = () => {
      const s = receiver.stats();
      console.error(`\n${summary(s.triage, true, paging)} ${s.forwarded ? `${s.forwarded} forwarded, ${s.forwardFailures} forward failures.` : ''}`.trimEnd());
      void receiver.close().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  const mode = live ? 'live' : 'demo';
  console.error(live ? `\nJEV LOGS ${version} · LIVE · typesafe-ai/jev${paging ? ' · PAGE' : ''}\nRedacted bodies are sent to AI Gateway / TypeSafe; provider charges apply.\n` : `\nJEV LOGS ${version} · OFFLINE DEMO${paging ? ' · PAGE' : ''}\nFixed sample answers, not Jev inference. No network requests. Try --live with a Gateway key.\n`);
  let demoIndex = 0;
  const jev = paging
    ? createJevPager(live ? { timeoutMs: config.timeoutMs, maxInputChars: config.maxInputChars, cache: config.cache, pageAbove: config.pageAbove, rules: config.rules as PagerRule[] | undefined } : { cache: false, evaluator: async () => pageAnswers[demoIndex % pageAnswers.length]! })
    : createJevLogs(live ? { retainBelow: config.retainBelow, timeoutMs: config.timeoutMs, maxInputChars: config.maxInputChars, cache: config.cache, rules: config.rules as never } : { cache: false, evaluator: async () => sampleAnswers[demoIndex % sampleAnswers.length]! });
  const decide = (record: LogInput) => paging ? (jev as ReturnType<typeof createJevPager>).decide(record) : (jev as ReturnType<typeof createJevLogs>).triage(record);
  const finish = () => {
    const stats = jev.stats();
    console.error(summary(stats, live, paging));
    if (stats.unavailable) { console.error(`${stats.unavailable} evaluation(s) unavailable; ${paging ? 'those records did not page.' : 'records conservatively kept for analysis.'} Check Gateway access, connectivity, or input size.`); process.exitCode = 2; }
  };
  if (follow) {
    // Streaming mode: bounded concurrency with readline backpressure; output order follows completion.
    const CONCURRENCY = 4;
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let index = 0, active = 0, closed = false;
    const pending = new Set<Promise<void>>();
    await new Promise<void>(resolve => {
      const maybeDone = () => { if (closed && active === 0) resolve(); };
      rl.on('line', line => {
        if (!line.trim()) return;
        const current = index++;
        let record: LogInput;
        try { record = parseRecord(line, current); } catch (error) { console.error(`jevlogs: skipped line ${current + 1}: ${error instanceof Error ? error.message : 'invalid record'}`); return; }
        active++;
        if (active >= CONCURRENCY) rl.pause();
        const task = decide(record).then(decision => printDecision(current, mode, record, decision, json)).finally(() => { active--; pending.delete(task); if (active < CONCURRENCY) rl.resume(); maybeDone(); });
        pending.add(task);
      });
      rl.once('close', () => { closed = true; maybeDone(); });
    });
    finish();
    return;
  }
  let records = paging ? pageSamples : samples;
  if (file || stdin) {
    if (file && (await stat(file)).size > MAX_BYTES) throw new Error('Input exceeds 1 MiB. Pass a smaller file.');
    const text = file ? await readFile(file, 'utf8') : await stdinText();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Input exceeds 1 MiB.');
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) throw new Error('No log records found.');
    if (lines.length > limit) console.error(`Processing the first ${limit} of ${lines.length} records; raise --limit up to 100 to include more.`);
    records = lines.slice(0, limit).map(parseRecord);
  } else records = (paging ? pageSamples : samples).slice(0, limit);
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    demoIndex = i;
    printDecision(i, mode, record, await decide(record), json);
  }
  finish();
}
main().catch(error => { console.error(`jevlogs: ${error instanceof Error ? error.message : 'Unexpected failure'}`); process.exitCode = 1; });
