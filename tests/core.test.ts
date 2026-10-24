import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DeploymentCore, SSHTransport, redact, sshArguments, validateName, validateId, validateRoot, validateServer, validateContainerId, validateCompose, validateStatic, type RemoteTransport } from '../packages/core/index';
import type { Server, StaticDeploy } from '../packages/shared/types';

const server: Server = { id: 'test', name: 'Synthetic', host: 'example.com', port: 22, username: 'deploy', root: '/srv/test deployments', useSshConfig: false };
const spec: StaticDeploy = { app: 'test-site', source: '.', port: 8080, image: 'nginx:alpine', spa: true, bindAddress: '127.0.0.1' };

test('reject shell-option names, traversal, invalid IDs and unsafe roots', () => {
  for (const name of ['', '../app', '-app', 'app;id', 'app\n', 'app space', 'UPPER', 'a'.repeat(49)]) assert.throws(() => validateName(name));
  for (const id of ['', '-f', '../x', 'abc;whoami', 'a'.repeat(33)]) assert.throws(() => validateId(id));
  for (const id of ['nginx', '--help', 'a'.repeat(65), 'ab;pwd', 'A'.repeat(64)]) assert.throws(() => validateContainerId(id));
  for (const root of ['/', '~/', '/etc/apps', '/proc/a', '/home', '/opt', '/tmp/../etc', '/srv//apps', '/srv/apps/', 'relative', '~/../apps', '/srv\\apps', '/srv/\napps']) assert.throws(() => validateRoot(root));
  for (const root of ['~/deployments', '/srv/apps', '/opt/apps', '/tmp/isolation', '/srv/space and quote\'']) assert.doesNotThrow(() => validateRoot(root));
  validateName('valid-app-2'); validateId('a'.repeat(32)); validateContainerId('b'.repeat(64));
});

test('OpenSSH uses argv, strict trust and batch mode; alias preserves config', () => {
  const args = sshArguments({ ...server, identityFile: path.resolve('test keys/key') });
  assert(args.includes('BatchMode=yes')); assert(args.includes('StrictHostKeyChecking=yes'));
  assert(args.includes('ClearAllForwardings=yes'));
  assert.equal(args.at(-1), 'example.com'); assert.equal(args.at(-2), '--');
  assert(args.includes(path.resolve('test keys/key')));
  const alias = sshArguments({ ...server, host: 'test-alias', useSshConfig: true, username: undefined });
  assert(!alias.includes('-F')); assert(!alias.includes('-p')); assert(!alias.includes('-l'));
  for (const host of ['-oProxyCommand=x', 'user@host', 'host;id', 'host\n', '$(id)', 'host space']) assert.throws(() => validateServer({ ...server, host }));
  assert.throws(() => validateServer({ ...server, username: 'root;id' }));
  assert.throws(() => validateServer({ ...server, port: 0 }));
  validateServer({ ...server, host: '2001:db8::1' });
});

test('structured deployment and Compose inputs reject invalid values', () => {
  for (const image of ['--help', 'nginx;id', 'nginx\n', 'nginx $(id)']) assert.throws(() => validateStatic({ ...spec, image }));
  for (const port of [0, 65536, 1.5, NaN]) assert.throws(() => validateStatic({ ...spec, port }));
  for (const files of [[], ['../docker-compose.yml'], ['/etc/passwd'], ['x\\y'], ['a//b']]) assert.throws(() => validateCompose({ directory: '/srv/existing', project: 'existing', files }));
  validateCompose({ directory: '/srv/existing', project: 'existing', files: ['base.yml', 'overrides/prod.yml'] });
});

test('source collection hashes exact selected files; remote input never includes local path', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dockloom-core-'));
  try {
    const html = '<h1>synthetic</h1>';
    await writeFile(path.join(temp, 'index.html'), html);
    await mkdir(path.join(temp, 'assets'));
    await writeFile(path.join(temp, 'assets', 'a b.txt'), 'test');
    const calls: { operation: string; args?: Record<string, unknown> }[] = [];
    const transport: RemoteTransport = { async request<T>(_server: Server, operation: string, args?: Record<string, unknown>) {
      calls.push({ operation, args });
      return (operation === 'plan' ? '/srv/test deployments/.dockloom/apps/test-site' : { id: 'a'.repeat(32), status: 'queued' }) as T;
    } };
    const core = new DeploymentCore({ transport });
    const plan = await core.plan(server, { ...spec, source: temp });
    assert.equal(plan.bytes, Buffer.byteLength(html) + 4); assert.equal(plan.fileCount, 2);
    await core.deploy(server, { ...spec, source: temp });
    const payload = calls.at(-1)!.args!;
    assert.equal((payload.spec as StaticDeploy).source, undefined);
    const files = payload.files as { path: string; data: string; sha256: string }[];
    const index = files.find(f => f.path === 'index.html')!;
    assert.equal(Buffer.from(index.data, 'base64').toString(), html);
    assert.equal(index.sha256, createHash('sha256').update(html).digest('hex'));
    assert(files.some(f => f.path === 'assets/a b.txt'));
    await assert.rejects(core.action(server, 'a'.repeat(64), 'remove' as never));
    assert.equal(calls.length, 2);
  } finally { await rm(temp, { force: true, recursive: true }); }
});

test('directory input requires index and rejects symbolic links before any SSH request', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dockloom-core-links-'));
  const core = new DeploymentCore({ transport: { async request() { throw new Error('Unexpected SSH request'); } } });
  try {
    await assert.rejects(core.plan(server, { ...spec, source: temp }), /index.html/);
    await writeFile(path.join(temp, 'index.html'), 'ok');
    await mkdir(path.join(temp, 'real'));
    try { await symlink(path.join(temp, 'real'), path.join(temp, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Host does not permit creating test symlinks'); return; } throw error; }
    await assert.rejects(core.plan(server, { ...spec, source: temp }), /Symbolic links/);
  } finally { await rm(temp, { force: true, recursive: true }); }
});

test('logs redact common credentials and are bounded', async () => {
  const input = 'password=hunter2\nAuthorization: Bearer abc\nhttps://user:pass@example.com/?token=abc\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----';
  const redacted = redact(input);
  for (const secret of ['hunter2', 'Bearer abc', 'user:pass', 'token=abc', '\nabc\n']) assert(!redacted.includes(secret));
  const core = new DeploymentCore({ transport: { async request<T>() { return ('x'.repeat(100000) + '\nsecret=hidden') as T; } } });
  const logs = await core.logs(server, 'a'.repeat(64));
  assert(logs.length <= 65536); assert(!logs.includes('hidden'));
});

test('transport keeps paths in stdin and quotes a spaced known_hosts path', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dockloom core ssh '));
  try {
    const script = path.join(temp, 'fake-ssh.cjs');
    await writeFile(script, `let data = ''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => {
      const payload = JSON.parse(data);
      process.stdout.write(JSON.stringify(payload.request.operation === 'fail' ? {ok:false,error:'password=synthetic-secret'} : {ok:true,result:{args:process.argv.slice(2),request:payload.request}}));
    });`);
    const knownHostsFile = path.join(temp, 'known hosts');
    const transport = new SSHTransport({ sshExecutable: process.execPath, sshOptions: [script], knownHostsFile });
    const root = "/srv/quoted ' and $dollar";
    const result = await transport.request<{ args: string[]; request: { root: string } }>({ ...server, root }, 'inspect');
    assert(result.args.includes(`UserKnownHostsFile="${knownHostsFile.replace(/\\/g, '/')}"`));
    assert.equal(result.request.root, root);
    assert(!result.args.some(arg => arg.includes(root)));
    await assert.rejects(transport.request(server, 'fail'), error => error instanceof Error && !error.message.includes('synthetic-secret') && error.message.includes('[REDACTED]'));
  } finally { await rm(temp, { force: true, recursive: true }); }
});
