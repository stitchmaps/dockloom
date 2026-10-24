/** Disposable local DinD + SSH fixture. Never points at a user's remote server. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DeploymentCore } from '../packages/core/index';
import type { Job, Server, StaticDeploy } from '../packages/shared/types';
const exec = promisify(execFile);
const run = async (file: string, args: string[], timeout = 120_000) => (await exec(file, args, { timeout, maxBuffer: 8 * 1024 ** 2, windowsHide: true })).stdout.trim();
const pause = () => new Promise(r => setTimeout(r, 1000));
const name = `dockloom-e2e-${randomBytes(5).toString('hex')}`;
const temp = await mkdtemp(path.join(os.tmpdir(), 'dockloom-e2e-'));
let started = false;
async function transferImage() {
  await run('docker', ['pull', 'nginx:alpine'], 240_000);
  await new Promise<void>((resolve, reject) => {
    const source = spawn('docker', ['save', 'nginx:alpine'], { windowsHide: true });
    const target = spawn('docker', ['exec', '-i', name, 'docker', 'load'], { windowsHide: true });
    let error = ''; let sourceCode: number | null = null;
    source.stdout.pipe(target.stdin);
    source.stderr.on('data', c => { error += c; }); target.stderr.on('data', c => { error += c; });
    source.on('error', reject); target.on('error', reject); target.stdin.on('error', reject);
    source.on('close', code => { sourceCode = code; if (code) reject(new Error(error)); });
    target.on('close', code => code === 0 && (sourceCode === 0 || sourceCode === null) ? resolve() : reject(new Error(error)));
  });
}
try {
  console.log('Building isolated SSH + Docker fixture…');
  await run('docker', ['build', '-t', 'dockloom-test-ssh:local', 'tests/fixtures/ssh-docker'], 300_000);
  const key = path.join(temp, 'id_ed25519');
  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  await run('docker', ['run', '-d', '--privileged', '--name', name, '--label', 'dev.dockloom.test=true', '-p', '127.0.0.1::22', '--mount', `type=bind,source=${key}.pub,target=/fixture-key.pub,readonly`, 'dockloom-test-ssh:local']);
  started = true;
  for (let attempt = 0; ; attempt++) {
    try { await run('docker', ['exec', name, 'docker', 'info'], 5000); break; } catch { if (attempt > 45) throw new Error('Fixture daemon did not start'); await pause(); }
  }
  console.log('Fixture ready; loading nginx…');
  await transferImage();
  const binding = await run('docker', ['port', name, '22/tcp']);
  const port = Number(binding.split(':').at(-1));
  const publicHostKey = await run('docker', ['exec', name, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub']);
  const knownHosts = path.join(temp, 'known_hosts');
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${publicHostKey}\n`);
  const server: Server = { id: 'fixture', name: 'Disposable local fixture', host: '127.0.0.1', port, username: 'root', identityFile: key, root: '/root/dockloom-tests', useSshConfig: false };
  const core = new DeploymentCore({ knownHostsFile: knownHosts });
  const snapshot = await core.inspect(server);
  assert(snapshot.dockerVersion); assert(snapshot.composeVersion); assert.equal(snapshot.containers.length, 0);
  console.log('PASS SSH inspection of empty Docker host');
  const source = path.join(temp, 'site'); await mkdir(source);
  await writeFile(path.join(source, 'index.html'), '<h1>dockloom-fixture-v1</h1>');
  const spec: StaticDeploy = { app: 'test-site', source, port: 18081, spa: true, image: 'nginx:alpine', bindAddress: '127.0.0.1' };
  const plan = await core.plan(server, spec); assert.equal(plan.fileCount, 1); assert(plan.target.includes('test-site'));
  const finish = async (job: Job, expected: Job['status'] = 'succeeded') => {
    // New core instance models reconnecting after the request connection closed.
    const reconnect = new DeploymentCore({ knownHostsFile: knownHosts });
    for (let n = 0; n < 120; n++) {
      const current = await reconnect.job(server, job.id);
      if (!['running', 'queued'].includes(current.status)) { assert.equal(current.status, expected, current.log); return current; }
      await pause();
    }
    throw new Error(`Job timed out: ${job.id}`);
  };
  await finish(await core.deploy(server, spec));
  const getPage = () => run('docker', ['exec', name, 'curl', '-fsS', 'http://127.0.0.1:18081/']);
  assert.match(await getPage(), /fixture-v1/);
  const v1 = (await core.releases(server)).find(r => r.current)!; assert(v1);
  console.log('PASS first deployment + reconnect + HTTP verification');
  await writeFile(path.join(source, 'index.html'), '<h1>dockloom-fixture-v2</h1>');
  await finish(await core.deploy(server, spec)); assert.match(await getPage(), /fixture-v2/);
  await finish(await core.rollback(server, spec.app, v1.id)); assert.match(await getPage(), /fixture-v1/);
  console.log('PASS second deployment + rollback to v1');
  const containers = (await core.inspect(server)).containers; assert.equal(containers.length, 1);
  const logs = await core.logs(server, containers[0].id); assert.equal(typeof logs, 'string');
  await core.action(server, containers[0].id, 'stop'); assert.equal((await core.inspect(server)).containers[0].state, 'exited');
  await core.action(server, containers[0].id, 'start');
  assert.match(await getPage(), /fixture-v1/);
  console.log('PASS container logs + stop/start');
  // Use a cached but deliberately unsuitable image for a new release; old app must recover.
  await run('docker', ['exec', name, 'docker', 'tag', 'nginx:alpine', 'dockloom-fixture:broken']);
  // Empty HTML directory still has index, but image's CMD is broken through a tiny fixture image.
  const buildInput = 'FROM nginx:alpine\nCMD ["/bin/sh", "-c", "exit 1"]\n';
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', name, 'docker', 'build', '-t', 'dockloom-fixture:broken', '-'], { windowsHide: true });
    let error = ''; child.stderr.on('data', c => { error += c; }); child.stdout.resume(); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error))); child.stdin.end(buildInput);
  });
  await finish(await core.deploy(server, { ...spec, image: 'dockloom-fixture:broken' }), 'failed');
  assert.match(await getPage(), /fixture-v1/);
  console.log('PASS failed release restores previous live version');
  await assert.rejects(() => core.deploy(server, { ...spec, app: '../escape' }));
  await mkdir(path.join(temp, 'invalid'));
  await assert.rejects(() => core.plan(server, { ...spec, source: path.join(temp, 'invalid') }));
  console.log('PASS unsafe app + missing index rejected');
  const records = await core.jobs(server); assert(records.length >= 4);
  console.log('ALL INTEGRATION CHECKS PASSED');
} finally {
  if (started) {
    // Only the unique fixture created above, and its anonymous DinD volume.
    const label = await run('docker', ['inspect', '--format', '{{index .Config.Labels "dev.dockloom.test"}}', name]);
    if (label === 'true' && name.startsWith('dockloom-e2e-')) await run('docker', ['rm', '-f', '-v', name]);
  }
  await rm(temp, { recursive: true, force: true });
}
