import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevLogs, JevLogExporter, estimateSavings, redactCommonSecrets } from '../dist/index.js';
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
 const pending=send(exporter,Array.from({length:7},()=>makeRecord()));await exporter.shutdown();await pending;assert.equal(max,2);assert.equal(downstream.batches[0].length,7);
 const failed=new JevLogExporter({exporter:{...target(),export(){throw Error('delivery')}},evaluator:low});assert.equal((await send(failed,[makeRecord()])).code,1);
});
test('savings includes triage overhead, output, negative savings, and validation',()=>{
 const args={logs:1e6,tokensPerLog:300,llmInputPerMillion:2,llmOutputPerMillion:12,outputTokensPerLog:50,retainedFraction:.1};
 const s=estimateSavings(args);assert.equal(s.baseline,1200);assert.equal(s.triage,29.4);assert.equal(s.withJev,149.4);assert.equal(s.savings,1050.6);
 assert.ok(estimateSavings({...args,retainedFraction:1}).savings<0);
 assert.equal(estimateSavings({...args,logs:0}).percent,0);
 assert.throws(()=>estimateSavings({...args,retainedFraction:2}));
 assert.throws(()=>createJevLogs({retainBelow:.6}));
});
