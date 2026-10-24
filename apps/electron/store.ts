import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from '../../packages/shared/types';
import { validateServer as validateConnection } from '../../packages/core/validation';

export function validateServer(raw: unknown): Server {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid server');
  const s = raw as Server;
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) throw new Error('Server name is required (maximum 80 characters)');
  if (typeof s.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:\-]*$/.test(s.host) || s.host.length > 253) throw new Error('Enter a valid host or SSH alias');
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error('SSH port must be 1–65535');
  if (s.username && !/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(s.username)) throw new Error('Invalid SSH username');
  if (typeof s.root !== 'string' || !/^(\/|~\/)/.test(s.root) || /[\x00-\x1f]/.test(s.root) || s.root.split('/').includes('..') || ['/', '~', '/root', '/home', '/etc', '/usr', '/var'].includes(s.root.replace(/\/+$/, '') || '/')) throw new Error('Choose a dedicated absolute deployment directory, or ~/deployments');
  if (typeof s.useSshConfig !== 'boolean') throw new Error('Invalid connection mode');
  if (s.identityFile && (typeof s.identityFile !== 'string' || /[\x00-\x1f]/.test(s.identityFile))) throw new Error('Invalid key path');
  if (s.id && !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)) throw new Error('Invalid server ID');
  validateConnection(s);
  return { id: s.id || randomUUID(), name: s.name.trim(), host: s.host, port: s.port, root: s.root, useSshConfig: s.useSshConfig, ...(s.username ? { username: s.username } : {}), ...(s.identityFile ? { identityFile: s.identityFile } : {}) };
}
export class ServerStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async list(): Promise<Server[]> {
    try { const data = JSON.parse(await readFile(path.join(this.directory, 'servers.json'), 'utf8')); if (!Array.isArray(data)) throw new Error('Invalid server store'); return data.map(validateServer); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  }
  private change(fn: (data: Server[]) => Server[]) {
    const operation = this.queue.then(async () => {
      const data = fn(await this.list());
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temp = path.join(this.directory, `servers-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(temp, path.join(this.directory, 'servers.json'));
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async save(raw: unknown) { const s = validateServer(raw); await this.change(data => [...data.filter(x => x.id !== s.id), s]); return s; }
  async remove(id: string) { await this.change(data => data.filter(x => x.id !== id)); }
  async get(id: string) { const s = (await this.list()).find(x => x.id === id); if (!s) throw new Error('Unknown server'); return s; }
}
