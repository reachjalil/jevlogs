import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startJevLogsServer } from '../dist/server.js';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
const evaluator = async () => ({value:0,priority:'low',actionableProbability:0.01});
const payload = {resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:'demo'}}]},scopeLogs:[{scope:{name:'test'},logRecords:[{body:{stringValue:'health'},severityNumber:9,traceId:'a'.repeat(32)}]}]}]};
test('standard HTTP JSON exporter interoperates and preserves the original record',async()=>{
 const events=[];const receiver=await startJevLogsServer({port:0,evaluator,onLog:e=>events.push(e)});
 try {
  const provider=new LoggerProvider({processors:[new BatchLogRecordProcessor({exporter:new OTLPLogExporter({url:receiver.url}),maxExportBatchSize:16})]});
  provider.getLogger('app').emit({body:'real OTel record',severityNumber:9});await provider.shutdown();
  assert.equal(events.length,1);assert.equal(events[0].logRecord.body.stringValue,'real OTel record');assert.equal(events[0].decision.route,'retain');
 } finally {await receiver.close();}
});
test('receiver handles OTLP responses, validation and callback failures',async()=>{
 const events=[];const receiver=await startJevLogsServer({port:0,evaluator,onLog:e=>{events.push(e);if(events.length>1)throw Error('sink');}});
 const post=(body,contentType='application/json')=>fetch(receiver.url,{method:'POST',headers:{'content-type':contentType},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  let r=await post(payload);assert.equal(r.status,200);assert.deepEqual(await r.json(),{});assert.equal(events[0].logRecord.traceId,'a'.repeat(32));
  r=await post(payload);assert.equal((await r.json()).partialSuccess.rejectedLogRecords,'1');
  assert.equal((await post('{')).status,400);assert.equal((await post(payload,'application/x-protobuf')).status,415);
  assert.equal((await post({resourceLogs:'bad'})).status,400);
  assert.equal((await post({...payload,resourceLogs:[{scopeLogs:[{logRecords:Array(101).fill({})}]}]})).status,400);
 }finally{await receiver.close();}
});
test('receiver bounds concurrent requests and rejects oversized payloads',async()=>{
 let release;let entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);
 const receiver=await startJevLogsServer({port:0,evaluator:async()=>{entered();await gate;return evaluator();},onLog:()=>{}});
 const post=body=>fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body});
 try{
  const first=post(JSON.stringify(payload));await started;
  const busy=await post(JSON.stringify(payload));assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'1');
  release();assert.equal((await first).status,200);
  const large=await post(JSON.stringify({padding:'x'.repeat(1024*1024)}));assert.equal(large.status,413);
 }finally{release();await receiver.close();}
});
