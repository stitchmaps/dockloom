import type { DockloomAPI, Server, Snapshot, Job, Release, StaticDeploy, Container } from '../shared/types';

const now = () => new Date().toISOString();
const sleep = () => new Promise(r => setTimeout(r, 180));
let servers: Server[] = [
  { id: 'demo-production', name: 'Production', host: 'production.example.com', port: 22, username: 'deploy', root: '/home/deploy/apps', useSshConfig: false },
  { id: 'demo-staging', name: 'Staging', host: 'staging.example.com', port: 22, username: 'deploy', root: '/home/deploy/apps', useSshConfig: false },
];
const demoContainer = (name: string, project: string, service: string, port: string, image: string, state = 'running'): Container => ({
  id: name, name, project, service, ports: port, image, state,
  status: state === 'running' ? 'Up 2 days' : 'Exited (0)', health: 'none',
  workingDir: `/home/deploy/apps/${project}`, configFiles: [`/home/deploy/apps/${project}/compose.yaml`],
});
const containers = new Map<string, Container[]>([
  ['demo-production', [demoContainer('portfolio-web-1', 'portfolio', 'web', '0.0.0.0:8080 → 80/tcp', 'nginx:alpine'), demoContainer('notes-api-1', 'notes', 'api', '0.0.0.0:3000 → 3000/tcp', 'example/notes:1.4'), demoContainer('notes-db-1', 'notes', 'db', '5432/tcp', 'postgres:17-alpine'), demoContainer('status-web-1', 'status', 'web', '0.0.0.0:8082 → 80/tcp', 'nginx:alpine'), demoContainer('sandbox-worker-1', 'sandbox', 'worker', '—', 'example/worker:0.2', 'exited')]],
  ['demo-staging', [demoContainer('preview-web-1', 'preview', 'web', '0.0.0.0:8080 → 80/tcp', 'nginx:alpine')]],
]);
const releases = new Map<string, Release[]>();
const jobs = new Map<string, Job[]>();
function server(id: string) { const s = servers.find(s => s.id === id); if (!s) throw new Error('Server not found'); return s; }
function makeJob(id: string, app: string, action: string): Job {
  const job: Job = { id: `demo-${Date.now()}`, app, status: 'running', stage: 'prepare', createdAt: now(), log: `[DEMO] ${action}\nPreparing sample release…\n` };
  jobs.set(id, [job, ...(jobs.get(id) ?? [])]);
  setTimeout(() => { job.status = 'succeeded'; job.stage = 'complete'; job.log += '[DEMO] Upload verified. Service healthy. Simulation complete.\n'; }, 2200);
  return structuredClone(job);
}
export const demoAPI: DockloomAPI = {
  async listServers() { await sleep(); return structuredClone(servers); },
  async saveServer(s) { servers = [...servers.filter(x => x.id !== s.id), s]; containers.set(s.id, containers.get(s.id) ?? []); return structuredClone(s); },
  async removeServer(id) { servers = servers.filter(s => s.id !== id); },
  async sshAliases() { return ['production', 'staging']; },
  async inspect(id) {
    await sleep(); const s = server(id);
    const snapshot: Snapshot = { hostname: s.name.toLowerCase(), os: 'Ubuntu 24.04 LTS (demo)', arch: 'x86_64', dockerVersion: '27.5.1', composeVersion: '2.32.4', cpus: 4, load: .18, memoryTotal: 8 * 1024 ** 3, memoryAvailable: 5.7 * 1024 ** 3, diskTotal: 80 * 1024 ** 3, diskAvailable: 54.2 * 1024 ** 3, root: s.root, containers: containers.get(id) ?? [], capabilities: ['SSH', 'Docker', 'Compose v2', 'Python 3', 'Deployment directory'].map(name => ({ name, ok: true, detail: 'Demo fixture' })), fetchedAt: now() };
    return structuredClone(snapshot);
  },
  async logs(_id, name) { await sleep(); return `[DEMO · ${name}]\n2026-01-01T10:00:00Z Starting service\n2026-01-01T10:00:01Z Ready to accept connections\n2026-01-01T10:01:12Z GET / 200 14ms\n2026-01-01T10:01:33Z GET /assets/index.js 200 3ms\n`; },
  async action(id, cid, action) { const c = containers.get(id)?.find(c => c.id === cid); if (c) { c.state = action === 'stop' ? 'exited' : 'running'; c.status = action === 'stop' ? 'Exited (0)' : 'Up a few seconds'; } await sleep(); },
  async chooseDirectory() { return 'C:/examples/my-website/dist'; },
  async chooseKey() { return 'C:/Users/example/.ssh/id_ed25519'; },
  async plan(id, req) { server(id); if (!/^[a-z][a-z0-9-]{0,39}$/.test(req.app)) throw new Error('Use a lowercase application name'); if (!req.source) throw new Error('Choose a build directory'); return { fileCount: 12, bytes: 284900, target: `${server(id).root}/${req.app}`, summary: ['DEMO: no files will be uploaded', `Application: ${req.app}`, `Port: ${req.port}`, `Mode: ${req.spa ? 'SPA' : 'Static'}`] }; },
  async deploy(id, req: StaticDeploy) {
    const job = makeJob(id, req.app, 'Deploy');
    const list = releases.get(id) ?? []; list.filter(r => r.app === req.app).forEach(r => { r.current = false; });
    list.unshift({ id: job.id, app: req.app, createdAt: now(), port: req.port, current: true, image: req.image, status: 'succeeded' }); releases.set(id, list);
    const existing = (containers.get(id) ?? []).filter(c => c.project !== req.app);
    containers.set(id, [...existing, demoContainer(`${req.app}-web-1`, req.app, 'web', `0.0.0.0:${req.port} → 80/tcp`, req.image)]);
    return job;
  },
  async releases(id) { return structuredClone(releases.get(id) ?? []); },
  async planCompose(id, req) {
    server(id);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(req.app) || !req.source || !req.files.length) throw new Error('Application, directory and Compose files are required');
    return { fileCount: 4, bytes: 3400, target: `${server(id).root}/.dockloom/apps/${req.app}`, services: ['web', 'db'], warnings: ['DEMO: named volumes survive release rollback. Database changes are not rolled back.'], summary: ['DEMO: no real upload or deployment', `Compose files: ${req.files.join(', ')}`, 'Two-service stack with health verification'] };
  },
  async deployCompose(id, req) {
    const job = makeJob(id, req.app, 'Compose deploy');
    const list = releases.get(id) ?? []; list.filter(r => r.app === req.app).forEach(r => { r.current = false; });
    list.unshift({ id: job.id, app: req.app, kind: 'compose', services: ['web', 'db'], createdAt: now(), port: 0, current: true, image: 'compose', status: 'succeeded' }); releases.set(id, list);
    containers.set(id, [...(containers.get(id) ?? []).filter(c => c.project !== req.app), demoContainer(`${req.app}-web-1`, req.app, 'web', '0.0.0.0:8080 → 80/tcp', 'nginx:alpine'), demoContainer(`${req.app}-db-1`, req.app, 'db', '5432/tcp', 'postgres:17-alpine')]);
    return job;
  },
  async rollback(id, app, release) { const target = releases.get(id)?.find(r => r.app === app && r.id === release); if (!target) throw new Error('Release not found'); releases.get(id)?.filter(r => r.app === app).forEach(r => { r.current = r.id === release; }); return makeJob(id, app, 'Rollback'); },
  async jobs(id) { return structuredClone(jobs.get(id) ?? []); },
  async job(id, jid) { const j = jobs.get(id)?.find(j => j.id === jid); if (!j) throw new Error('Job not found'); return structuredClone(j); },
  async importCompose(_id, req) { return `[DEMO] Validated ${req.project}\n${req.files.join('\n')}\nNo remote configuration changed.`; },
  async openExternal(url) { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
};
