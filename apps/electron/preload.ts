import { contextBridge, ipcRenderer } from 'electron';
import type { DockloomAPI } from '../../packages/shared/types';
const methods = ['listServers', 'saveServer', 'removeServer', 'sshAliases', 'inspect', 'logs', 'action', 'chooseDirectory', 'chooseKey', 'plan', 'deploy', 'planCompose', 'deployCompose', 'releases', 'rollback', 'jobs', 'job', 'importCompose', 'openExternal'] as const;
const api = Object.fromEntries(methods.map(method => [method, (...args: unknown[]) => ipcRenderer.invoke(`dockloom:${method}`, ...args)])) as unknown as DockloomAPI;
contextBridge.exposeInMainWorld('dockloom', api);
