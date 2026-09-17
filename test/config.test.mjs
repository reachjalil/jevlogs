import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { loadJevConfig } from '../dist/config.js';
test('root config loads relative envFile and starts CLI receiver',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jevlogs-'));let child;
 try{
  await writeFile(join(dir,'.env'),'AI_GATEWAY_API_KEY=synthetic-test-key\n');
  await writeFile(join(dir,'jevlogs.config.json'),JSON.stringify({envFile:'.env',port:0,retainBelow:0.1}));
  const env={...process.env};delete env.AI_GATEWAY_API_KEY;
  child=spawn(process.execPath,[resolve('dist/cli.js'),'--live'],{cwd:dir,env});
  const endpoint=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('startup timeout')),5000);let output='';
   child.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/v1\/logs/);if(match){clearTimeout(timer);resolve(match[0]);}});
   child.once('exit',code=>{clearTimeout(timer);reject(Error(`early exit ${code}: ${output}`));});
  });
  const rows=[];child.stdout.on('data',chunk=>rows.push(chunk.toString()));
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resourceLogs:[{scopeLogs:[{logRecords:[{body:{stringValue:'never sent to model'},severityNumber:17}]}]}]})});
  assert.equal(r.status,200);await new Promise(r=>setTimeout(r,20));assert.match(rows.join(''),/protected/);assert.doesNotMatch(rows.join(''),/synthetic-test-key|never sent/);
 }finally{if(child){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
test('config rejects unknown and incorrectly typed settings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jev-config-'));const path=join(dir,'config.json');
 try{for(const value of [{apiKey:'secret'},{port:'4318'},[],{envFile:42}]){await writeFile(path,JSON.stringify(value));await assert.rejects(loadJevConfig(path));}}finally{await rm(dir,{recursive:true,force:true});}
});
