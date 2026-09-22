import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (args=[], input) => spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8',input,env:{...process.env,AI_GATEWAY_API_KEY:''}});
test('default npx experience is labeled offline and routes demo samples',()=>{
 const r=run(); assert.equal(r.status,0);assert.match(r.stderr,/OFFLINE DEMO/);assert.match(r.stderr,/2 selected/);assert.match(r.stdout,/Payment capture failed/);
});
test('JSON mode emits parseable decisions only, without raw log bodies',()=>{
 const r=run(['--demo','--json']);assert.equal(r.status,0);const rows=r.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,4);assert.equal(rows[0].mode,'demo');assert.equal(rows[0].route,'retain');assert.equal(rows[2].reason,'protected');assert.ok(rows.every(r=>!('body' in r)));
});
test('live mode requires credentials and never silently runs fixtures',()=>{
 const r=run(['--live','--json']);assert.equal(r.status,1);assert.match(r.stderr,/AI_GATEWAY_API_KEY/);assert.equal(r.stdout,'');
});
test('CLI rejects invalid modes, limits, options and implicit custom-data upload',()=>{
 for(const args of [['--limit','0'],['--limit','101'],['--limit','x'],['--limit'],['--file'],['--demo','--live'],['--stdin'],['--wat']]) assert.equal(run(args).status,1,args.join(' '));
});
test('help/version/limit work without credentials',()=>{
 assert.match(run(['--help']).stdout,/npx jevlogs/);assert.equal(run(['--json','--limit','1']).stdout.trim().split('\n').length,1);
});
test('offline page demo thresholds sample probabilities',()=>{
 const r=run(['--page','--json']);assert.equal(r.status,0);assert.match(r.stderr,/OFFLINE PAGE DEMO/);
 const rows=r.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,4);
 assert.equal(rows[0].page,false);assert.equal(rows[2].page,true);assert.equal(rows[2].reason,'model');assert.equal(rows[3].page,true);
 assert.ok(rows.every(row=>!('body' in row)));assert.match(r.stderr,/2 would page/);
});
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
test('version comes from package.json',()=>{assert.equal(run(['--version']).stdout.trim(),JSON.parse(readFileSync('package.json','utf8')).version);});
test('--follow requires --stdin and --live; --limit is rejected outside range',()=>{
 assert.equal(run(['--follow']).status,1);assert.equal(run(['--stdin','--follow']).status,1);
 assert.equal(run(['--page-above','0.2']).status,1);assert.equal(run(['--page-above','2','--page']).status,1);
});
test('follow mode evaluates lines as they arrive and only ends at EOF',async()=>{
 // A synthetic key satisfies the credential gate; a rule handles every line so no network call is made.
 const dir=await import('node:fs/promises').then(async fs=>{const d=await fs.mkdtemp((await import('node:os')).tmpdir()+'/jev-follow-');await fs.writeFile(d+'/jevlogs.config.json',JSON.stringify({rules:[{name:'all',match:'.',flags:'s',route:'retain'}]}));return d;});
 const child=spawn(process.execPath,[process.cwd()+'/dist/cli.js','--live','--stdin','--follow','--json'],{cwd:dir,env:{...process.env,AI_GATEWAY_API_KEY:'synthetic'}});
 let out='';child.stdout.on('data',c=>out+=c);let err='';child.stderr.on('data',c=>err+=c);
 const waitFor=(n)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('timeout: '+out+err)),5000);const check=()=>{if(out.trim().split('\n').filter(Boolean).length>=n){clearTimeout(t);resolve();}else setTimeout(check,10);};check();});
 child.stdin.write('GET /health 200\n');await waitFor(1);
 assert.equal(child.exitCode,null);
 child.stdin.write('{"message":"ping","level":"debug"}\n\n'+'x'.repeat(9000)+'\n');await waitFor(2);
 child.stdin.end();const code=await new Promise(r=>child.once('exit',r));
 const rows=out.trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.reason==='rule'&&r.rule==='all'&&r.mode==='live'));
 assert.match(err,/skipped line 3/);assert.match(err,/2 decided by rules/);assert.equal(code,0);
});
test('pino levels protect analysis and page only fatal locally',async()=>{
 const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jev-pino-'));
 await fs.writeFile(path.join(dir,'jevlogs.config.json'),JSON.stringify({rules:[{name:'all',match:'.',flags:'s',route:'retain'}]}));
 await fs.writeFile(path.join(dir,'app.log'),'{"level":50,"msg":"expected 404"}\n{"level":30,"msg":"GET /health"}\n{"level":60,"msg":"process abort"}\n');
 const env={...process.env,AI_GATEWAY_API_KEY:'synthetic'};
 const analysis=spawnSync(process.execPath,[process.cwd()+'/dist/cli.js','--live','--file','app.log','--json'],{cwd:dir,encoding:'utf8',env});
 assert.equal(analysis.status,0,analysis.stderr);
 const rows=analysis.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(rows[0].reason,'protected');assert.equal(rows[1].reason,'rule');assert.equal(rows[2].reason,'protected');
 assert.equal(analysis.stdout.includes('expected 404'),false);
 const paging=spawnSync(process.execPath,[process.cwd()+'/dist/cli.js','--live','--page','--file','app.log','--json'],{cwd:dir,encoding:'utf8',env});
 assert.equal(paging.status,0,paging.stderr);
 const pages=paging.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(pages[0].reason,'rule');assert.equal(pages[0].page,false);
 assert.equal(pages[1].page,false);
 assert.equal(pages[2].reason,'protected');assert.equal(pages[2].page,true);
 await fs.rm(dir,{recursive:true,force:true});
});
test('labels report recall and precision for a file',async()=>{
 const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jev-labels-'));
 await fs.writeFile(path.join(dir,'jevlogs.config.json'),JSON.stringify({rules:[{name:'all',match:'.',flags:'s',route:'retain'}],maxModelCalls:0}));
 await fs.writeFile(path.join(dir,'app.log'),[
  '{"msg":"GET /health","important":false}',
  '{"msg":"disk full","level":50,"important":true}',
  '{"msg":"expected 404","level":50,"label":"noise"}',
  '{"msg":"silent replica lag","important":true}',
 ].join('\n'));
 const scored=spawnSync(process.execPath,[process.cwd()+'/dist/cli.js','--live','--file','app.log','--json','--labels'],{cwd:dir,encoding:'utf8',env:{...process.env,AI_GATEWAY_API_KEY:'synthetic'}});
 assert.equal(scored.status,2,scored.stderr);
 assert.match(scored.stderr,/recall 50%/);
 assert.match(scored.stderr,/precision 50%/);
 assert.match(scored.stderr,/line 4/);
 const rows=scored.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(rows[1].important,true);assert.equal(rows[1].reason,'protected');assert.equal(rows[3].route,'retain');
 assert.equal(scored.stdout.includes('disk full'),false);
 assert.equal(run(['--labels','--json']).status,1);
 assert.equal(run(['--suppress-ms','1000']).status,1);
 await fs.rm(dir,{recursive:true,force:true});
});
