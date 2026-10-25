import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownToLine, ArrowRight, Box, ChevronDown, ChevronRight, CircleCheck, Cpu, Database, FileCode2, Folder, Globe2, HardDrive, Layers3, LayoutGrid, Loader2, Network, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Server as ServerIcon, Settings2, ShieldCheck, Square, Terminal, Trash2, X } from 'lucide-react';
import type { Container, ContainerAction, DockloomAPI, Job, Release, Server, Snapshot } from '../../packages/shared/types';
import { demoAPI } from '../../packages/demo/api';
import { dictionary, initialLanguage, type Language, type Translate, type TranslationKey } from './i18n';
import { ComposeDeployDialog, ComposeDialog, DeployDialog, ServerDialog, TrustNote, type Run } from './dialogs';
import { bytes, date, Definition, Empty, errorText, ErrorNotice, isActive, Loading, Modal, Status, Toast, useRemote } from './ui';
import './styles.css';

type Page = 'servers' | 'applications' | 'deployments' | 'settings';
const pages = [{ id: 'servers', icon: ServerIcon }, { id: 'applications', icon: LayoutGrid }, { id: 'deployments', icon: Layers3 }, { id: 'settings', icon: Settings2 }] as const;

function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [demo, setDemo] = useState(!window.dockloom);
  const t: Translate = key => dictionary[language][key];
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem('dockloom.language', language); } catch { /* Storage may be disabled. */ }
  }, [language]);
  return <Workspace key={demo ? 'demo' : 'desktop'} api={demo ? demoAPI : (window.dockloom ?? demoAPI)} demo={demo} setDemo={setDemo} language={language} setLanguage={setLanguage} t={t} />;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Layers3 size={23} strokeWidth={1.7} /></span><span>Dockloom<small>v0.2 alpha</small></span></div>;
}

function Workspace({ api, demo, setDemo, language, setLanguage, t }: { api: DockloomAPI; demo: boolean; setDemo: (value: boolean) => void; language: Language; setLanguage: (value: Language) => void; t: Translate }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState('');
  const [page, setPage] = useState<Page>('applications');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [listRevision, setListRevision] = useState(0);
  const [serverDialog, setServerDialog] = useState<Server | 'new'>();
  const [remove, setRemove] = useState<Server>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [hasActiveJob, setHasActiveJob] = useState(false);
  const server = servers.find(item => item.id === serverId);
  useEffect(() => {
    let current = true;
    setListLoading(true); setListError('');
    api.listServers().then(items => {
      if (!current) return;
      setServers(items);
      setServerId(id => items.some(item => item.id === id) ? id : items[0]?.id ?? '');
    }).catch(reason => { if (current) setListError(errorText(reason)); })
      .finally(() => { if (current) setListLoading(false); });
    return () => { current = false; };
  }, [api, listRevision]);
  const run: Run = async action => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); return true; }
    catch (reason) { setError(errorText(reason)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openServer = (value: Server | 'new') => { setError(''); setServerDialog(value); };
  const modeControl = <label className="switch-row"><span>{t('demo')}<small>{window.dockloom ? t('demoToggleNote') : t('browserDemo')}</small></span><input type="checkbox" role="switch" aria-label={t('demo')} checked={demo} disabled={!window.dockloom || busy || hasActiveJob} onChange={e => setDemo(e.target.checked)} /></label>;
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label"><span className="workspace-avatar">D</span><span>{t('workspace')}<small>{t('localFirst')}</small></span></div>
      <nav aria-label={t('workspace')}>{pages.map(({ id, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'selected' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setError(''); }}><Icon size={17} /><span>{t(id)}</span>{id === 'servers' && <span className="nav-count">{servers.length}</span>}</button>)}</nav>
      <div className="sidebar-section-title"><span>{t('infrastructure')}</span><button className="icon-button" disabled={busy} onClick={() => openServer('new')} aria-label={t('addServer')}><Plus size={15} /></button></div>
      <div className="server-list">
        {listLoading ? <Loading t={t} /> : listError ? <ErrorNotice error={listError} retry={() => setListRevision(n => n + 1)} t={t} /> : servers.map(item => <button className={`server-item ${item.id === serverId ? 'selected' : ''}`} key={item.id} disabled={busy} aria-pressed={item.id === serverId} onClick={() => { setServerId(item.id); setError(''); }}><ServerIcon size={17} /><span>{item.name}<small>{item.host}</small></span>{item.id === serverId && <ChevronRight size={14} />}</button>)}
        <button className="add-server" disabled={busy} onClick={() => openServer('new')}><Plus size={15} />{t('addServer')}</button>
      </div>
      <div className="sidebar-footer"><div className={demo ? 'mode-label demo' : 'mode-label'}><span className="status-dot" />{demo ? t('demo') : t('live')}</div><p>{demo ? t('demoNote') : t('localFirst')}</p><div className="sidebar-bottom"><span className="mono">v0.2 alpha</span><button className="text-button language-button" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} aria-label={t('language')}><Globe2 size={14} />{language === 'zh' ? 'English' : '中文'}</button></div></div>
    </aside>
    <main className="main">
      <div className="topbar"><div className="breadcrumbs"><span>{t('workspace')}</span><ChevronRight size={13} /><span>{server?.name ?? t('servers')}</span><ChevronRight size={13} /><strong>{t(page)}</strong></div><div className="topbar-right">{busy && <Loader2 size={15} className="spin" />}{demo ? <span className="demo-badge">{t('demo')}</span> : <span className="tag"><ShieldCheck size={12} />SSH</span>}<span className="version">v0.2 alpha</span></div></div>
      {demo && <div className="demo-banner"><Globe2 size={14} /><span>{t('demoNote')}</span></div>}
      {!serverDialog && !remove && <ErrorNotice error={error} t={t} />}
      {page === 'settings' ? <div className="page-content"><PageHeading page={page} t={t} /><div className="settings-panel"><section><h2>{t('workspace')}</h2><div className="setting-row"><div><strong>{t('language')}</strong><p>{t('languageNote')}</p></div><select aria-label={t('language')} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="zh">简体中文</option><option value="en">English</option></select></div><div className="setting-row">{modeControl}</div></section>{server && <section><h2>{t('connectedTo')}</h2><dl><Definition label={t('name')}>{server.name}</Definition><Definition label={t('host')}><code>{server.host}:{server.port}</code></Definition><Definition label={t('root')}><code>{server.root}</code></Definition></dl><div className="button-row"><button disabled={busy || hasActiveJob} onClick={() => openServer(server)}><Settings2 size={15} />{t('editServer')}</button><button className="danger-quiet" disabled={busy || hasActiveJob} onClick={() => { setError(''); setRemove(server); }}><Trash2 size={15} />{t('removeServer')}</button></div>{!demo && <TrustNote server={server} t={t} />}</section>}</div></div> : listLoading ? <Loading t={t} /> : listError ? <div className="page-content"><ErrorNotice title={t('serverListError')} error={listError} retry={() => setListRevision(n => n + 1)} t={t} /></div> : !server ? <div className="onboarding"><span className="onboarding-mark"><Network size={48} strokeWidth={1} /></span><span className="eyebrow">DOCKLOOM / SSH WORKSPACE</span><h1>{t('welcome')}</h1><p>{t('welcomeNote')}</p><button className="primary" disabled={busy} onClick={() => openServer('new')}><Plus size={17} />{t('addServer')}</button><small>{t('sshHint')}</small>{window.dockloom && <div className="onboarding-mode">{modeControl}</div>}</div> : null}
      {server && !listLoading && !listError && <ServerView key={JSON.stringify(server)} api={api} server={server} page={page} t={t} language={language} demo={demo} busy={busy} error={error} run={run} clearError={() => setError('')} notify={setToast} onPage={setPage} onEdit={() => openServer(server)} onActive={setHasActiveJob} />}
    </main>
    {serverDialog && <ServerDialog api={api} initial={serverDialog === 'new' ? undefined : serverDialog} t={t} busy={busy} error={error} run={run} demo={demo} onClose={() => { setServerDialog(undefined); setError(''); }} onSaved={saved => { setServers(items => [...items.filter(item => item.id !== saved.id), saved]); setServerId(saved.id); setToast(t('serverSaved')); }} />}
    {remove && <Modal title={t('removeServer')} t={t} busy={busy} onClose={() => { setRemove(undefined); setError(''); }}><div className="modal-body"><p>{t('removeNote')}</p><div className="target-server"><ServerIcon size={17} /><strong>{remove.name}</strong><code>{remove.host}</code></div><ErrorNotice error={error} t={t} /></div><footer className="modal-footer"><button disabled={busy} onClick={() => setRemove(undefined)}>{t('cancel')}</button><button className="danger" disabled={busy} onClick={() => void run(async () => { await api.removeServer(remove.id); const remaining = servers.filter(item => item.id !== remove.id); setServers(remaining); setServerId(remaining[0]?.id ?? ''); setRemove(undefined); setToast(t('removed')); })}>{busy ? t('saving') : t('removeServer')}</button></footer></Modal>}
    {toast && <Toast message={toast} close={() => setToast('')} t={t} />}
  </div>;
}

function PageHeading({ page, t, children }: { page: Page; t: Translate; children?: ReactNode }) {
  return <header className="page-heading"><div><h1>{t(page)}</h1><p>{t(`${page}Subtitle` as TranslationKey)}</p></div><div className="button-row">{children}</div></header>;
}

function useJobs(api: DockloomAPI, serverId: string, revision: number, onComplete: () => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const completed = useRef(onComplete); completed.current = onComplete;
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    let previous: Job[] = [];
    setLoading(true);
    async function poll() {
      try {
        const result = await api.jobs(serverId);
        if (!current) return;
        setJobs(result); setError('');
        if (previous.some(job => isActive(job.status) && result.some(next => next.id === job.id && !isActive(next.status)))) completed.current();
        previous = result;
      } catch (reason) { if (current) setError(errorText(reason)); }
      finally { if (current) { setLoading(false); timer = setTimeout(poll, 2500); } }
    }
    void poll();
    return () => { current = false; clearTimeout(timer); };
  }, [api, serverId, revision]);
  return { jobs, loading, error };
}

function ServerView({ api, server, page, t, language, demo, busy, error, run, clearError, notify, onPage, onEdit, onActive }: { api: DockloomAPI; server: Server; page: Page; t: Translate; language: Language; demo: boolean; busy: boolean; error: string; run: Run; clearError: () => void; notify: (message: string) => void; onPage: (page: Page) => void; onEdit: () => void; onActive: (active: boolean) => void }) {
  const [revision, setRevision] = useState(0);
  const snapshot = useRemote(() => api.inspect(server.id), [api, server, revision]);
  const releases = useRemote(() => api.releases(server.id), [api, server.id, revision]);
  const jobs = useJobs(api, server.id, revision, () => { snapshot.reload(); releases.reload(); });
  const [expectedJob, setExpectedJob] = useState('');
  const [selectedJob, setSelectedJob] = useState('');
  const [selectedContainer, setSelectedContainer] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState<'deploy' | 'compose' | 'composeDeploy'>();
  const [confirmation, setConfirmation] = useState<{ kind: 'action'; container: Container; action: ContainerAction } | { kind: 'rollback'; release: Release }>();
  const active = jobs.jobs.some(job => isActive(job.status)) || Boolean(expectedJob && !jobs.jobs.some(job => job.id === expectedJob && !isActive(job.status)));
  useEffect(() => { onActive(active); return () => onActive(false); }, [active, onActive]);
  const disabled = busy || active || jobs.loading || Boolean(jobs.error);
  const deployDisabled = disabled || snapshot.loading || !snapshot.data;
  const container = snapshot.data?.containers.find(item => item.id === selectedContainer);
  const refresh = () => setRevision(value => value + 1);
  const started = (id: string) => { setExpectedJob(id); setSelectedJob(id); onPage('deployments'); refresh(); notify(t('startedJob')); };
  const open = (value: 'deploy' | 'compose' | 'composeDeploy') => { clearError(); setDialog(value); };
  const close = () => { clearError(); setDialog(undefined); setConfirmation(undefined); };
  return <div className="server-view" hidden={page === 'settings'}>
    <div className="page-content">
      <PageHeading page={page} t={t}><button className="icon-button refresh-button" disabled={busy || snapshot.loading || jobs.loading} onClick={refresh} title={t('refreshAll')} aria-label={t('refreshAll')}><RefreshCw size={16} className={snapshot.loading ? 'spin' : ''} /></button>{page === 'servers' ? <button disabled={disabled} onClick={onEdit}><Settings2 size={15} />{t('editServer')}</button> : <button disabled={deployDisabled} onClick={() => open('compose')}><FileCode2 size={15} />{t('importCompose')}</button>}<button disabled={deployDisabled} onClick={() => open('composeDeploy')}><Rocket size={15} />{t('deployCompose')}</button><button className="primary" disabled={deployDisabled} onClick={() => open('deploy')}><Plus size={16} />{t('deploy')}</button></PageHeading>
      <div className="server-context"><span className="server-context-icon"><ServerIcon size={19} /></span><strong>{server.name}</strong><span className="mono">{server.useSshConfig ? server.host : `${server.username ? `${server.username}@` : ''}${server.host}`}</span><span className="context-separator" />{snapshot.data ? <span>{snapshot.data.os} <span className="subtle">/ {snapshot.data.arch}</span></span> : <span className="subtle">{snapshot.loading ? t('loading') : t('connectionPending')}</span>}</div>
      {snapshot.loading ? <div className="resource-loading"><Loading t={t} /></div> : snapshot.error ? <><ErrorNotice title={t('inspectionError')} error={snapshot.error} retry={snapshot.reload} t={t} />{!demo && <TrustNote server={server} t={t} />}</> : snapshot.data && <ResourceStrip snapshot={snapshot.data} t={t} language={language} />}
      {active && <div className="activity-banner" role="status"><Loader2 size={14} className="spin" />{t('operationActive')}<button className="text-button" onClick={() => onPage('deployments')}>{t('jobs')}<ArrowRight size={14} /></button></div>}
      <ErrorNotice title={t('jobsError')} error={jobs.error} retry={refresh} t={t} />
      {page === 'servers' && snapshot.data && <ServerOverview server={server} snapshot={snapshot.data} t={t} demo={demo} />}
      {page === 'applications' && snapshot.data && <>
        <div className="section-tabs"><span className="active"><Box size={15} />{t('containers')}<b>{snapshot.data.containers.length}</b></span><span>{new Set(snapshot.data.containers.map(item => item.project || '')).size} {t('projects')}</span></div>
        <div className={`application-layout ${container ? 'with-detail' : ''}`}>
          <section className="application-list"><div className="table-toolbar"><label className="search"><Search size={16} /><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" onClick={() => setQuery('')} aria-label={t('clearFilters')}><X size={14} /></button>}</label><select aria-label={t('status')} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t('all')}</option><option value="running">{t('running')}</option><option value="stopped">{t('stopped')}</option></select></div>
            <ContainerTable containers={snapshot.data.containers} query={query} filter={filter} selected={selectedContainer} onSelect={setSelectedContainer} t={t} onClear={() => { setQuery(''); setFilter('all'); }} onDeploy={() => open('deploy')} disabled={deployDisabled} />
          </section>
          {container && <ContainerDetail key={container.id} api={api} serverId={server.id} container={container} t={t} disabled={disabled || snapshot.loading} revision={revision} onClose={() => setSelectedContainer('')} onAction={action => { clearError(); setConfirmation({ kind: 'action', container, action }); }} />}
        </div>
      </>}
      {page === 'deployments' && <div className="deployments-layout"><section className="deployment-main"><div className="section-title"><h2><Layers3 size={16} />{t('jobs')}<span className="tag">{jobs.jobs.length}</span></h2><span className="subtle small"><span className="status-dot" />{t('autoRefresh')}</span></div>{jobs.loading && !jobs.jobs.length ? <Loading t={t} /> : !jobs.jobs.length ? <Empty title={t('noJobs')} description={t('noJobsNote')} /> : <div className="jobs-list">{jobs.jobs.map(job => <button key={job.id} className={`job-row ${selectedJob === job.id ? 'selected' : ''}`} onClick={() => setSelectedJob(job.id)}><span className="job-icon">{isActive(job.status) ? <Loader2 size={17} className="spin" /> : <ArrowDownToLine size={17} />}</span><span className="job-name"><strong>{job.app}</strong><small className="mono">{job.id}</small></span><span className="job-stage">{job.stage}</span><Status value={job.status} t={t} /><time>{date(job.createdAt, language)}</time><ChevronRight size={14} /></button>)}</div>}
        <div className="section-title releases-title"><h2><RotateCcw size={16} />{t('releases')}</h2></div><ErrorNotice error={releases.error} title={t('releasesError')} retry={releases.reload} t={t} />{releases.loading ? <Loading t={t} /> : releases.data && !releases.data.length ? <Empty title={t('noReleases')} description={t('noReleasesNote')} /> : releases.data && <div className="table-scroll"><table className="releases-table"><thead><tr><th>{t('appName')}</th><th>{t('release')}</th><th>{t('createdAt')}</th><th>{t('status')}</th><th><span className="sr-only">{t('rollback')}</span></th></tr></thead><tbody>{releases.data.map(release => <tr key={`${release.app}/${release.id}`}><td><strong>{release.app}</strong><small className="mono">{release.kind === 'compose' || release.port === 0 ? `Compose${release.services?.length ? ` · ${release.services.join(', ')}` : ''}` : `${release.image} · :${release.port}`}</small></td><td className="mono">{release.id}</td><td>{date(release.createdAt, language)}</td><td>{release.current ? <span className="tag current"><CircleCheck size={12} />{t('current')}</span> : <Status value={release.status} t={t} />}</td><td><button disabled={disabled || release.current || releases.loading} onClick={() => { clearError(); setConfirmation({ kind: 'rollback', release }); }}><RotateCcw size={13} />{t('rollback')}</button></td></tr>)}</tbody></table></div>}</section>
        {selectedJob && <JobDetail key={selectedJob} api={api} serverId={server.id} jobId={selectedJob} t={t} language={language} onClose={() => setSelectedJob('')} />}
      </div>}
    </div>
    {dialog === 'deploy' && <DeployDialog api={api} server={server} t={t} busy={busy} error={error} run={run} onClose={close} demo={demo} onStarted={started} />}
    {dialog === 'composeDeploy' && <ComposeDeployDialog api={api} server={server} t={t} busy={busy} error={error} run={run} onClose={close} demo={demo} onStarted={started} />}
    {dialog === 'compose' && <ComposeDialog api={api} server={server} t={t} busy={busy} error={error} run={run} onClose={close} demo={demo} />}
    {confirmation && <Modal title={confirmation.kind === 'action' ? t('confirmAction') : t('rollbackTitle')} t={t} busy={busy} onClose={close}><div className="modal-body"><p>{confirmation.kind === 'action' ? t('actionNote') : t('rollbackNote')}</p>{confirmation.kind === 'rollback' && (confirmation.release.kind === 'compose' || confirmation.release.port === 0) && <p className="hint">{t('composeDataNote')}</p>}<dl className="plan-details"><Definition label={t('connectedTo')}>{server.name} <code>{server.host}</code></Definition>{confirmation.kind === 'action' ? <><Definition label={t('container')}><code>{confirmation.container.name}</code></Definition><Definition label={t('confirm')}>{t(confirmation.action)}</Definition></> : <><Definition label={t('appName')}>{confirmation.release.app}</Definition><Definition label={t('release')}><code>{confirmation.release.id}</code></Definition></>}</dl>{demo && <p className="hint">{t('demoNote')}</p>}<ErrorNotice error={error} t={t} /></div><footer className="modal-footer"><button disabled={busy} onClick={close}>{t('cancel')}</button><button className={confirmation.kind === 'action' && confirmation.action === 'stop' ? 'danger' : 'primary'} disabled={disabled} onClick={() => void run(async () => { if (confirmation.kind === 'action') { await api.action(server.id, confirmation.container.id, confirmation.action); refresh(); notify(t('actionDone')); } else { const job = await api.rollback(server.id, confirmation.release.app, confirmation.release.id); started(job.id); } close(); })}>{busy ? t('saving') : t('confirm')}</button></footer></Modal>}
  </div>;
}

function ResourceStrip({ snapshot, t, language }: { snapshot: Snapshot; t: Translate; language: Language }) {
  const usage = (total: number, available: number) => total > 0 ? Math.max(0, Math.min(100, (total - available) / total * 100)) : 0;
  const memory = usage(snapshot.memoryTotal, snapshot.memoryAvailable);
  const disk = usage(snapshot.diskTotal, snapshot.diskAvailable);
  return <div className="resource-strip"><div className="resource"><span><Cpu size={14} />{t('load')}</span><strong>{Number.isFinite(snapshot.load) ? snapshot.load.toFixed(2) : '—'}<small>/ {snapshot.cpus} {t('cores')}</small></strong><p>{snapshot.hostname}</p></div><div className="resource"><span><Database size={14} />{t('memory')}</span><strong>{bytes(Math.max(0, snapshot.memoryTotal - snapshot.memoryAvailable))}<small>/ {bytes(snapshot.memoryTotal)}</small></strong><div className="meter" role="meter" aria-label={t('memory')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(memory)}><i style={{ width: `${memory}%` }} /></div></div><div className="resource"><span><HardDrive size={14} />{t('disk')}</span><strong>{bytes(Math.max(0, snapshot.diskTotal - snapshot.diskAvailable))}<small>/ {bytes(snapshot.diskTotal)}</small></strong><div className="meter" role="meter" aria-label={t('disk')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(disk)}><i style={{ width: `${disk}%` }} /></div></div><div className="resource"><span><Box size={14} />{t('containers')}</span><strong>{snapshot.containers.filter(container => container.state === 'running').length}<small>/ {snapshot.containers.length} {t('running')}</small></strong><p>{t('sampled')} {date(snapshot.fetchedAt, language)}</p></div></div>;
}

function ServerOverview({ server, snapshot, t, demo }: { server: Server; snapshot: Snapshot; t: Translate; demo: boolean }) {
  return <div className="server-overview"><section><div className="section-title"><h2><Network size={16} />{t('connection')}</h2></div><dl><Definition label={t('host')}><code>{server.host}</code></Definition><Definition label={t('port')}>{server.port}</Definition><Definition label={t('username')}>{server.username ?? t('emptyValue')}</Definition><Definition label={t('configMode')}>{server.useSshConfig ? t('sshAlias') : t('manual')}</Definition><Definition label={t('root')}><code>{server.root}</code></Definition></dl>{!demo && <TrustNote server={server} t={t} />}</section><section><div className="section-title"><h2><Box size={16} />{t('environment')}</h2></div><dl><Definition label="OS">{snapshot.os} / {snapshot.arch}</Definition><Definition label="Docker">{snapshot.dockerVersion}</Definition><Definition label="Compose">{snapshot.composeVersion}</Definition></dl><h3>{t('capabilities')}</h3><ul className="capability-list">{snapshot.capabilities.map((item, index) => <li key={`${item.name}-${index}`}><span className={`status-dot ${item.ok ? 'good' : 'bad'}`} /><span><strong>{item.name}</strong><small>{item.detail}</small></span><span className="subtle">{item.ok ? t('available') : t('notAvailable')}</span></li>)}</ul></section></div>;
}

function ContainerTable({ containers, query, filter, selected, onSelect, t, onClear, onDeploy, disabled }: { containers: Container[]; query: string; filter: string; selected: string; onSelect: (id: string) => void; t: Translate; onClear: () => void; onDeploy: () => void; disabled: boolean }) {
  const visible = containers.filter(container => `${container.project} ${container.name} ${container.image} ${container.service}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'running' ? container.state === 'running' : container.state !== 'running')));
  const groups = new Map<string, Container[]>();
  visible.forEach(container => { const key = container.project || ''; groups.set(key, [...(groups.get(key) ?? []), container]); });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!containers.length) return <Empty title={t('noContainers')} description={t('noContainersNote')}><button className="primary" disabled={disabled} onClick={onDeploy}><Plus size={16} />{t('deploy')}</button></Empty>;
  if (!visible.length) return <Empty title={t('noMatches')} description={t('noMatchesNote')}><button onClick={onClear}>{t('clearFilters')}</button></Empty>;
  return <div className="table-scroll"><table className="containers-table"><thead><tr><th>{t('container')}</th><th>{t('status')}</th><th>{t('image')}</th><th>{t('ports')}</th><th><span className="sr-only">{t('details')}</span></th></tr></thead>{[...groups].map(([project, items]) => <tbody key={project}><tr className="group-row"><td colSpan={5}><button aria-expanded={!collapsed.has(project)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(project)) next.delete(project); else next.add(project); return next; })}>{collapsed.has(project) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<Folder size={14} /><strong>{project || t('ungrouped')}</strong><span className="tag">{items.length}</span></button></td></tr>{!collapsed.has(project) && items.map(container => <tr key={container.id} className={selected === container.id ? 'selected' : ''} onClick={() => onSelect(container.id)}><td><button className="container-name" onClick={event => { event.stopPropagation(); onSelect(container.id); }} aria-pressed={selected === container.id}><span className="container-icon"><Box size={17} /></span><span><strong>{container.name}</strong><small>{container.service || container.id.slice(0, 12)}</small></span></button></td><td><Status value={container.state} t={t} /></td><td className="mono image-cell" title={container.image}>{container.image}</td><td className="mono ports-cell">{container.ports || '—'}</td><td><ChevronRight size={14} /></td></tr>)}</tbody>)}</table></div>;
}

function ContainerDetail({ api, serverId, container, t, disabled, revision, onClose, onAction }: { api: DockloomAPI; serverId: string; container: Container; t: Translate; disabled: boolean; revision: number; onClose: () => void; onAction: (action: ContainerAction) => void }) {
  const logs = useRemote(() => api.logs(serverId, container.id), [api, serverId, container.id, revision]);
  return <aside className="detail-panel"><header><span><Box size={17} />{t('details')}</span><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={16} /></button></header><div className="detail-body"><h2>{container.name}</h2><Status value={container.state} t={t} /><p className="subtle small">{container.status}</p><div className="container-actions"><button disabled={disabled || container.state === 'running'} onClick={() => onAction('start')}><Play size={13} />{t('start')}</button><button disabled={disabled || !['running', 'restarting', 'paused'].includes(container.state)} onClick={() => onAction('stop')}><Square size={12} />{t('stop')}</button><button disabled={disabled} onClick={() => onAction('restart')}><RotateCcw size={13} />{t('restart')}</button></div><dl><Definition label={t('project')}>{container.project || t('ungrouped')}</Definition><Definition label={t('service')}>{container.service}</Definition><Definition label={t('image')}><code>{container.image}</code></Definition><Definition label={t('ports')}><code>{container.ports}</code></Definition><Definition label={t('health')}>{container.health && container.health !== 'none' ? <Status value={container.health} t={t} /> : '—'}</Definition><Definition label={t('workingDir')}><code>{container.workingDir}</code></Definition><Definition label={t('configFiles')}><code>{container.configFiles.join('\n') || '—'}</code></Definition></dl></div><div className="log-heading"><span><Terminal size={14} />{t('logs')}</span><button className="icon-button" aria-label={t('refreshLogs')} title={t('refreshLogs')} disabled={logs.loading} onClick={logs.reload}><RefreshCw size={14} className={logs.loading ? 'spin' : ''} /></button></div>{logs.loading ? <Loading t={t} /> : logs.error ? <ErrorNotice error={logs.error} retry={logs.reload} t={t} /> : <pre className="terminal container-terminal" tabIndex={0} aria-label={t('logs')}>{logs.data || t('noLogs')}</pre>}</aside>;
}

function JobDetail({ api, serverId, jobId, t, language, onClose }: { api: DockloomAPI; serverId: string; jobId: string; t: Translate; language: Language; onClose: () => void }) {
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const value = await api.job(serverId, jobId); if (!current) return; setJob(value); setError(''); if (isActive(value.status)) timer = setTimeout(poll, 1500); }
      catch (reason) { if (current) setError(errorText(reason)); }
    }
    void poll();
    return () => { current = false; clearTimeout(timer); };
  }, [api, serverId, jobId, revision]);
  return <aside className="detail-panel job-detail"><header><span><Terminal size={16} />{t('jobDetails')}</span><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={16} /></button></header><ErrorNotice error={error} retry={() => setRevision(n => n + 1)} t={t} />{!job && !error ? <Loading t={t} /> : job && <><div className="detail-body"><h2>{job.app}</h2><Status value={job.status} t={t} /><dl><Definition label={t('stage')}>{job.stage}</Definition><Definition label={t('createdAt')}>{date(job.createdAt, language)}</Definition></dl><code className="subtle small">{job.id}</code></div><pre className="terminal" tabIndex={0} aria-label={t('jobDetails')}>{job.log || t('noLogs')}</pre></>}</aside>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
