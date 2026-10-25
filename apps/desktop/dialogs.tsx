import { useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FolderOpen, KeyRound, Rocket, ShieldCheck } from 'lucide-react';
import type { ComposeDeploy, ComposeImport, ComposePlan, DeployPlan, DockloomAPI, Server, StaticDeploy } from '../../packages/shared/types';
import type { Translate } from './i18n';
import { bytes, Definition, ErrorNotice, Field, Loading, Modal, useRemote } from './ui';

export type Run = (action: () => Promise<void>) => Promise<boolean>;
type DialogProps = { api: DockloomAPI; t: Translate; busy: boolean; error: string; run: Run; onClose: () => void; demo: boolean };
const submit = (event: FormEvent, action: () => void) => { event.preventDefault(); action(); };
const quote = (value: string) => /^[a-zA-Z0-9_.@:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export function sshCommand(server: Server) {
  return server.useSshConfig ? `ssh ${quote(server.host)}` : `ssh -p ${server.port}${server.identityFile ? ` -i ${quote(server.identityFile)}` : ''} ${quote(`${server.username ? `${server.username}@` : ''}${server.host}`)}`;
}
export function TrustNote({ server, t }: { server: Server; t: Translate }) {
  return <div className="trust-note"><ShieldCheck size={19} /><div><strong>{t('sshTrust')}</strong><p>{t('sshTrustNote')}</p><code>{sshCommand(server)}</code></div></div>;
}

export function ServerDialog({ api, t, busy, error, run, onClose, demo, initial, onSaved }: DialogProps & { initial?: Server; onSaved: (server: Server) => void }) {
  const [form, setForm] = useState<Server>(() => initial ?? { id: crypto.randomUUID(), name: '', host: '', port: 22, username: '', identityFile: '', root: '~/deployments', useSshConfig: false });
  const aliases = useRemote(() => api.sshAliases(), [api]);
  const update = <K extends keyof Server>(key: K, value: Server[K]) => setForm(current => ({ ...current, [key]: value }));
  const save = async () => {
    const ok = await run(async () => {
      const saved = await api.saveServer({ ...form, name: form.name.trim(), host: form.host.trim(), root: form.root.trim(), username: form.username?.trim() || undefined, identityFile: form.identityFile?.trim() || undefined });
      onSaved(saved);
    });
    if (ok) onClose();
  };
  return <Modal title={initial ? t('editServer') : t('newServer')} busy={busy} onClose={onClose} t={t}>
    <form onSubmit={event => submit(event, () => void save())}>
      <div className="modal-body"><ErrorNotice error={error} t={t} />
        <fieldset disabled={busy}>
          <div className="segmented" aria-label={t('configMode')}>
            <button type="button" aria-pressed={!form.useSshConfig} className={!form.useSshConfig ? 'selected' : ''} onClick={() => setForm(s => ({ ...s, useSshConfig: false, host: '' }))}>{t('manual')}</button>
            <button type="button" aria-pressed={form.useSshConfig} className={form.useSshConfig ? 'selected' : ''} onClick={() => setForm(s => ({ ...s, useSshConfig: true, host: aliases.data?.[0] ?? '', port: 22, username: '', identityFile: '' }))}>{t('sshAlias')}</button>
          </div>
          <Field label={t('name')}><input autoFocus required value={form.name} onChange={e => update('name', e.target.value)} placeholder="Production" maxLength={80} /></Field>
          {form.useSshConfig ? <>
            {aliases.loading ? <Loading t={t} /> : aliases.error ? <ErrorNotice error={aliases.error} retry={aliases.reload} t={t} /> : <Field label={t('alias')} hint={aliases.data?.length ? t('aliasNote') : t('noAliases')}>
              <input required list="ssh-host-aliases" value={form.host} onChange={e => update('host', e.target.value)} placeholder="my-server" /><datalist id="ssh-host-aliases">{aliases.data?.map(alias => <option key={alias} value={alias} />)}</datalist>
            </Field>}
          </> : <>
            <div className="form-grid"><Field label={t('host')}><input required value={form.host} onChange={e => update('host', e.target.value)} placeholder="203.0.113.10" /></Field><Field label={t('port')}><input type="number" required min={1} max={65535} value={form.port || ''} onChange={e => update('port', Number(e.target.value))} /></Field></div>
            <Field label={`${t('username')} · ${t('optional')}`}><input value={form.username ?? ''} onChange={e => update('username', e.target.value)} placeholder="deploy" /></Field>
            <Field label={`${t('key')} · ${t('optional')}`} hint={t('keyNote')}><span className="input-action"><input value={form.identityFile ?? ''} onChange={e => update('identityFile', e.target.value)} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={() => void run(async () => { const key = await api.chooseKey(); if (key) update('identityFile', key); })}><KeyRound size={15} />{t('chooseKey')}</button></span></Field>
          </>}
          <Field label={t('root')} hint={t('rootNote')}><input required pattern="(/|~/).*" value={form.root} onChange={e => update('root', e.target.value)} /></Field>
        </fieldset>
        {!demo && form.host && <TrustNote server={form} t={t} />}
        {demo && <p className="hint">{t('demoNote')}</p>}
      </div>
      <footer className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="primary" disabled={busy || !form.host.trim()} type="submit">{busy ? t('saving') : t('save')}<ArrowRight size={15} /></button></footer>
    </form>
  </Modal>;
}

export function DeployDialog({ api, server, t, busy, error, run, onClose, demo, onStarted }: DialogProps & { server: Server; onStarted: (id: string) => void }) {
  const [form, setForm] = useState<StaticDeploy>({ app: '', source: '', port: 8080, spa: true, image: 'nginx:alpine', bindAddress: '127.0.0.1' });
  const [plan, setPlan] = useState<DeployPlan>();
  const update = <K extends keyof StaticDeploy>(key: K, value: StaticDeploy[K]) => setForm(current => ({ ...current, [key]: value }));
  return <Modal title={t('deploy')} busy={busy} onClose={onClose} t={t} wide>
    <form onSubmit={event => submit(event, () => void run(async () => {
      if (!plan) setPlan(await api.plan(server.id, { ...form, app: form.app.trim(), image: form.image.trim() }));
      else { const job = await api.deploy(server.id, form); onStarted(job.id); onClose(); }
    }))}>
      <div className="modal-body"><p className="subtitle">{t('deploySubtitle')}</p>
        <div className="steps"><span className={!plan ? 'active' : 'done'}>{plan ? <Check size={14} /> : <b>1</b>}{t('configure')}</span><i /><span className={plan ? 'active' : ''}><b>2</b>{t('review')}</span><i /><span><b>3</b>{t('execute')}</span></div>
        <div className="target-server"><span className="status-dot" /><strong>{server.name}</strong><code>{server.host}</code>{demo && <span className="demo-badge">{t('demo')}</span>}</div>
        <ErrorNotice error={error} t={t} />
        {!plan ? <fieldset disabled={busy}>
          <Field label={t('appName')} hint={t('appNameHint')}><input autoFocus required pattern="[a-z][a-z0-9-]{0,39}" maxLength={40} value={form.app} onChange={e => update('app', e.target.value)} placeholder="my-website" /></Field>
          <Field label={t('source')} hint={t('directoryHint')}><span className="input-action"><input required readOnly value={form.source} placeholder={t('chooseDirectory')} /><button type="button" onClick={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) update('source', directory); })}><FolderOpen size={16} />{t('chooseDirectory')}</button></span></Field>
          <div className="form-grid"><Field label={t('publishPort')}><input required type="number" min={1} max={65535} value={form.port || ''} onChange={e => update('port', Number(e.target.value))} /></Field><Field label={t('image')}><input required value={form.image} onChange={e => update('image', e.target.value)} /></Field></div>
          <Field label={t('bindAddress')} hint={form.bindAddress === '0.0.0.0' ? t('publicNote') : undefined}><select value={form.bindAddress} onChange={e => update('bindAddress', e.target.value as StaticDeploy['bindAddress'])}><option value="127.0.0.1">{t('localBind')}</option><option value="0.0.0.0">{t('publicBind')}</option></select></Field>
          <label className="check-field"><input type="checkbox" checked={form.spa} onChange={e => update('spa', e.target.checked)} /><span>{t('spa')}<small>{t('spaNote')}</small></span></label>
        </fieldset> : <>
          <dl className="plan-details"><Definition label={t('appName')}>{form.app}</Definition><Definition label={t('source')}><code>{form.source}</code></Definition><Definition label={t('target')}><code>{plan.target}</code></Definition><Definition label={t('files')}>{plan.fileCount}</Definition><Definition label={t('size')}>{bytes(plan.bytes)}</Definition><Definition label={t('ports')}><code>{form.bindAddress}:{form.port}</code></Definition><Definition label={t('image')}><code>{form.image}</code></Definition></dl>
          <ul className="plan-summary">{plan.summary.map((line, index) => <li key={index}><Check size={14} />{line}</li>)}</ul>
          <p className="hint">{demo ? t('demoNote') : t('deployConfirm')}</p>
        </>}
      </div>
      <footer className="modal-footer"><button type="button" disabled={busy} onClick={() => plan ? setPlan(undefined) : onClose()}>{plan && <ArrowLeft size={15} />}{plan ? t('back') : t('cancel')}</button><button type="submit" className="primary" disabled={busy || !form.source}><Rocket size={15} />{busy ? t('saving') : plan ? t('deployNow') : t('plan')}</button></footer>
    </form>
  </Modal>;
}

export function ComposeDeployDialog({ api, server, t, busy, error, run, onClose, demo, onStarted }: DialogProps & { server: Server; onStarted: (id: string) => void }) {
  const [form, setForm] = useState<ComposeDeploy>({ app: '', source: '', files: ['compose.yaml'], envFiles: [], profiles: [], healthTimeout: 120 });
  const [review, setReview] = useState<{ request: ComposeDeploy; plan: ComposePlan }>();
  const update = <K extends keyof ComposeDeploy>(key: K, value: ComposeDeploy[K]) => setForm(current => ({ ...current, [key]: value }));
  const cleanLines = (lines: string[]) => lines.map(line => line.trim()).filter(Boolean);
  const plan = review?.plan;
  const request = review?.request ?? form;
  return <Modal title={t('deployCompose')} busy={busy} onClose={onClose} t={t} wide>
    <form onSubmit={event => submit(event, () => void run(async () => {
      if (!review) {
        const request = { ...form, app: form.app.trim(), files: cleanLines(form.files), envFiles: cleanLines(form.envFiles), profiles: cleanLines(form.profiles) };
        const plan = await api.planCompose(server.id, request);
        setReview({ request, plan });
      } else { const job = await api.deployCompose(server.id, review.request); onStarted(job.id); onClose(); }
    }))}>
      <div className="modal-body"><p className="subtitle">{t('composeDeploySubtitle')}</p>
        <div className="steps"><span className={!plan ? 'active' : 'done'}>{plan ? <Check size={14} /> : <b>1</b>}{t('configure')}</span><i /><span className={plan ? 'active' : ''}><b>2</b>{t('review')}</span><i /><span><b>3</b>{t('execute')}</span></div>
        <div className="target-server"><span className="status-dot" /><strong>{server.name}</strong><code>{server.host}</code>{demo && <span className="demo-badge">{t('demo')}</span>}</div>
        <ErrorNotice error={error} t={t} />
        {!plan ? <fieldset disabled={busy}>
          <Field label={t('appName')} hint={t('appNameHint')}><input autoFocus required pattern="[a-z][a-z0-9-]{0,39}" maxLength={40} value={form.app} onChange={e => update('app', e.target.value)} placeholder="my-stack" /></Field>
          <Field label={t('composeSource')} hint={t('composeSourceHint')}><span className="input-action"><input required readOnly value={form.source} placeholder={t('chooseDirectory')} /><button type="button" onClick={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) update('source', directory); })}><FolderOpen size={16} />{t('chooseDirectory')}</button></span></Field>
          <Field label={t('composeFiles')} hint={t('composeFilesHint')}><textarea required rows={3} value={form.files.join('\n')} onChange={e => update('files', e.target.value.split('\n'))} /></Field>
          <Field label={`${t('composeEnvFiles')} · ${t('optional')}`} hint={t('composeEnvHint')}><textarea rows={2} value={form.envFiles.join('\n')} onChange={e => update('envFiles', e.target.value.split('\n'))} placeholder=".env.production" /></Field>
          <div className="form-grid"><Field label={`${t('composeProfiles')} · ${t('optional')}`}><textarea rows={2} value={form.profiles.join('\n')} onChange={e => update('profiles', e.target.value.split('\n'))} placeholder="production" /></Field><Field label={t('healthTimeout')}><input required type="number" min={1} max={600} step={1} value={form.healthTimeout || ''} onChange={e => update('healthTimeout', Number(e.target.value))} /></Field></div>
        </fieldset> : <>
          <dl className="plan-details"><Definition label={t('appName')}>{request.app}</Definition><Definition label={t('composeSource')}><code>{request.source}</code></Definition><Definition label={t('target')}><code>{plan.target}</code></Definition><Definition label={t('composeFiles')}><code>{request.files.join('\n')}</code></Definition><Definition label={t('composeEnvFiles')}><code>{request.envFiles.join('\n') || '—'}</code></Definition><Definition label={t('composeProfiles')}><code>{request.profiles.join('\n') || '—'}</code></Definition><Definition label={t('healthTimeout')}>{request.healthTimeout}</Definition><Definition label={t('files')}>{plan.fileCount}</Definition><Definition label={t('size')}>{bytes(plan.bytes)}</Definition></dl>
          <section><h3>{t('composeServices')}</h3><ul className="plan-summary">{plan.services.map(service => <li key={service}><Check size={14} /><code>{service}</code></li>)}</ul>{!plan.services.length && <p className="hint">{t('composeNoServices')}</p>}</section>
          <section><h3>{t('composeSummary')}</h3><ul className="plan-summary">{plan.summary.map((line, index) => <li key={index}><Check size={14} />{line}</li>)}</ul></section>
          <section><h3>{t('composeWarnings')}</h3>{plan.warnings.length ? <ul className="plan-summary compose-warnings">{plan.warnings.map((line, index) => <li key={index}><AlertTriangle size={14} />{line}</li>)}</ul> : <p className="hint">{t('composeNoWarnings')}</p>}</section>
          <p className="hint">{t('composeDeployConfirm')}</p>
        </>}
        <p className="hint">{t('composeDataNote')}</p>
        {demo && <p className="hint">{t('demoNote')}</p>}
      </div>
      <footer className="modal-footer"><button type="button" disabled={busy} onClick={() => plan ? setReview(undefined) : onClose()}>{plan && <ArrowLeft size={15} />}{plan ? t('back') : t('cancel')}</button><button type="submit" className="primary" disabled={busy || !form.source || !form.files.some(file => file.trim()) || Boolean(plan && !plan.services.length)}><Rocket size={15} />{busy ? t('saving') : plan ? t('deployNow') : t('plan')}</button></footer>
    </form>
  </Modal>;
}

export function ComposeDialog({ api, server, t, busy, error, run, onClose, demo }: DialogProps & { server: Server }) {
  const [form, setForm] = useState<ComposeImport>({ project: '', directory: server.root, files: ['compose.yaml'] });
  const [result, setResult] = useState<string>();
  return <Modal title={t('importCompose')} busy={busy} onClose={onClose} t={t}>
    <form onSubmit={event => submit(event, () => void run(async () => setResult(await api.importCompose(server.id, { ...form, files: form.files.map(file => file.trim()).filter(Boolean) }))))}>
      <div className="modal-body"><p className="subtitle">{t('composeNote')}</p><span className="tag">{t('readOnly')}</span><ErrorNotice error={error} t={t} />
        <fieldset disabled={busy}>
          <Field label={t('composeProject')}><input autoFocus required pattern="[a-z0-9][a-z0-9_-]*" value={form.project} onChange={e => { setResult(undefined); setForm({ ...form, project: e.target.value }); }} placeholder="my-project" /></Field>
          <Field label={t('composeDirectory')}><input required pattern="/.*" value={form.directory} onChange={e => { setResult(undefined); setForm({ ...form, directory: e.target.value }); }} /></Field>
          <Field label={t('composeFiles')}><textarea required rows={3} value={form.files.join('\n')} onChange={e => { setResult(undefined); setForm({ ...form, files: e.target.value.split('\n') }); }} /></Field>
        </fieldset>
        {result !== undefined && <section><h3>{t('importResult')}</h3><pre className="terminal">{result || '—'}</pre></section>}
        {demo && <p className="hint">{t('demoNote')}</p>}
      </div>
      <footer className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>{t('close')}</button><button type="submit" className="primary" disabled={busy || !form.files.some(file => file.trim())}>{busy ? t('saving') : t('import')}</button></footer>
    </form>
  </Modal>;
}
