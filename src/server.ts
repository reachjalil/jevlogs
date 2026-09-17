import { createServer, type ServerResponse } from 'node:http';
import { createJevLogs, type JevOptions, type Decision } from './index.js';

type ObjectValue = Record<string, unknown>;
export interface JevLogEvent {
  resource: ObjectValue;
  scope: ObjectValue;
  logRecord: ObjectValue;
  decision: Decision;
}
export interface JevServerOptions extends JevOptions {
  /** Loopback only. Place an authenticated collector in front for remote traffic. */
  port?: number;
  /** Receives the original OTLP record, including identifiers, and its decision. */
  onLog: (event: JevLogEvent) => void | Promise<void>;
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
function decode(value: unknown): Omit<JevLogEvent, 'decision'>[] {
  if (!object(value)) throw new Error('Expected an OTLP JSON object');
  const result: Omit<JevLogEvent, 'decision'>[] = [];
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
/** Start a local OTLP/HTTP JSON receiver. Success acknowledges callback completion, not durable storage. */
export async function startJevLogsServer(options: JevServerOptions) {
  const port = options.port ?? 4318;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (typeof options.onLog !== 'function') throw new Error('onLog is required');
  if (!options.evaluator && !process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error('Set AI_GATEWAY_API_KEY in the receiver environment');
  const triage = createJevLogs(options).triage;
  let active = false;
  const reply = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') { reply(res, 200, { status: 'ok' }); return; }
    if (req.url !== '/v1/logs' || req.method !== 'POST') { reply(res, 404, { code: 5, message: 'POST /v1/logs' }); return; }
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) { reply(res, 415, { code: 3, message: 'Use uncompressed OTLP HTTP/JSON' }); req.resume(); return; }
    if (active) { res.setHeader('retry-after', '1'); reply(res, 503, { code: 14, message: 'Receiver busy; retry' }); req.resume(); return; }
    active = true;
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { reply(res, 413, { code: 3, message: 'Maximum request size 1 MiB' }); req.resume(); return; }
        chunks.push(Buffer.from(chunk));
      }
      let records: ReturnType<typeof decode>;
      try { records = decode(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reply(res, 400, { code: 3, message: 'Invalid OTLP JSON; maximum 100 records' }); return; }
      let rejected = 0;
      // Bounded concurrency; input remains intact for the application's sink.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
        while (cursor < records.length) {
          const event = records[cursor++]!;
          const record = event.logRecord;
          try {
            const decision = await triage({ body: anyValue(record.body), severityNumber: record.severityNumber as number | undefined, severityText: typeof record.severityText === 'string' ? record.severityText : undefined, protected: list(record.attributes).some(a => object(a) && a.key === 'jev.protected' && anyValue(a.value) === true) });
            await options.onLog({ ...event, decision });
          } catch { rejected++; }
        }
      }));
      reply(res, 200, rejected ? { partialSuccess: { rejectedLogRecords: String(rejected), errorMessage: 'Sink rejected records; partial failures are not retried by OTLP clients' } } : {});
    } catch { if (!res.headersSent) reply(res, 400, { code: 3, message: 'Request interrupted' }); }
    finally { active = false; }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/v1/logs`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
export { loadJevConfig } from './config.js';
export type { JevConfig } from './config.js';
