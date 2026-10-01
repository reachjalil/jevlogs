#!/usr/bin/env node
// Publishes the version in package.json to npm, then tags, pushes, and creates the GitHub release.
// Every check runs first and the exact tarball that passed the smoke test is the one published.
//
//   pnpm release --dry-run      run every check and `npm publish --dry-run`; change nothing
//   pnpm release                publish for real (asks you to type the version first)
//
// Options: --tag <dist-tag> (default latest, or next for 1.2.3-rc.1), --allow-branch, --yes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { name, version } = pkg;
const registry = pkg.publishConfig?.registry ?? 'https://registry.npmjs.org/';
const tagName = `v${version}`;
const releaseBranch = 'main';
const win = process.platform === 'win32';

const args = process.argv.slice(2).filter(arg => arg !== '--');
const flag = option => args.includes(option);
const dryRun = flag('--dry-run');
const allowBranch = flag('--allow-branch');
const yes = flag('--yes');
const prerelease = version.includes('-');
const tagIndex = args.indexOf('--tag');
const distTag = tagIndex >= 0 ? args[tagIndex + 1] : prerelease ? 'next' : 'latest';
const known = new Set(['--dry-run', '--allow-branch', '--yes', '--tag']);
const unknown = args.filter((arg, i) => !known.has(arg) && !(i === tagIndex + 1 && tagIndex >= 0));
if (unknown.length || !distTag || distTag.startsWith('-')) fail(`Usage: pnpm release [--dry-run] [--tag <dist-tag>] [--allow-branch] [--yes]${unknown.length ? `\nUnknown option: ${unknown.join(' ')}` : ''}`);
if (prerelease && distTag === 'latest') fail(`${version} is a prerelease. Publish it under --tag next (the default) so npm install does not pick it up.`);

const blockers = [];
let step = 0;
const steps = dryRun ? 4 : 6;
function heading(text) { console.log(`\n[${++step}/${steps}] ${text}`); }
function ok(text) { console.log(`  ✓ ${text}`); }
function warn(text) { console.log(`  ! ${text}`); }
function fail(text) { console.error(`\n✗ ${text}\n`); process.exit(1); }
// A dry run reports what would stop a real release instead of stopping.
function gate(text) { if (!dryRun) fail(text); blockers.push(text); warn(text); }
/** Runs a command without printing. `out` is stdout only, so warnings on stderr never read as values. */
function capture(cmd, cmdArgs, cwd = root) {
  const result = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', shell: win });
  const out = (result.stdout ?? '').trim();
  return { ok: result.status === 0, out, all: `${out}\n${(result.stderr ?? '').trim()}`.trim() };
}
/** Runs a command with its output on screen and stops the release if it fails. */
function stream(cmd, cmdArgs, cwd = root) {
  console.log(`  $ ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: win });
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed. Nothing was published.`);
}
/** Semver precedence for x.y.z[-pre]; build metadata is not used here. */
function compareVersions(a, b) {
  const parse = v => { const dash = v.indexOf('-'); return { nums: (dash < 0 ? v : v.slice(0, dash)).split('.').map(Number), pre: dash < 0 ? [] : v.slice(dash + 1).split('.') }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}
function changelogSection() {
  const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('\n');
  const start = lines.findIndex(line => new RegExp(`^## ${version.replaceAll('.', '\\.')}(\\s|$)`).test(line));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

console.log(`${dryRun ? 'Dry run: ' : ''}releasing ${name}@${version} to ${registry} under dist-tag "${distTag}"`);

heading('Preflight');
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node.js ${process.versions.node} is older than the supported 22.`);
const pnpmVersion = capture('pnpm', ['--version']).out;
const wantedPnpm = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager ?? '')?.[1];
if (wantedPnpm && pnpmVersion.split('.')[0] !== wantedPnpm.split('.')[0]) warn(`pnpm ${pnpmVersion} is running; this repo pins pnpm ${wantedPnpm} (CI uses that). Upgrade with: npm install -g pnpm@${wantedPnpm}`);
else ok(`pnpm ${pnpmVersion}`);

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (branch !== releaseBranch && !allowBranch) gate(`On branch "${branch}". Release from ${releaseBranch}, or pass --allow-branch.`);
else ok(`branch ${branch}`);
if (capture('git', ['status', '--porcelain']).out) gate('The working tree has uncommitted changes. Commit or stash them first.');
else ok('working tree clean');
if (!capture('git', ['fetch', '--quiet', '--tags', 'origin']).ok) gate('git fetch origin failed, so the branch could not be compared with the remote.');
const upstream = capture('git', ['rev-parse', '--abbrev-ref', '@{u}']);
if (upstream.ok) {
  const behind = Number(capture('git', ['rev-list', '--count', 'HEAD..@{u}']).out);
  if (behind > 0) gate(`${branch} is ${behind} commit(s) behind ${upstream.out}. Pull first.`);
  else ok(`up to date with ${upstream.out}`);
} else warn(`${branch} has no upstream; it will be pushed to origin/${branch}.`);
if (capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tagName}`]).ok || capture('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tagName}`]).ok) {
  fail(`Tag ${tagName} already exists. Bump the version in package.json and add a CHANGELOG entry.`);
}
ok(`tag ${tagName} is free`);

const published = capture('npm', ['view', `${name}@${version}`, 'version', '--registry', registry]);
if (published.ok && published.out) fail(`${name}@${version} is already on npm. Versions cannot be republished; bump the version.`);
if (!published.ok && !/E404|404/.test(published.all)) fail(`Could not query npm:\n${published.all}`);
ok(`${version} is not on npm yet`);
const current = capture('npm', ['view', name, `dist-tags.${distTag}`, '--registry', registry]).out.split('\n').pop() ?? '';
if (current && compareVersions(version, current) <= 0) fail(`dist-tag "${distTag}" is ${current}. Publishing ${version} there would move it backwards.`);
ok(current ? `dist-tag "${distTag}" moves ${current} → ${version}` : `dist-tag "${distTag}" is new`);

const notes = changelogSection();
if (!notes) fail(`CHANGELOG.md has no "## ${version}" section. Write the release notes first.`);
ok('CHANGELOG.md has release notes');
const whoami = capture('npm', ['whoami', '--registry', registry]);
if (!whoami.ok) gate(`Not logged in to ${registry}. Run: npm login`);
else ok(`npm user ${whoami.out}`);

heading('Verify: install, test, examples, package lint');
// Without this, pnpm stops to ask before rebuilding node_modules made by another pnpm version.
stream('pnpm', ['install', '--frozen-lockfile', '--config.confirm-modules-purge=false']);
stream('pnpm', ['test']);
stream('pnpm', ['check:examples']);
stream('pnpm', ['lint:package']);

heading('Pack and smoke test the tarball');
const work = mkdtempSync(join(tmpdir(), 'jevlogs-release-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
stream('pnpm', ['pack', '--pack-destination', work]);
const tarballName = readdirSync(work).find(file => file.endsWith('.tgz'));
if (!tarballName) fail('pnpm pack produced no tarball.');
const tarball = join(work, tarballName);
const files = capture('tar', ['-tzf', tarball]).out.split('\n').filter(Boolean).map(file => file.replace(/^package\//, ''));
for (const required of ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'dist/index.js', 'dist/index.d.ts', 'dist/server.js', 'dist/server.d.ts', 'dist/cli.js']) {
  if (!files.includes(required)) fail(`The tarball is missing ${required}.`);
}
const stray = files.filter(file => /(^|\/)(\.env|test\/|benchmarks\/|node_modules\/)|\.tgz$/.test(file));
if (stray.length) fail(`The tarball contains files that should not ship:\n  ${stray.join('\n  ')}`);
const bytes = readFileSync(tarball);
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
ok(`${tarballName}: ${files.length} files, ${(statSync(tarball).size / 1000).toFixed(1)} kB packed`);
console.log(`    ${files.join('\n    ')}`);
stream('node', [join(root, 'scripts', 'smoke.mjs'), tarball]);

if (dryRun) {
  heading('npm publish --dry-run');
  stream('npm', ['publish', tarball, '--dry-run', '--access', 'public', '--tag', distTag, '--registry', registry]);
  console.log(`\nDry run complete. ${blockers.length ? `A real release would stop on:\n  - ${blockers.join('\n  - ')}` : 'A real release would go ahead.'}`);
  console.log(`Run \`pnpm release\` on ${releaseBranch} to publish.`);
  process.exit(0);
}

heading('Confirm');
console.log(`  package    ${name}@${version}
  dist-tag   ${distTag}${current ? ` (currently ${current})` : ''}
  tarball    ${tarballName}
  integrity  ${integrity}
  then       tag ${tagName}, push ${branch} and the tag to origin, create the GitHub release`);
if (!yes) {
  if (!process.stdin.isTTY) fail('No terminal to confirm in. Re-run with --yes to publish non-interactively.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\n  Type ${version} to publish: `)).trim();
  rl.close();
  if (answer !== version) fail('Not confirmed. Nothing was published.');
}

heading('Publish, tag, push, GitHub release');
// npm asks for your one-time password or opens the browser here when 2FA is on.
stream('npm', ['publish', tarball, '--access', 'public', '--tag', distTag, '--registry', registry]);
ok(`published ${name}@${version}`);
const followUps = [];
if (capture('git', ['tag', '-a', tagName, '-m', `${name} ${version}`]).ok) ok(`tagged ${tagName}`);
else followUps.push(`git tag -a ${tagName} -m "${name} ${version}"`);
const push = capture('git', ['push', '--atomic', 'origin', branch, `refs/tags/${tagName}`]);
if (push.ok) ok(`pushed ${branch} and ${tagName}`);
else { warn(`git push failed:\n${push.all}`); followUps.push(`git push --atomic origin ${branch} refs/tags/${tagName}`); }

const install = `pnpm add ${name}@${version}   # or: npm install ${name}@${version}`;
const notesFile = join(work, 'notes.md');
writeFileSync(notesFile, `${notes}\n\n## Install\n\n\`\`\`bash\n${install}\npnpm dlx ${name}@${version}   # or: npx ${name}@${version}\n\`\`\`\n\nnpm: https://www.npmjs.com/package/${name}/v/${version} · Tarball integrity: \`${integrity}\`\n`);
const firstLine = notes.split('\n').find(line => line.trim())?.trim().replace(/\.$/, '') ?? '';
const title = firstLine.length && firstLine.length <= 72 && !firstLine.startsWith('-') ? `${tagName} — ${firstLine}` : tagName;
if (!push.ok) followUps.push(`gh release create ${tagName} --title "${title}" --notes-file <notes>`);
else if (!capture('gh', ['auth', 'status']).ok) { warn('gh is not installed or not logged in; skipped the GitHub release.'); followUps.push(`gh release create ${tagName} --title "${title}" --notes-from-tag`); }
else {
  const release = capture('gh', ['release', 'create', tagName, tarball, '--verify-tag', '--title', title, '--notes-file', notesFile,
    ...(prerelease ? ['--prerelease'] : []), ...(distTag === 'latest' ? ['--latest'] : ['--latest=false'])]);
  if (release.ok) ok(`GitHub release ${release.out.split('\n').pop()}`);
  else { warn(`gh release create failed:\n${release.all}`); followUps.push(`gh release create ${tagName} --title "${title}"`); }
}

heading('Verify the public package');
let visible = false;
for (let attempt = 0; attempt < 24 && !visible; attempt++) {
  visible = capture('npm', ['view', `${name}@${version}`, 'version', '--registry', registry]).out.split('\n').pop() === version;
  if (!visible) await new Promise(r => setTimeout(r, 5000));
}
if (!visible) warn(`npm does not list ${version} yet. Check again with: npm view ${name} dist-tags`);
else {
  ok(`npm lists ${name}@${version}; dist-tags: ${capture('npm', ['view', name, 'dist-tags', '--json', '--registry', registry]).out.replace(/\s+/g, ' ')}`);
  const fresh = mkdtempSync(join(tmpdir(), 'jevlogs-npx-'));
  const npx = capture('npx', ['--yes', `${name}@${version}`, '--version'], fresh);
  rmSync(fresh, { recursive: true, force: true });
  if (npx.out.split('\n').pop() === version) ok(`npx ${name}@${version} --version works from a clean directory`);
  else warn(`npx ${name}@${version} --version printed:\n${npx.all}`);
}

console.log(`\nReleased ${name}@${version}. https://www.npmjs.com/package/${name}/v/${version}`);
if (followUps.length) console.log(`\nFinish these by hand:\n  ${followUps.join('\n  ')}`);
