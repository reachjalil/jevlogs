import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (args=[], input) => spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8',input,env:{...process.env,AI_GATEWAY_API_KEY:''}});
test('default npx experience is labeled offline and routes demo samples',()=>{
 const r=run(); assert.equal(r.status,0);assert.match(r.stderr,/OFFLINE DEMO/);assert.match(r.stderr,/2 selected/);assert.match(r.stdout,/Payment capture failed/);
});
test('JSON mode emits parseable decisions only, without raw log bodies',()=>{
 const r=run(['--demo','--json']);assert.equal(r.status,0);const rows=r.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,4);assert.equal(rows[0].mode,'demo');assert.equal(rows[0].route,'retain');assert.equal(rows[0].fingerprint,'GET /health returned 200 in <*>');assert.equal(rows[2].reason,'protected');assert.ok(rows.every(r=>!('body' in r)));
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
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
test('version comes from package.json',()=>{assert.equal(run(['--version']).stdout.trim(),JSON.parse(readFileSync('package.json','utf8')).version);});
test('--follow requires --stdin and --live; --limit is rejected outside range',()=>{
 assert.equal(run(['--follow']).status,1);assert.equal(run(['--stdin','--follow']).status,1);
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
