import { useEffect, useId, useRef, useState, type DependencyList, type ReactNode } from 'react';
import { AlertCircle, Box, Check, Loader2, X } from 'lucide-react';
import type { Translate, TranslationKey, Language } from './i18n';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const isActive = (status: string) => status === 'running' || status === 'queued';
export function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
export function date(value: string, language: Language) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Each resource owns a generation. Responses from a previous server or refresh are ignored.
export function useRemote<T>(load: () => Promise<T>, dependencies: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setData(undefined);
    Promise.resolve().then(load).then(value => { if (current) setData(value); })
      .catch(reason => { if (current) setError(errorText(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [...dependencies, revision]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}

export function Status({ value, t }: { value: string; t: Translate }) {
  const known = ['running', 'stopped', 'exited', 'paused', 'restarting', 'created', 'dead', 'healthy', 'unhealthy', 'starting', 'unknown', 'queued', 'succeeded', 'failed', 'interrupted'];
  const tone = ['running', 'healthy', 'succeeded'].includes(value) ? 'good' : ['failed', 'unhealthy', 'dead', 'interrupted'].includes(value) ? 'bad' : 'neutral';
  return <span className={`status ${tone}`}><span className="status-dot" />{known.includes(value) ? t(value as TranslationKey) : value || t('unknown')}</span>;
}

export function Loading({ t }: { t: Translate }) {
  return <div className="loading" role="status"><Loader2 className="spin" size={18} />{t('loading')}</div>;
}

export function ErrorNotice({ error, title, retry, t }: { error: string; title?: string; retry?: () => void; t: Translate }) {
  if (!error) return null;
  return <div className="error-notice" role="alert"><AlertCircle size={17} /><div>{title && <strong>{title}</strong>}<span>{error}</span></div>{retry && <button onClick={retry}>{t('retry')}</button>}</div>;
}

export function Empty({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Box size={26} strokeWidth={1.3} /></div><h2>{title}</h2>{description && <p>{description}</p>}{children && <div className="empty-actions">{children}</div>}</div>;
}

export function Modal({ title, children, onClose, busy, t, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy: boolean; t: Translate; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby={id} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="modal-header"><h2 id={id}>{title}</h2><button className="icon-button" aria-label={t('close')} onClick={onClose} disabled={busy}><X size={18} /></button></header>
    {children}
  </dialog>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return <div className="definition"><dt>{label}</dt><dd>{children || '—'}</dd></div>;
}

export function Toast({ message, close, t }: { message: string; close: () => void; t: Translate }) {
  useEffect(() => { const timer = setTimeout(close, 6500); return () => clearTimeout(timer); }, [message]);
  return <div className="toast" role="status"><Check size={17} /><span>{message}</span><button className="icon-button" onClick={close} aria-label={t('close')}><X size={16} /></button></div>;
}
