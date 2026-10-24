export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  identityFile?: string;
  root: string;
  useSshConfig: boolean;
}
export interface Container {
  id: string; name: string; image: string; state: string; status: string;
  project: string; service: string; ports: string; health: string;
  workingDir: string; configFiles: string[];
}
export interface Snapshot {
  hostname: string; os: string; arch: string; dockerVersion: string; composeVersion: string;
  cpus: number; load: number; memoryTotal: number; memoryAvailable: number;
  diskTotal: number; diskAvailable: number; root: string;
  containers: Container[]; capabilities: { name: string; ok: boolean; detail: string }[];
  fetchedAt: string;
}
export interface StaticDeploy {
  app: string; source: string; port: number; spa: boolean; image: string;
  bindAddress: '0.0.0.0' | '127.0.0.1';
}
export interface Release {
  id: string; app: string; createdAt: string; port: number; current: boolean;
  image: string; status: string;
}
export interface Job {
  id: string; app: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  stage: string; log: string; createdAt: string;
}
export interface DeployPlan { fileCount: number; bytes: number; target: string; summary: string[] }
export interface ComposeImport { directory: string; files: string[]; project: string }
export type ContainerAction = 'start' | 'stop' | 'restart';
export interface DockloomAPI {
  listServers(): Promise<Server[]>;
  saveServer(server: Server): Promise<Server>;
  removeServer(id: string): Promise<void>;
  sshAliases(): Promise<string[]>;
  inspect(id: string): Promise<Snapshot>;
  logs(id: string, containerId: string): Promise<string>;
  action(id: string, containerId: string, action: ContainerAction): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  chooseKey(): Promise<string | null>;
  plan(id: string, request: StaticDeploy): Promise<DeployPlan>;
  deploy(id: string, request: StaticDeploy): Promise<Job>;
  releases(id: string): Promise<Release[]>;
  rollback(id: string, app: string, release: string): Promise<Job>;
  jobs(id: string): Promise<Job[]>;
  job(id: string, job: string): Promise<Job>;
  importCompose(id: string, request: ComposeImport): Promise<string>;
  openExternal(url: string): Promise<void>;
}
declare global { interface Window { dockloom?: DockloomAPI } }
