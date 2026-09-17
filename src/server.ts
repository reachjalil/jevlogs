import { createServer, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createJevLogs, createJevPager, scoringAttributes, isPageDecision, type JevOptions, type Decision, type PageDecision, type PagerRule, type Rule } from './index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
type ObjectValue = Record<string, unknown>;
export interface JevLogEvent {
  resource: ObjectValue;
  scope: ObjectValue;
  logRecord: ObjectValue;
  decision: Decision | PageDecision;
}
export interface JevServerOptions extends Omit<JevOptions, 'rules'> {
  rules?: Rule[] | PagerRule[];
  /** Loopback only. Place an authenticated collector in front for remote traffic. */
  port?: number;
  /** Receives the original OTLP record, including identifiers, and its decision. Required unless forwardUrl is set. */
  onLog?: (event: JevLogEvent) => void | Promise<void>;
  /** OTLP HTTP/JSON logs endpoint that receives the annotated batch before onLog runs. */
  forwardUrl?: string;
  /** annotate forwards every record; analysis-only forwards only records routed to analysis (or pages, when intent is page). Default annotate. */
  forwardMode?: 'annotate' | 'analysis-only';
  /** Extra request headers for forwarding. Defaults to OTEL_EXPORTER_OTLP_LOGS_HEADERS or OTEL_EXPORTER_OTLP_HEADERS. */
  forwardHeaders?: Record<string, string>;
  forwardTimeoutMs?: number;
  /** Model evaluations in flight across all requests. Default 4, maximum 32. */
  concurrency?: number;
  /** Requests accepted at once before answering 503. Default 8. */
  maxRequests?: number;
  /** triage (default) is retain/analyze. page is the PagerDuty-style trigger. */
  intent?: 'triage' | 'page';
  /** Pager only. Default 0.5. */
  pageAbove?: number;
  /** Pager only. Default false. */
  pageWhenUnavailable?: boolean;
}
export interface JevServerStats {
  version: string; uptimeMs: number;
  requests: number; records: number; forwarded: number; forwardFailures: number; rejected: number; busy: number;
  triage: (ReturnType<ReturnType<typeof createJevLogs>['stats']>) | (ReturnType<ReturnType<typeof createJevPager>['stats']> & { intent?: 'page' });
}
function object(value: unknown): value is ObjectValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function list(value: unknown): unknown[] { if (value === undefined) return []; if (!Array.isArray(value)) throw new Error('Expected an array'); return value; }
function anyValue(value: unknown): unknown {
  if (!object(value)) return value;
  for (const key of ['stringValue', 'boolValue', 'intValue', 'doubleValue', 'bytesValue']) if (key in value) return value[key];
  if (object(value.arrayValue)) return list(value.arrayValue.values).map(anyValue);
  if (object(value.kvlistValue)) return Object.fromEntries(list(value.kvlistValue.values).map(item => {
    if (!object(item) || typeof item.key !== 'string') throw new Error('Invalid AnyValue');
    return [item.key, anyValue(item.value)];
  }));
  return null;
}
type Pending = Omit<JevLogEvent, 'decision'>;
function decode(value: unknown): Pending[] {
  if (!object(value)) throw new Error('Expected an OTLP JSON object');
  const result: Pending[] = [];
  for (const resource of list(value.resourceLogs)) {
    if (!object(resource)) throw new Error('Invalid resourceLogs');
    for (const scope of list(resource.scopeLogs)) {
      if (!object(scope)) throw new Error('Invalid scopeLogs');
      for (const record of list(scope.logRecords)) {
        if (!object(record)) throw new Error('Invalid logRecord');
        if (record.severityNumber !== undefined && (!Number.isInteger(record.severityNumber) || Number(record.severityNumber) < 0 || Number(record.severityNumber) > 24)) throw new Error('Invalid severityNumber');
        anyValue(record.body);
        list(record.attributes);
        result.push({ resource: object(resource.resource) ? resource.resource : {}, scope: object(scope.scope) ? scope.scope : {}, logRecord: record });
        if (result.length > 100) throw new Error('Maximum 100 records per request');
      }
    }
  }
  return result;
}
/** OTLP JSON KeyValue list for a decision. */
function otlpAttributes(decision: Decision | PageDecision): ObjectValue[] {
  return Object.entries(scoringAttributes(decision)).map(([key, value]) => ({ key, value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : { doubleValue: value } }));
}
/** Rebuild the OTLP payload with jev.* attributes; the caller's parsed input is not mutated. */
function annotate(root: ObjectValue, decisions: Map<ObjectValue, Decision | PageDecision>, mode: 'annotate' | 'analysis-only'): { payload: ObjectValue; count: number } {
  let count = 0;
  const resourceLogs = list(root.resourceLogs).flatMap(resource => {
    if (!object(resource)) return [];
    const scopeLogs = list(resource.scopeLogs).flatMap(scope => {
      if (!object(scope)) return [];
      const logRecords = list(scope.logRecords).flatMap(record => {
        const decision = object(record) ? decisions.get(record) : undefined;
        if (!decision) return [];
        if (mode === 'analysis-only' && (isPageDecision(decision) ? !decision.page : decision.route === 'retain')) return [];
        count++;
        return [{ ...record as ObjectValue, attributes: [...list((record as ObjectValue).attributes), ...otlpAttributes(decision)] }];
      });
      return logRecords.length ? [{ ...scope, logRecords }] : [];
    });
    return scopeLogs.length ? [{ ...resource, scopeLogs }] : [];
  });
  return { payload: { resourceLogs }, count };
}
/** Parse OTEL_EXPORTER_OTLP_HEADERS syntax: key=value pairs separated by commas, values URL-encoded. */
export function parseOtlpHeaders(text: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (text ?? '').split(',')) {
    if (!pair.trim()) continue;
    const separator = pair.indexOf('=');
    if (separator < 1) throw new Error('OTLP headers must be comma-separated key=value pairs');
    const key = pair.slice(0, separator).trim();
    let value = pair.slice(separator + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep raw */ }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Invalid OTLP header: ${key}`);
    headers[key] = value;
  }
  return headers;
}
class Semaphore {
  private readonly waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active++;
    let released = false;
    return () => { if (released) return; released = true; this.active--; this.waiting.shift()?.(); };
  }
}
/** Start a local OTLP/HTTP JSON receiver. Success acknowledges forwarding and callback completion, not durable storage. */
export async function startJevLogsServer(options: JevServerOptions) {
  const port = options.port ?? 4318;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (options.onLog !== undefined && typeof options.onLog !== 'function') throw new Error('onLog must be a function');
  if (!options.onLog && !options.forwardUrl) throw new Error('Provide onLog, forwardUrl, or both');
  if (!options.evaluator && !process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error('Set AI_GATEWAY_API_KEY in the receiver environment');
  const concurrency = options.concurrency ?? 4;
  const maxRequests = options.maxRequests ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 256) throw new Error('concurrency must be 1–32 and maxRequests 1–256');
  let forward: { url: string; mode: 'annotate' | 'analysis-only'; headers: Record<string, string>; timeoutMs: number } | undefined;
  if (options.forwardUrl !== undefined) {
    let url: URL;
    try { url = new URL(options.forwardUrl); } catch { throw new Error('forwardUrl must be an absolute http(s) URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('forwardUrl must be an absolute http(s) URL');
    const headers = options.forwardHeaders ?? parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS);
    const timeoutMs = options.forwardTimeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('forwardTimeoutMs must be positive');
    forward = { url: url.href, mode: options.forwardMode ?? 'annotate', headers, timeoutMs };
  }
  const paging = options.intent === 'page';
  const jev = paging
    ? createJevPager({ timeoutMs: options.timeoutMs, maxInputChars: options.maxInputChars, redact: options.redact, cache: options.cache, pageAbove: options.pageAbove, pageWhenUnavailable: options.pageWhenUnavailable, rules: options.rules as PagerRule[] | undefined })
    : createJevLogs({ ...options, rules: options.rules as Rule[] | undefined });
  const slots = new Semaphore(concurrency);
  const started = Date.now();
  const counters = { requests: 0, records: 0, forwarded: 0, forwardFailures: 0, rejected: 0, busy: 0 };
  let inFlight = 0;
  const reply = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const stats = (): JevServerStats => paging
    ? { version, uptimeMs: Date.now() - started, ...counters, triage: { ...(jev as ReturnType<typeof createJevPager>).stats(), intent: 'page' } }
    : { version, uptimeMs: Date.now() - started, ...counters, triage: (jev as ReturnType<typeof createJevLogs>).stats() };
  const server = createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') { reply(res, 200, { status: 'ok', version, forwarding: Boolean(forward) }); return; }
    if (req.url === '/stats' && req.method === 'GET') { reply(res, 200, stats()); return; }
    if (req.url !== '/v1/logs' || req.method !== 'POST') { reply(res, 404, { code: 5, message: 'POST /v1/logs' }); return; }
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) { reply(res, 415, { code: 3, message: 'Use uncompressed OTLP HTTP/JSON' }); req.resume(); return; }
    if (inFlight >= maxRequests) { counters.busy++; reply(res, 503, { code: 14, message: 'Receiver busy; retry' }, { 'retry-after': '1' }); req.resume(); return; }
    inFlight++;
    counters.requests++;
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { reply(res, 413, { code: 3, message: 'Maximum request size 1 MiB' }); req.resume(); return; }
        chunks.push(Buffer.from(chunk));
      }
      let root: unknown; let records: Pending[];
      try { root = JSON.parse(Buffer.concat(chunks).toString('utf8')); records = decode(root); }
      catch { reply(res, 400, { code: 3, message: 'Invalid OTLP JSON; maximum 100 records' }); return; }
      counters.records += records.length;
      const decisions = new Map<ObjectValue, Decision | PageDecision>();
      await Promise.all(records.map(async event => {
        const release = await slots.acquire();
        try {
          const record = event.logRecord;
          const input = { body: anyValue(record.body), severityNumber: record.severityNumber as number | undefined, severityText: typeof record.severityText === 'string' ? record.severityText : undefined, protected: list(record.attributes).some(a => object(a) && a.key === 'jev.protected' && anyValue(a.value) === true) };
          decisions.set(record, paging ? await (jev as ReturnType<typeof createJevPager>).decide(input) : await (jev as ReturnType<typeof createJevLogs>).triage(input));
        } finally { release(); }
      }));
      let upstream: ObjectValue | undefined;
      if (forward && records.length) {
        const { payload, count } = annotate(root as ObjectValue, decisions, forward.mode);
        if (count) {
          try {
            const response = await fetch(forward.url, { method: 'POST', headers: { ...forward.headers, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(forward.timeoutMs) });
            const text = await response.text().catch(() => '');
            if (!response.ok) throw new Error(`Upstream ${response.status}`);
            counters.forwarded += count;
            try { const parsed = JSON.parse(text); if (object(parsed) && object(parsed.partialSuccess)) upstream = parsed.partialSuccess; } catch { /* non-JSON success body */ }
          } catch {
            // Retryable: the client keeps the batch and onLog has not run, so nothing is double-delivered.
            counters.forwardFailures++;
            reply(res, 503, { code: 14, message: 'Forwarding failed; retry' }, { 'retry-after': '1' });
            return;
          }
        }
      }
      let rejected = 0;
      if (options.onLog) {
        for (const event of records) {
          try { await options.onLog({ ...event, decision: decisions.get(event.logRecord)! }); } catch { rejected++; }
        }
      }
      counters.rejected += rejected;
      reply(res, 200, rejected ? { partialSuccess: { rejectedLogRecords: String(rejected), errorMessage: 'Sink rejected records; partial failures are not retried by OTLP clients' } } : upstream ? { partialSuccess: upstream } : {});
    } catch { if (!res.headersSent) reply(res, 400, { code: 3, message: 'Request interrupted' }); }
    finally { inFlight--; }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/v1/logs`,
    forwardUrl: forward?.url,
    /** Counters since start, including triage counters. Also served at GET /stats. */
    stats,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
export { loadJevConfig } from './config.js';
export type { JevConfig } from './config.js';
