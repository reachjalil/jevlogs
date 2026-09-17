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
 assert.match(run(['--help']).stdout,/npx jevlogs/);assert.equal(run(['--version']).stdout.trim(),'0.1.1');assert.equal(run(['--json','--limit','1']).stdout.trim().split('\n').length,1);
});
