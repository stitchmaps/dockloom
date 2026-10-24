import { constants } from 'node:fs';
import { lstat, readdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Server, Snapshot, StaticDeploy, DeployPlan, Job, Release, ComposeImport, ContainerAction } from '../shared/types';
import { SSHTransport, type SSHOptions, type RemoteTransport } from './ssh';
import { redact, validateContainerId, validateId, validateName, validateServer, validateStatic, validateCompose } from './validation';
export * from './validation';
export { SSHTransport, sshArguments } from './ssh';
export type { RemoteTransport, SSHOptions } from './ssh';
export { REMOTE_PYTHON } from './remote';

export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_SOURCE_FILES = 5000;
interface SourceFile { path: string; data: string; sha256: string; size: number }
async function collectSource(source: string): Promise<{ files: SourceFile[]; bytes: number }> {
  const selected = path.resolve(source);
  if ((await lstat(selected)).isSymbolicLink()) throw new Error('Source must not be a symbolic link');
  const root = await realpath(selected);
  if (!(await lstat(root)).isDirectory()) throw new Error('Select a built static directory (ZIP is not supported in v0.1)');
  const files: SourceFile[] = [];
  let bytes = 0;
  async function walk(directory: string, relative = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (/[\x00-\x1f\x7f\\]/.test(entry.name)) throw new Error('Unsupported source filename');
      const filename = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${name}`);
      const canonical = await realpath(filename);
      if (!canonical.startsWith(root + path.sep)) throw new Error('Source path escapes the selected directory');
      if (stat.isDirectory()) await walk(filename, name);
      else if (stat.isFile()) {
        if (files.length >= MAX_SOURCE_FILES || bytes + stat.size > MAX_SOURCE_BYTES) throw new Error('Static source exceeds 5000 files or 32 MiB');
        const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size !== stat.size || before.ino !== stat.ino) throw new Error('Source changed while reading');
          // Bound the read even when a concurrent writer grows the file.
          const data = Buffer.alloc(before.size + 1);
          let length = 0;
          while (length < data.length) {
            const result = await handle.read(data, length, data.length - length, null);
            if (!result.bytesRead) break;
            length += result.bytesRead;
          }
          const after = await handle.stat();
          if (length !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size) throw new Error('Source changed while reading');
          const content = data.subarray(0, length);
          bytes += content.length;
          files.push({ path: name, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), data: content.toString('base64') });
        } finally { await handle.close(); }
      } else throw new Error(`Only regular files are supported: ${name}`);
    }
  }
  await walk(root);
  if (!files.some(file => file.path === 'index.html')) throw new Error('Static directory must contain index.html');
  return { files, bytes };
}

export class DeploymentCore {
  private readonly transport: RemoteTransport;
  constructor(options: SSHOptions & { transport?: RemoteTransport } = {}) { this.transport = options.transport ?? new SSHTransport(options); }
  private call<T>(server: Server, operation: string, args?: Record<string, unknown>): Promise<T> {
    validateServer(server);
    return this.transport.request<T>(server, operation, args);
  }
  inspect(server: Server): Promise<Snapshot> { return this.call(server, 'inspect'); }
  async logs(server: Server, containerId: string): Promise<string> {
    validateContainerId(containerId);
    return redact(await this.call<string>(server, 'logs', { containerId })).slice(-65536);
  }
  async action(server: Server, containerId: string, action: ContainerAction): Promise<void> {
    validateContainerId(containerId);
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Invalid container action');
    await this.call(server, 'action', { containerId, action });
  }
  async plan(server: Server, request: StaticDeploy): Promise<DeployPlan> {
    validateServer(server); validateStatic(request);
    const source = await collectSource(request.source);
    const target = await this.call<string>(server, 'plan', { app: request.app });
    return { fileCount: source.files.length, bytes: source.bytes, target, summary: [
      `Publish ${source.files.length} files (${source.bytes} bytes) into an isolated managed Compose project`,
      `${request.bindAddress}:${request.port} → container port 80; ${request.spa ? 'SPA fallback' : 'static files'}`,
      `Image ${request.image}; prefer cached image, pin the resolved image ID`,
      'Acquire project lock; validate files/configuration; verify HTTP; commit current release or restore previous release',
    ] };
  }
  async deploy(server: Server, request: StaticDeploy): Promise<Job> {
    validateServer(server); validateStatic(request);
    const source = await collectSource(request.source);
    return this.call(server, 'deploy', { spec: { ...request, source: undefined }, files: source.files });
  }
  releases(server: Server): Promise<Release[]> { return this.call(server, 'releases'); }
  rollback(server: Server, app: string, release: string): Promise<Job> {
    validateName(app); validateId(release);
    return this.call(server, 'rollback', { app, release });
  }
  async jobs(server: Server): Promise<Job[]> {
    const jobs = await this.call<Job[]>(server, 'jobs');
    return jobs.map(job => ({ ...job, log: redact(job.log).slice(-65536) }));
  }
  async job(server: Server, id: string): Promise<Job> {
    validateId(id);
    const job = await this.call<Job>(server, 'job', { id });
    return { ...job, log: redact(job.log).slice(-65536) };
  }
  importCompose(server: Server, request: ComposeImport): Promise<string> {
    validateCompose(request);
    return this.call(server, 'importCompose', { spec: request });
  }
}
