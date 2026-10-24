import { spawn } from 'node:child_process';
import type { Server } from '../shared/types';
import { redact, validateServer } from './validation';
import { REMOTE_PYTHON } from './remote';

export interface RemoteTransport {
  request<T>(server: Server, operation: string, args?: Record<string, unknown>): Promise<T>;
}
export interface SSHOptions {
  sshExecutable?: string;
  knownHostsFile?: string;
  /** Trusted local configuration only, e.g. ['-F', '/test/ssh_config']. Never renderer input. */
  sshOptions?: string[];
  timeoutMs?: number;
}
export function sshArguments(server: Server, extra: string[] = []): string[] {
  validateServer(server);
  const args = [...extra, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ClearAllForwardings=yes'];
  if (!server.useSshConfig) args.push('-F', process.platform === 'win32' ? 'NUL' : '/dev/null');
  // Alias mode preserves configured Port/User unless the user provides an explicit identity/user.
  if (!server.useSshConfig || server.port !== 22) args.push('-p', String(server.port));
  if (server.username) args.push('-l', server.username);
  if (server.identityFile) args.push('-i', server.identityFile);
  args.push('--', server.host);
  return args;
}

export class SSHTransport implements RemoteTransport {
  constructor(private readonly options: SSHOptions = {}) {}
  async request<T>(server: Server, operation: string, args: Record<string, unknown> = {}): Promise<T> {
    // All variable data is JSON on stdin. The only shell command is this fixed bootstrap.
    const command = `python3 -c 'import sys,json; p=json.load(sys.stdin); exec(compile(p["script"],"<dockloom>","exec")); main(p["request"],p["script"])'`;
    const payload = JSON.stringify({ script: REMOTE_PYTHON, request: { operation, root: server.root, ...args } });
    const output = await new Promise<string>((resolve, reject) => {
      const extra = [...(this.options.sshOptions ?? [])];
      if (this.options.knownHostsFile) {
        if (/[\r\n\x00"]/.test(this.options.knownHostsFile)) { reject(new Error('Invalid known_hosts file path')); return; }
        extra.push('-o', `UserKnownHostsFile="${this.options.knownHostsFile.replace(/\\/g, '/')}"`);
      }
      const child = spawn(this.options.sshExecutable ?? 'ssh', [...sshArguments(server, extra), command], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      let size = 0;
      let errorSize = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => { failure = new Error('SSH request timed out; a submitted remote job may still be running. Reconnect and inspect jobs.'); child.kill(); }, this.options.timeoutMs ?? 120_000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { failure = new Error('SSH response exceeded limit'); child.kill(); } else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => { errorSize += chunk.length; if (errorSize <= 64 * 1024) errors.push(chunk); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdin.on('error', () => { /* close/error reports a failed transport, including EPIPE. */ });
      child.on('close', code => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(redact(Buffer.concat(errors).toString('utf8')).slice(-8192) || `SSH exited with code ${code}; Python3 and a trusted SSH host key are required`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      child.stdin.end(payload);
    });
    let envelope: { ok: boolean; result?: T; error?: string };
    try { envelope = JSON.parse(output); } catch { throw new Error('Invalid remote response (requires Python3 and a non-interactive SSH shell)'); }
    if (!envelope.ok) throw new Error(redact(envelope.error ?? 'Remote operation failed'));
    return envelope.result as T;
  }
}
