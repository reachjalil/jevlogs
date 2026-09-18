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
  assert.equal((await post('{')).status,400);assert.equal((await post(payload,'application/x-protobuf')).status,400);
  r=await post(payload,'application/grpc');assert.equal(r.status,501);assert.match(await r.text(),/gRPC is not supported/);assert.equal(r.headers.get('grpc-status'),'12');
  assert.equal((await post(payload,'text/plain')).status,415);
  assert.equal((await post({resourceLogs:'bad'})).status,400);
  assert.equal((await post({...payload,resourceLogs:[{scopeLogs:[{logRecords:Array(101).fill({})}]}]})).status,400);
 }finally{await receiver.close();}
});
test('receiver bounds concurrent requests and rejects oversized payloads',async()=>{
 let release;let entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);
 const receiver=await startJevLogsServer({port:0,maxRequests:1,evaluator:async()=>{entered();await gate;return evaluator();},onLog:()=>{}});
 const post=body=>fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body});
 try{
  const first=post(JSON.stringify(payload));await started;
  const busy=await post(JSON.stringify(payload));assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'1');
  release();assert.equal((await first).status,200);
  const large=await post(JSON.stringify({padding:'x'.repeat(1024*1024)}));assert.equal(large.status,413);
 }finally{release();await receiver.close();}
});
import { createServer } from 'node:http';
const upstream=async(handler)=>{const received=[];const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received.push({headers:req.headers,body:JSON.parse(body)});const r=handler?handler(received.length):undefined;res.writeHead(r?.status??200,{'content-type':'application/json'});res.end(JSON.stringify(r?.body??{}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {received,url:`http://127.0.0.1:${server.address().port}/v1/logs`,close:()=>new Promise(r=>server.close(r))};};
const twoRecords={resourceLogs:[{resource:{attributes:[]},scopeLogs:[{scope:{name:'t'},logRecords:[{body:{stringValue:'health'},severityNumber:9,attributes:[{key:'k',value:{stringValue:'v'}}]},{body:{stringValue:'boom'},severityNumber:17}]}]}]};
test('forwards annotated OTLP JSON to the upstream with headers, then runs onLog',async()=>{
 const collector=await upstream();const order=[];
 const receiver=await startJevLogsServer({port:0,evaluator,forwardUrl:collector.url,forwardHeaders:{authorization:'Bearer test'},onLog:e=>order.push(e.decision.route)});
 try{
  const r=await fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(twoRecords)});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{});
  assert.equal(collector.received.length,1);assert.equal(collector.received[0].headers.authorization,'Bearer test');
  const records=collector.received[0].body.resourceLogs[0].scopeLogs[0].logRecords;assert.equal(records.length,2);
  const attrs=Object.fromEntries(records[0].attributes.map(a=>[a.key,Object.values(a.value)[0]]));
  assert.equal(attrs.k,'v');assert.equal(attrs['jev.route'],'retain');assert.equal(attrs['jev.value'],0);assert.equal(attrs['jev.actionable_probability'],0.01);
  assert.equal(Object.fromEntries(records[1].attributes.map(a=>[a.key,Object.values(a.value)[0]]))['jev.reason'],'protected');
  assert.equal(records[1].body.stringValue,'boom');
  assert.deepEqual(order,['retain','analyze']);
  const stats=await (await fetch(receiver.url.replace('/v1/logs','/stats'))).json();
  assert.equal(stats.forwarded,2);assert.equal(stats.records,2);assert.equal(stats.triage.protected,1);assert.equal(stats.triage.model,1);assert.ok(stats.version);
  assert.equal((await (await fetch(receiver.url.replace('/v1/logs','/health'))).json()).forwarding,true);
 }finally{await receiver.close();await collector.close();}
});
test('analysis-only forwarding drops retained records and skips empty upstream calls; onLog is optional',async()=>{
 const collector=await upstream();
 const receiver=await startJevLogsServer({port:0,evaluator,forwardUrl:collector.url,forwardMode:'analysis-only',forwardHeaders:{}});
 try{
  let r=await fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(twoRecords)});assert.equal(r.status,200);
  assert.equal(collector.received[0].body.resourceLogs[0].scopeLogs[0].logRecords.length,1);
  r=await fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,200);
  assert.equal(collector.received.length,1);
 }finally{await receiver.close();await collector.close();}
});
test('upstream failure returns retryable 503 without invoking onLog; upstream partial success is relayed',async()=>{
 const collector=await upstream(n=>n===1?{status:500}:{status:200,body:{partialSuccess:{rejectedLogRecords:'1',errorMessage:'upstream'}}});
 let logged=0;const receiver=await startJevLogsServer({port:0,evaluator,forwardUrl:collector.url,forwardHeaders:{},onLog:()=>{logged++;}});
 try{
  const post=()=>fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  let r=await post();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'1');assert.equal(logged,0);
  r=await post();assert.equal(r.status,200);assert.equal((await r.json()).partialSuccess.rejectedLogRecords,'1');assert.equal(logged,1);
  assert.equal(receiver.stats().forwardFailures,1);assert.equal(receiver.stats().forwarded,1);
 }finally{await receiver.close();await collector.close();}
});
test('parallel requests share bounded evaluation slots; maxRequests still yields 503',async()=>{
 let active=0,max=0;const slow=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,15));active--;return evaluator();};
 const receiver=await startJevLogsServer({port:0,evaluator:slow,concurrency:2,maxRequests:2,onLog:()=>{}});
 let n=0;const post=()=>fetch(receiver.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resourceLogs:[{scopeLogs:[{logRecords:[{body:{stringValue:`a${n++}`}},{body:{stringValue:`b${n++}`}}]}]}]})});
 try{
  const results=await Promise.all([post(),post(),post()]);
  const statuses=results.map(r=>r.status).sort();assert.deepEqual(statuses,[200,200,503]);assert.equal(max,2);
  assert.equal(receiver.stats().busy,1);
 }finally{await receiver.close();}
 await assert.rejects(startJevLogsServer({port:0,evaluator}),/onLog, forwardUrl/);
 await assert.rejects(startJevLogsServer({port:0,evaluator,forwardUrl:'ftp://x'}),/http/);
});
test('OTLP header syntax parsing',async()=>{
 const {parseOtlpHeaders}=await import('../dist/server.js');
 assert.deepEqual(parseOtlpHeaders('authorization=Bearer%20abc, x-team=logs'),{authorization:'Bearer abc','x-team':'logs'});
 assert.deepEqual(parseOtlpHeaders(undefined),{});assert.throws(()=>parseOtlpHeaders('novalue'));assert.throws(()=>parseOtlpHeaders('bad key=1'));
});
import { gzipSync } from 'node:zlib';
import { decodeOtlpLogsRequest, decodeOtlpLogsResponse } from '../dist/otlp-proto.js';
const varint=n=>{const o=[];n=Number(n);while(n>0x7f){o.push((n&0x7f)|0x80);n>>>=7;}o.push(n);return Buffer.from(o);};
const tag=(f,w)=>varint((f<<3)|w);
const str=(f,s)=>{const b=Buffer.from(s);return Buffer.concat([tag(f,2),varint(b.length),b]);};
const msg=(f,b)=>Buffer.concat([tag(f,2),varint(b.length),b]);
const protoLog=({body,severityNumber=9,traceId,spanId,intValue,attributes=[]})=>{
 const rec=[tag(2,0),varint(severityNumber)];
 if(body!==undefined) rec.push(msg(5,str(1,body)));
 if(intValue!==undefined){let n=BigInt(intValue);if(n<0n)n+=0x10000000000000000n;const v=[];while(n>0x7fn){v.push(Number(n&0x7fn)|0x80);n>>=7n;}v.push(Number(n));rec.push(msg(5,Buffer.concat([tag(3,0),Buffer.from(v)])));}
 for(const [k,v] of attributes) rec.push(msg(6,Buffer.concat([str(1,k),msg(2,str(1,v))])));
 if(traceId) rec.push(tag(9,2),varint(16),Buffer.from(traceId,'hex'));
 if(spanId) rec.push(tag(10,2),varint(8),Buffer.from(spanId,'hex'));
 return msg(1,msg(2,msg(2,Buffer.concat(rec))));
};
test('protobuf HTTP logs decode to the JSON mapping and gzip is accepted',async()=>{
 const events=[];const receiver=await startJevLogsServer({port:0,evaluator,onLog:e=>{events.push(e);if(events.length>3)throw Error('sink');}});
 const post=(body,headers)=>fetch(receiver.url,{method:'POST',headers,body});
 try{
  const traceId='ab'.repeat(16);const spanId='cd'.repeat(8);
  const bin=protoLog({body:'health',severityNumber:9,traceId,spanId,attributes:[['service.ok','yes']]});
  let r=await post(bin,{'content-type':'application/x-protobuf'});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/x-protobuf');
  assert.equal(Buffer.byteLength(await r.arrayBuffer()),0);
  assert.equal(events[0].logRecord.body.stringValue,'health');
  assert.equal(events[0].logRecord.traceId,traceId);assert.equal(events[0].logRecord.spanId,spanId);
  assert.equal(events[0].decision.route,'retain');
  r=await post(gzipSync(bin),{'content-type':'application/x-protobuf','content-encoding':'gzip'});
  assert.equal(r.status,200);assert.equal(events.length,2);
  r=await post(gzipSync(Buffer.from(JSON.stringify(payload))),{'content-type':'application/json','content-encoding':'gzip'});
  assert.equal(r.status,200);assert.equal(events[2].logRecord.traceId,'a'.repeat(32));
  r=await post(bin,{'content-type':'application/x-protobuf'});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/x-protobuf');
  assert.deepEqual(decodeOtlpLogsResponse(Buffer.from(await r.arrayBuffer())),{partialSuccess:{rejectedLogRecords:'1',errorMessage:'Sink rejected records; partial failures are not retried by OTLP clients'}});
  r=await post(bin,{'content-type':'application/x-protobuf','content-encoding':'br'});assert.equal(r.status,415);
  const grpc=await fetch(receiver.url.replace('/v1/logs','/opentelemetry.proto.collector.logs.v1.LogsService/Export'),{method:'POST',headers:{'content-type':'application/grpc'},body:bin});
  assert.equal(grpc.status,501);assert.match(await grpc.text(),/gRPC is not supported/);
 }finally{await receiver.close();}
});
test('protobuf inbound still forwards annotated JSON upstream',async()=>{
 const collector=await upstream();
 const receiver=await startJevLogsServer({port:0,evaluator,forwardUrl:collector.url,forwardHeaders:{}});
 try{
  const r=await fetch(receiver.url,{method:'POST',headers:{'content-type':'application/x-protobuf'},body:protoLog({body:'health',severityNumber:9})});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/x-protobuf');
  assert.equal(collector.received[0].body.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,'health');
  assert.equal(collector.received[0].headers['content-type'],'application/json');
 }finally{await receiver.close();await collector.close();}
});
test('protobuf AnyValue mapping covers int, nested, and unknown fields',async()=>{
 const decoded=decodeOtlpLogsRequest(protoLog({intValue:-2n}));
 assert.equal(decoded.resourceLogs[0].scopeLogs[0].logRecords[0].body.intValue,'-2');
 const inner=msg(5,msg(5,msg(1,str(1,'x'))));
 const unknown=Buffer.concat([tag(99,0),varint(7),msg(1,msg(2,msg(2,inner)))]);
 const nested=decodeOtlpLogsRequest(unknown);
 assert.equal(nested.resourceLogs[0].scopeLogs[0].logRecords[0].body.arrayValue.values[0].stringValue,'x');
});
