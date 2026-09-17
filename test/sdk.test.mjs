import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevLogs, createJevPager, JevLogExporter, JevPagerExporter, estimateSavings, redactCommonSecrets, shouldPage } from '../dist/index.js';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
const low = async () => ({ value: 0, priority: 'low', actionableProbability: 0.02 });
const makeRecord = (body = 'health ok', attributes = {}) => ({body, attributes, severityNumber: 9, hrTime:[1,0], hrTimeObserved:[1,0], resource:{attributes:{}}, instrumentationScope:{name:'test'}, droppedAttributesCount:0, spanContext:{traceId:'a'.repeat(32),spanId:'b'.repeat(16),traceFlags:1}});
const target = () => ({ batches:[], stopped:false, export(records, cb) { this.batches.push(records); cb({code:0}); }, async forceFlush(){}, async shutdown(){this.stopped=true;} });
const send = (e,r) => new Promise(resolve => e.export(r,resolve));
test('confident noise bypasses analysis; ambiguity and useful diagnostics remain', async () => {
 assert.equal((await createJevLogs({evaluator:low}).triage({body:'ok'})).route,'retain');
 for (const result of [{value:0,priority:'low',actionableProbability:.5},{value:75,priority:'low',actionableProbability:.01},{value:0,priority:'high',actionableProbability:.01}]) {
  assert.equal((await createJevLogs({evaluator:async()=>result}).triage({body:'x'})).route,'analyze');
 }
});
test('protected logs and ERROR/FATAL never call provider', async () => {
 let calls=0; const triage=createJevLogs({evaluator:async()=>{calls++;return low();}}).triage;
 for(const log of [{body:'x',severityNumber:17},{body:'x',severityText:'FATAL'},{body:'x',protected:true}]) assert.equal((await triage(log)).reason,'protected');
 assert.equal(calls,0);
});
test('timeouts, redactor errors, malformed answers and oversized inputs fail open', async () => {
 const bad = [async()=>{throw Error('API')},async()=>({value:NaN,priority:'low',actionableProbability:0}),async()=>({value:0,priority:'low',actionableProbability:2}),async()=>new Promise(()=>{})];
 for(const evaluator of bad) assert.equal((await createJevLogs({evaluator,timeoutMs:5}).triage({body:'x'})).reason,'unavailable');
 assert.equal((await createJevLogs({redact(){throw Error('redaction')}}).triage({body:'x'})).route,'analyze');
 assert.equal((await createJevLogs({maxInputChars:2,evaluator:low}).triage({body:'long'})).route,'analyze');
});
test('redaction runs before provider; attributes do not enter state', async()=>{
 let state; await createJevLogs({evaluator:async s=>{state=s;return low();}}).triage({body:'password=hunter2 user@example.com Bearer abc123'});
 assert.ok(!state.includes('hunter2'));assert.ok(!state.includes('user@example.com'));assert.ok(!state.includes('abc123'));
 assert.equal(redactCommonSecrets('api_key=secret'), 'api_key=[REDACTED]');
});
test('OTel annotate preserves context, order, resources and originals', async()=>{
 const downstream=target(); const exporter=new JevLogExporter({exporter:downstream,evaluator:low});
 const records=[makeRecord(),makeRecord('failure',{'jev.protected':true})];
 assert.equal((await send(exporter,records)).code,0);
 assert.equal(downstream.batches[0].length,2);
 assert.equal(downstream.batches[0][0].attributes['jev.route'],'retain');
 assert.equal(downstream.batches[0][0].spanContext,records[0].spanContext);
 assert.equal(downstream.batches[0][0].resource,records[0].resource);
 assert.deepEqual(records[0].attributes,{});
 await exporter.shutdown(); assert.equal(downstream.stopped,true);
 assert.equal((await send(exporter,records)).code,1);
});
test('analysis branch filters only eligible records and handles all-filtered batches',async()=>{
 const downstream=target();const exporter=new JevLogExporter({exporter:downstream,evaluator:low,mode:'analysis-only'});
 await send(exporter,[makeRecord(),makeRecord('audit',{'jev.protected':true})]);
 assert.equal(downstream.batches[0].length,1);assert.equal(downstream.batches[0][0].body,'audit');
 assert.equal((await send(exporter,[makeRecord()])).code,0);assert.equal(downstream.batches.length,1);
});
test('real LoggerProvider/BatchLogRecordProcessor emits enriched records',async()=>{
 const downstream=target(); const provider=new LoggerProvider({processors:[new BatchLogRecordProcessor({exporter:new JevLogExporter({exporter:downstream,evaluator:low})})]});
 provider.getLogger('integration').emit({body:'test',severityNumber:9,attributes:{original:'yes'}});
 await provider.shutdown();
 assert.equal(downstream.batches[0][0].attributes['jev.value'],0);
 assert.equal(downstream.batches[0][0].attributes.original,'yes');
 assert.equal(downstream.batches[0][0].body,'test');
 assert.equal(downstream.batches[0][0].severityNumber,9);
 assert.equal(downstream.batches[0][0].hrTime.length,2);
 assert.equal(downstream.batches[0][0].hrTimeObserved.length,2);
 assert.equal(downstream.batches[0][0].instrumentationScope.name,'integration');
});
test('concurrency bounded, shutdown drains and exporter failures propagate',async()=>{
 let active=0,max=0;const downstream=target();const exporter=new JevLogExporter({exporter:downstream,concurrency:2,evaluator:async()=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,3));active--;return low();}});
 const pending=send(exporter,Array.from({length:7},(_,i)=>makeRecord(`record ${i}`)));await exporter.shutdown();await pending;assert.equal(max,2);assert.equal(downstream.batches[0].length,7);
 const failed=new JevLogExporter({exporter:{...target(),export(){throw Error('delivery')}},evaluator:low});assert.equal((await send(failed,[makeRecord()])).code,1);
});
test('pager thresholds probability in code; ERROR is not auto-paged', async () => {
  const pager = createJevPager({ evaluator: async () => ({ probability: 0.91 }), cache: false });
  const lag = await pager.decide({ body: 'replica lag 47m still taking writes', severityText: 'INFO' });
  assert.equal(lag.page, true); assert.equal(lag.probability, 0.91); assert.equal(lag.reason, 'model');
  const coupon = createJevPager({ evaluator: async () => ({ probability: 0.06 }), cache: false });
  const noise = await coupon.decide({ body: 'INVALID_COUPON', severityText: 'ERROR' });
  assert.equal(noise.page, false);
  const tight = createJevPager({ pageAbove: 0.95, evaluator: async () => ({ probability: 0.91 }), cache: false });
  assert.equal((await tight.decide({ body: 'lag' })).page, false);
  assert.equal(shouldPage(0.5, 0.5), true);
  assert.equal(shouldPage(0.49, 0.5), false);
  assert.throws(() => createJevPager({ pageAbove: 1.2 }));
});
test('pager does not protect ERROR; unavailable does not page by default', async () => {
  let calls = 0;
  const pager = createJevPager({ evaluator: async () => { calls++; throw Error('down'); }, cache: false });
  const miss = await pager.decide({ body: 'disk full', severityText: 'ERROR' });
  assert.equal(miss.page, false); assert.equal(miss.reason, 'unavailable'); assert.equal(calls, 1);
  const open = createJevPager({ pageWhenUnavailable: true, evaluator: async () => { throw Error('down'); }, cache: false });
  assert.equal((await open.decide({ body: 'x' })).page, true);
});
test('pager rules and cache work without a discrete urgency label', async () => {
  let calls = 0;
  const pager = createJevPager({
    evaluator: async () => { calls++; return { probability: 0.9 }; },
    rules: [{ name: 'health', match: '^GET /health', route: 'hold' }, { match: 'pagerduty-test-page', route: 'page' }],
  });
  assert.equal((await pager.decide({ body: 'GET /health 200' })).page, false);
  assert.equal((await pager.decide({ body: 'pagerduty-test-page now' })).page, true);
  assert.equal(calls, 0);
  const cached = createJevPager({ evaluator: async () => { calls++; return { probability: 0.8 }; } });
  const a = await cached.decide({ body: 'payments processor timeout' });
  const b = await cached.decide({ body: 'payments processor timeout' });
  assert.equal(a.page, true); assert.equal(b.cached, true); assert.equal(calls, 1);
  assert.throws(() => createJevPager({ rules: [{ match: 'x', route: 'retain' }] }), RangeError);
});
test('pager exporter annotates jev.page and can drop holds', async () => {
  const downstream = target();
  const exporter = new JevPagerExporter({ exporter: downstream, evaluator: async () => ({ probability: 0.06 }), mode: 'pages-only' });
  assert.equal((await send(exporter, [makeRecord('INVALID_COUPON')])).code, 0);
  assert.equal(downstream.batches.length, 0);
  const all = target();
  const annotate = new JevPagerExporter({ exporter: all, evaluator: async () => ({ probability: 0.91 }) });
  await send(annotate, [makeRecord('replica lag 47m')]);
  assert.equal(all.batches[0][0].attributes['jev.page'], true);
  assert.equal(all.batches[0][0].attributes['jev.page_probability'], 0.91);
  await annotate.shutdown();
});
test('savings includes triage overhead, output, negative savings, and validation',()=>{
 const args={logs:1e6,tokensPerLog:300,llmInputPerMillion:2,llmOutputPerMillion:12,outputTokensPerLog:50,retainedFraction:.1};
 const s=estimateSavings(args);assert.equal(s.baseline,1200);assert.equal(s.triage,29.4);assert.equal(s.withJev,149.4);assert.equal(s.savings,1050.6);
 assert.ok(estimateSavings({...args,retainedFraction:1}).savings<0);
 assert.equal(estimateSavings({...args,logs:0}).percent,0);
 assert.throws(()=>estimateSavings({...args,retainedFraction:2}));
 assert.throws(()=>createJevLogs({retainBelow:.6}));
});
test('identical redacted inputs are served from the cache; TTL and disabling are honored',async()=>{
 let calls=0;const evaluator=async()=>{calls++;return low();};
 const jev=createJevLogs({evaluator});
 const first=await jev.triage({body:'GET /health 200 user@example.com'});
 const second=await jev.triage({body:'GET /health 200 other@example.com'}); // same after redaction
 assert.equal(calls,1);assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(second.route,'retain');
 assert.equal(jev.stats().cached,1);assert.equal(jev.stats().model,1);assert.equal(jev.stats().cacheEntries,1);
 const expiring=createJevLogs({evaluator,cache:{ttlMs:5}});await expiring.triage({body:'x'});await new Promise(r=>setTimeout(r,10));await expiring.triage({body:'x'});
 assert.equal(calls,3);
 const off=createJevLogs({evaluator,cache:false});await off.triage({body:'y'});await off.triage({body:'y'});assert.equal(calls,5);
 const tiny=createJevLogs({evaluator,cache:{maxEntries:1}});await tiny.triage({body:'a'});await tiny.triage({body:'b'});await tiny.triage({body:'a'});assert.equal(calls,8);
 assert.throws(()=>createJevLogs({cache:{maxEntries:-1}}));
});
test('failures are never cached; protected records skip the cache',async()=>{
 let calls=0;const jev=createJevLogs({evaluator:async()=>{calls++;throw Error('down');}});
 assert.equal((await jev.triage({body:'x'})).reason,'unavailable');assert.equal((await jev.triage({body:'x'})).cached,false);assert.equal(calls,2);
 assert.equal((await jev.triage({body:'x',severityText:'ERROR'})).cached,false);assert.equal(jev.stats().protected,1);assert.equal(jev.stats().unavailable,2);
});
test('rules decide before the model, never override protection, and are validated',async()=>{
 let calls=0;const evaluator=async()=>{calls++;return {value:100,priority:'critical',actionableProbability:0.99};};
 const jev=createJevLogs({evaluator,rules:[{name:'health',match:'^GET /health',route:'retain'},{match:'audit',flags:'i',route:'analyze'}]});
 const noise=await jev.triage({body:'GET /health 200'});assert.deepEqual(noise,{value:0,priority:'low',route:'retain',actionableProbability:null,reason:'rule',rule:'health',cached:false});
 const audit=await jev.triage({body:'AUDIT role changed'});assert.equal(audit.route,'analyze');assert.equal(audit.reason,'rule');assert.equal(audit.rule,'rule-2');
 assert.equal(calls,0);
 assert.equal((await jev.triage({body:'GET /health 500',severityText:'ERROR'})).reason,'protected');
 assert.equal((await jev.triage({body:'checkout timeout'})).reason,'model');assert.equal(calls,1);
 assert.equal(jev.stats().rules,2);
 for(const rules of [[{match:'(',route:'retain'}],[{match:'x',route:'drop'}],[{match:'x',flags:'g',route:'retain'}],[{match:'',route:'retain'}],'nope'])assert.throws(()=>createJevLogs({rules}),RangeError);
 const re=createJevLogs({evaluator,rules:[{match:/cache hit/gi,route:'retain'}]});
 assert.equal((await re.triage({body:'Cache HIT product'})).route,'retain');assert.equal((await re.triage({body:'Cache HIT product'})).route,'retain');
});
test('exporter coalesces identical in-flight records and annotates cache and rule attributes',async()=>{
 let calls=0;const counted=async()=>{calls++;await new Promise(r=>setTimeout(r,3));return low();};
 const downstream=target();const exporter=new JevLogExporter({exporter:downstream,evaluator:counted,rules:[{name:'noise',match:'ping',route:'retain'}]});
 await send(exporter,[makeRecord('health ok'),makeRecord('health ok'),makeRecord('ping')]);
 const [a,b,c]=downstream.batches[0];
 assert.equal('jev.cached' in a.attributes,false);assert.equal(b.attributes['jev.cached'],true);assert.equal(c.attributes['jev.rule'],'noise');assert.equal(c.attributes['jev.reason'],'rule');
 assert.equal(exporter.stats().cached,1);assert.equal(calls,1);
 const failing=createJevLogs({evaluator:async()=>{await new Promise(r=>setTimeout(r,3));throw Error('down');}});
 const [x,y]=await Promise.all([failing.triage({body:'same'}),failing.triage({body:'same'})]);assert.equal(x.reason,'unavailable');assert.equal(y.reason,'unavailable');
});
