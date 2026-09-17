#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createJevLogs, redactCommonSecrets, type LogInput, type Evaluation } from './index.js';

const HELP = `
  jevlogs — keep your logs. spend on the signal.

  npx jevlogs                         Offline sample demo (no key, no network)
  npx jevlogs --live                  Evaluate sample logs with real Jev
  npx jevlogs --live --file app.log    Evaluate a text or JSONL log file
  cat app.log | npx jevlogs --live --stdin --json

  --demo             Explicit offline sample demo (default)
  --live             Send redacted log bodies to Vercel AI Gateway / TypeSafe
  --file <path>      Read a local text or JSONL file (requires --live)
  --stdin            Read stdin (requires --live; finish input to begin)
  --limit <1–100>    Max records to evaluate; default 20
  --json             Emit one JSON object per record; summary goes to stderr
  --help, -h         Show help
  --version, -v      Show version

  Live mode requires AI_GATEWAY_API_KEY in your server environment.
  Provider charges apply. Default redaction is not a complete PII policy.
  Input limit: 1 MiB total / 8,000 characters per record. No files are changed.
  JSONL accepts body or message, severityNumber, severityText or level,
  and protected: true. Errors and protected logs bypass the model.
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
function parseRecord(line: string, index: number): LogInput {
  if (line.length > 8000) throw new Error(`Line ${index + 1} exceeds 8,000 characters.`);
  let record: unknown;
  try { record = JSON.parse(line); } catch { return { body: line, severityText: line.match(/\b(ERROR|FATAL|CRITICAL|WARN|INFO|DEBUG|TRACE)\b/i)?.[1]?.toUpperCase() }; }
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    const r = record as Record<string, unknown>;
    if (r.severityNumber !== undefined && (typeof r.severityNumber !== 'number' || !Number.isFinite(r.severityNumber))) throw new Error(`Line ${index + 1}: severityNumber must be numeric.`);
    const level = r.severityText ?? r.level;
    return { body: r.body ?? r.message ?? record, severityNumber: r.severityNumber as number | undefined, severityText: typeof level === 'string' ? level.toUpperCase() : undefined, protected: r.protected === true };
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
async function main() {
  const args = process.argv.slice(2);
  let live = false, demo = false, json = false, stdin = false, file: string | undefined, limit = 20;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(HELP); return; }
    if (arg === '--version' || arg === '-v') { console.log('0.1.1'); return; }
    if (arg === '--live') live = true;
    else if (arg === '--demo') demo = true;
    else if (arg === '--json') json = true;
    else if (arg === '--stdin') stdin = true;
    else if (arg === '--file' || arg === '--limit') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--file') file = value;
      else { limit = Number(value); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer from 1 to 100.'); }
    } else throw new Error(`Unknown option: ${arg}. Run jevlogs --help.`);
  }
  if (live && demo) throw new Error('Choose --live or --demo, not both.');
  if (file && stdin) throw new Error('Choose --file or --stdin, not both.');
  if ((file || stdin) && !live) throw new Error('Custom logs require --live. The offline demo uses fixed samples only.');
  if (live && !process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error('Live mode requires AI_GATEWAY_API_KEY. Set it in your environment; do not pass keys on the command line.');
  let records = samples;
  if (file || stdin) {
    if (file && (await stat(file)).size > MAX_BYTES) throw new Error('Input exceeds 1 MiB. Pass a smaller file.');
    const text = file ? await readFile(file, 'utf8') : await stdinText();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Input exceeds 1 MiB.');
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) throw new Error('No log records found.');
    if (lines.length > limit) console.error(`Processing the first ${limit} of ${lines.length} records; raise --limit up to 100 to include more.`);
    records = lines.slice(0, limit).map(parseRecord);
  } else records = samples.slice(0, limit);
  console.error(live ? '\nJEV LOGS · LIVE · typesafe-ai/jev\nRedacted bodies are sent to AI Gateway / TypeSafe; provider charges apply.\n' : '\nJEV LOGS · OFFLINE DEMO\nFixed sample answers, not Jev inference. No network requests. Try --live with a Gateway key.\n');
  let analyze = 0, unavailable = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const triage = createJevLogs(live ? {} : { evaluator: async () => sampleAnswers[i]! }).triage;
    const decision = await triage(record);
    if (decision.route === 'analyze') analyze++;
    if (decision.reason === 'unavailable') unavailable++;
    if (json) console.log(JSON.stringify({ line: i + 1, mode: live ? 'live' : 'demo', ...decision }));
    else console.log(`  ${String(decision.value).padStart(3)} / 100  ${decision.priority.padEnd(8)} ${decision.route === 'analyze' ? 'ANALYZE' : 'RETAIN '}  ${display(record.body)}\n             ${decision.reason}${decision.actionableProbability === null ? '' : ` · actionable ${(decision.actionableProbability * 100).toFixed(0)}%`}\n`);
  }
  console.error(`${records.length} logs preserved · ${analyze} selected for analysis · ${records.length - analyze} may skip deeper analysis.`);
  if (unavailable) { console.error(`${unavailable} evaluation(s) unavailable; records conservatively kept for analysis. Check Gateway access, connectivity, or input size.`); process.exitCode = 2; }
}
main().catch(error => { console.error(`jevlogs: ${error instanceof Error ? error.message : 'Unexpected failure'}`); process.exitCode = 1; });
