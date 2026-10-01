#!/usr/bin/env node
// Installs the packed tarball into throwaway projects and uses it the way people will:
// pnpm with strict peers, npm, TypeScript 5 and 7 without skipLibCheck, the CLI binary,
// require(), and the OpenTelemetry exporter at both ends of the declared peer range.
//
// Usage: node scripts/smoke.mjs [path/to/jevlogs-x.y.z.tgz]
// Packs the working tree when no tarball is given. SMOKE_KEEP=1 keeps the temp projects.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const otelFloor = /^>=\s*(\d+\.\d+\.\d+)/.exec(pkg.peerDependencies['@opentelemetry/sdk-logs'])?.[1];
if (!otelFloor) throw new Error('Could not read the @opentelemetry/sdk-logs peer range floor.');
const otelVersions = [...new Set([otelFloor, pkg.devDependencies['@opentelemetry/sdk-logs']])];
const typescriptVersions = [...new Set([pkg.devDependencies.typescript, '7.0.2'])];
const nodeTypes = '@types/node@22';
const work = mkdtempSync(join(tmpdir(), 'jevlogs-smoke-'));
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
delete env.AI_GATEWAY_API_KEY; // the smoke test must never reach a model
let failures = 0;

// Returns stdout, or stdout and stderr together with { all: true }. The CLI writes its banner and summary to stderr.
function run(cmd, args, cwd, { status = 0, all = false } = {}) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== status) throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}, expected ${status}\n${result.stdout}${result.stderr}`.trim());
  return all ? result.stdout + result.stderr : result.stdout;
}
async function check(label, fn) {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (error) { failures++; console.log(`  ✗ ${label}\n${String(error instanceof Error ? error.message : error).replace(/^/gm, '      ')}`); }
}
function project(name, files) {
  const dir = join(work, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `smoke-${name}`, private: true, type: 'module' }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}
// Peers are not auto-installed, so a peer this package forgets to satisfy shows up here. pnpm 12 fails
// the install; pnpm 9 and 10 only warn, and the CLI then crashes at runtime, so a warning fails too.
function pnpmAdd(dir, deps) {
  const out = run('pnpm', ['add', ...deps, '--config.auto-install-peers=false', '--config.strict-peer-dependencies=true'], dir, { all: true });
  if (/missing peer|issues with peer dependencies/i.test(out)) throw new Error(out.trim());
}
const tsc = (dir, file, resolution) => run('pnpm', ['exec', 'tsc', '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'es2022', '--types', 'node',
  ...(resolution === 'bundler' ? ['--module', 'esnext', '--moduleResolution', 'bundler'] : ['--module', 'nodenext', '--moduleResolution', 'nodenext']), file], dir);

const consumerTs = `import { createJevLogs, createJevPager, JevLogExporter, shouldPage, type Decision, type LogRecordExporterLike } from 'jevlogs';
import { startJevLogsServer, loadJevConfig, type JevServerOptions } from 'jevlogs/server';
const jev = createJevLogs({ evaluator: async () => ({ value: 5, priority: 'low', actionableProbability: 0.02 }) });
const decision: Decision = await jev.triage({ body: 'GET /health returned 200 in 2ms', severityText: 'INFO' });
const route: 'analyze' | 'retain' = decision.route;
const pager = createJevPager({ evaluator: async () => ({ probability: 0.9 }) });
const sink: LogRecordExporterLike = { export: (_records, done) => done({ code: 0 }), shutdown: async () => {} };
const exporter = new JevLogExporter({ exporter: sink });
const options: JevServerOptions = { port: 0, onLog: event => { void event.decision.route; } };
console.log(route, shouldPage(0.7), typeof pager.decide, typeof exporter.export, typeof startJevLogsServer, typeof loadJevConfig, options.port);
`;
const runtimeMjs = `import { createRequire } from 'node:module';
import { createJevLogs } from 'jevlogs';
import { startJevLogsServer } from 'jevlogs/server';
import manifest from 'jevlogs/package.json' with { type: 'json' };
const low = async () => ({ value: 0, priority: 'low', actionableProbability: 0.01 });
const fail = message => { throw new Error(message); };
if (manifest.version !== process.argv[2]) fail('jevlogs/package.json reports ' + manifest.version);
const jev = createJevLogs({ evaluator: low });
const quiet = await jev.triage({ body: 'GET /health returned 200 in 2ms', severityText: 'INFO' });
if (quiet.route !== 'retain') fail('expected retain, got ' + quiet.route);
const loud = await jev.triage({ body: 'Payment capture failed', severityText: 'ERROR' });
if (loud.route !== 'analyze' || loud.reason !== 'protected') fail('ERROR was not protected: ' + JSON.stringify(loud));
const routes = [];
const receiver = await startJevLogsServer({ port: 0, evaluator: low, onLog: event => { routes.push(event.decision.route); } });
try {
  const health = await fetch(receiver.url.replace('/v1/logs', '/health'));
  if (!health.ok) fail('GET /health returned ' + health.status);
  const body = { resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ scope: {}, logRecords: [{ body: { stringValue: 'GET /health returned 200' }, severityNumber: 9 }] }] }] };
  const response = await fetch(receiver.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status !== 200 || routes.join() !== 'retain') fail('receiver answered ' + response.status + ' with routes ' + routes.join());
} finally { await receiver.close(); }
if (process.features.require_module) {
  const required = createRequire(import.meta.url)('jevlogs');
  if (typeof required.createJevLogs !== 'function') fail('require("jevlogs") did not expose createJevLogs');
  console.log('require');
}
`;
const otelTs = `import { InMemoryLogRecordExporter, type LogRecordExporter } from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';
// Both directions: a real exporter goes in, and the wrapper is a real LogRecordExporter.
const wrapped: LogRecordExporter = new JevLogExporter({ exporter: new InMemoryLogRecordExporter() });
void wrapped;
`;
const otelMjs = `import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';
const memory = new InMemoryLogRecordExporter();
const jev = new JevLogExporter({ exporter: memory, evaluator: async () => ({ value: 90, priority: 'high', actionableProbability: 0.95 }) });
// sdk-logs 0.200 takes the exporter positionally and registers processors with addLogRecordProcessor.
// Later versions take { exporter } and a processors array in the constructor.
const legacy = typeof LoggerProvider.prototype.addLogRecordProcessor === 'function';
const processor = legacy ? new SimpleLogRecordProcessor(jev) : new SimpleLogRecordProcessor({ exporter: jev });
const provider = new LoggerProvider(legacy ? {} : { processors: [processor] });
if (legacy) provider.addLogRecordProcessor(processor);
provider.getLogger('smoke').emit({ body: 'Database connection pool at 94% capacity', severityNumber: 13, severityText: 'WARN' });
for (let waited = 0; memory.getFinishedLogRecords().length === 0 && waited < 3000; waited += 25) await new Promise(r => setTimeout(r, 25));
const [record] = memory.getFinishedLogRecords();
if (record?.attributes['jev.route'] !== 'analyze' || record.attributes['jev.value'] !== 90) throw new Error('missing jev.* attributes: ' + JSON.stringify(record?.attributes));
await provider.shutdown();
`;

try {
  let tarball = process.argv[2] && resolve(process.argv[2]);
  if (!tarball) {
    run('pnpm', ['pack', '--pack-destination', work], root);
    tarball = join(work, readdirSync(work).find(name => name.endsWith('.tgz')) ?? '');
  }
  if (!existsSync(tarball)) throw new Error(`Tarball not found: ${tarball}`);
  console.log(`Smoke testing ${tarball}\n  pnpm ${run('pnpm', ['--version'], work).trim()} · npm ${run('npm', ['--version'], work).trim()} · node ${process.versions.node}`);

  const plain = project('pnpm', { 'consumer.ts': consumerTs, 'runtime.mjs': runtimeMjs });
  await check('pnpm installs it with strict peers and auto-install-peers off', () => pnpmAdd(plain, [tarball, `typescript@${typescriptVersions[0]}`, nodeTypes]));
  await check('ESM imports, the receiver, jevlogs/package.json, and require() work', () => {
    const out = run('node', ['runtime.mjs', pkg.version], plain);
    if (process.features.require_module && !out.includes('require')) throw new Error('require() check did not run');
  });
  await check('declaration and source maps point at shipped sources', () => {
    const dist = join(plain, 'node_modules', 'jevlogs', 'dist');
    for (const map of readdirSync(dist).filter(name => name.endsWith('.map'))) {
      for (const source of JSON.parse(readFileSync(join(dist, map), 'utf8')).sources) {
        if (!existsSync(resolve(dist, source))) throw new Error(`${map} points at missing ${source}`);
      }
    }
  });
  await check(`jevlogs --version prints ${pkg.version}`, () => {
    const out = run('pnpm', ['exec', 'jevlogs', '--version'], plain).trim();
    if (out !== pkg.version) throw new Error(`printed ${out}`);
  });
  await check('offline demo, page demo, and --json run without a key or network', () => {
    if (!run('pnpm', ['exec', 'jevlogs'], plain, { all: true }).includes('OFFLINE DEMO')) throw new Error('demo banner missing');
    if (!run('pnpm', ['exec', 'jevlogs', '--page'], plain, { all: true }).includes('OFFLINE PAGE DEMO')) throw new Error('page demo banner missing');
    const lines = run('pnpm', ['exec', 'jevlogs', '--json'], plain).trim().split('\n').map(line => JSON.parse(line));
    if (lines.length !== 4 || !lines.every(line => line.route === 'retain' || line.route === 'analyze')) throw new Error('unexpected --json output');
  });
  await check('an unknown flag exits 1', () => run('pnpm', ['exec', 'jevlogs', '--definitely-not-a-flag'], plain, { status: 1 }));

  for (const [index, version] of typescriptVersions.entries()) {
    const dir = index === 0 ? plain : project(`ts-${version}`, { 'consumer.ts': consumerTs });
    if (index > 0) await check(`pnpm installs TypeScript ${version} alongside it`, () => pnpmAdd(dir, [tarball, `typescript@${version}`, nodeTypes]));
    for (const resolution of ['nodenext', 'bundler']) {
      await check(`TypeScript ${version} (${resolution}, skipLibCheck off) type-checks without OpenTelemetry installed`, () => tsc(dir, 'consumer.ts', resolution));
    }
  }

  for (const version of otelVersions) {
    const dir = project(`otel-${version}`, { 'otel.ts': otelTs, 'otel.mjs': otelMjs });
    await check(`@opentelemetry/sdk-logs ${version}: installs with strict peers`, () => pnpmAdd(dir, [tarball, `@opentelemetry/sdk-logs@${version}`, '@opentelemetry/api@1.9.0', `typescript@${typescriptVersions[0]}`, nodeTypes]));
    await check(`@opentelemetry/sdk-logs ${version}: JevLogExporter type-checks as a LogRecordExporter`, () => tsc(dir, 'otel.ts', 'nodenext'));
    await check(`@opentelemetry/sdk-logs ${version}: LoggerProvider emits annotated records and shuts down`, () => run('node', ['otel.mjs'], dir));
  }

  const npmDir = project('npm', {});
  await check('npm installs it with a clean dependency tree', () => {
    run('npm', ['install', tarball, '--no-audit', '--no-fund', '--loglevel=error'], npmDir);
    run('npm', ['ls', '--all'], npmDir);
  });
  await check('npx runs the installed binary', () => {
    const out = run('npx', ['jevlogs', '--version'], npmDir).trim();
    if (out !== pkg.version) throw new Error(`printed ${out}`);
  });
} catch (error) {
  failures++;
  console.error(`smoke: ${error instanceof Error ? error.message : error}`);
} finally {
  if (process.env.SMOKE_KEEP === '1') console.log(`Kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
if (failures) { console.error(`\n${failures} smoke check(s) failed.`); process.exitCode = 1; }
else console.log('\nAll smoke checks passed.');
