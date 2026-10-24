import path from 'node:path';
import type { ComposeImport, Server, StaticDeploy } from '../shared/types';

const clean = (value: unknown): value is string => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value);
export function validateName(value: string): void {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(value)) throw new Error('Application name must be 1–48 lowercase letters, digits or hyphens, starting with a letter');
}
export function validateId(value: string): void {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error('Invalid job or release ID');
}
export function validateContainerId(value: string): void {
  if (!/^[a-f0-9]{12,64}$/.test(value)) throw new Error('Invalid container ID');
}
export function validateRoot(value: string): void {
  if (!clean(value) || value.length > 1024 || !(value.startsWith('/') || value.startsWith('~/')) || value.includes('\\')) throw new Error('Root must be an absolute Linux path or ~/path');
  const parts = value.split('/');
  if (parts.some((p, i) => p === '..' || p === '.' || (!p && i > 0))) throw new Error('Root contains empty or traversal segments');
  if (value === '/' || value === '~/' || /^\/(?:etc|bin|sbin|usr|proc|sys|dev|boot|run)(?:\/|$)/.test(value) || /^\/(?:root|home|var|opt|tmp|srv)$/.test(value)) throw new Error('Unsafe deployment root');
}
export function validateServer(server: Server): void {
  if (!clean(server.host) || !/^[a-zA-Z0-9][a-zA-Z0-9._:%-]*$/.test(server.host) || server.host.length > 253) throw new Error('Invalid SSH host or alias');
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) throw new Error('Invalid SSH port');
  if (server.username !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(server.username)) throw new Error('Invalid SSH username');
  if (server.identityFile !== undefined && (!clean(server.identityFile) || !path.isAbsolute(server.identityFile))) throw new Error('Identity file must be an absolute local path');
  validateRoot(server.root);
}
export function validateStatic(request: StaticDeploy): void {
  validateName(request.app);
  if (!clean(request.source) || !request.source) throw new Error('Source directory is required');
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) throw new Error('Invalid deployment port');
  if (!['127.0.0.1', '0.0.0.0'].includes(request.bindAddress)) throw new Error('Invalid bind address');
  if (typeof request.spa !== 'boolean') throw new Error('Invalid SPA option');
  if (!clean(request.image) || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(request.image)) throw new Error('Invalid image reference');
}
export function validateCompose(request: ComposeImport): void {
  validateName(request.project);
  validateRoot(request.directory);
  if (!Array.isArray(request.files) || request.files.length < 1 || request.files.length > 16) throw new Error('Specify 1–16 ordered Compose files');
  for (const file of request.files) {
    if (!clean(file) || file.startsWith('/') || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Compose files must be safe paths relative to the project directory');
  }
}

/** Best effort for logs, never a guarantee for arbitrary application output. */
export function redact(value: string): string {
  return value
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|secret|password|signature)=)[^&#\s]+/gi, '$1[REDACTED]');
}
