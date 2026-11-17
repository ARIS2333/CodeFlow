import { useEffect, useRef, useState, type FC } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { rememberPassword, verifySettings, type ModelSettings } from './lib/modelSettings';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ModelSettings | null;
  onSave: (settings: ModelSettings) => void;
  notice?: string;
}

export const SettingsPanel: FC<SettingsPanelProps> = ({ isOpen, onClose, settings, onSave, notice }) => {
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    if (isOpen) {
      setPassword(settings?.mode === 'research' ? settings.password : '');
      setError(''); setRevealed(false); setChecking(false);
    }
    return () => pending.current?.abort();
  }, [isOpen, settings]);
  if (!isOpen) return null;
  const save = async () => {
    if (!password.trim()) { setError('Enter the API access password.'); return; }
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setChecking(true); setError('');
    try {
      const candidate: ModelSettings = { mode: 'research', password };
      const result = await verifySettings(candidate, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) { setError(result.error); return; }
      rememberPassword(password); onSave(candidate); onClose();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not reach the server.');
    } finally { if (!controller.signal.aborted) setChecking(false); }
  };
  const Icon = revealed ? EyeOff : Eye;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="api-access-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-center justify-between"><h2 id="api-access-title" className="text-xl font-semibold text-slate-900">API access</h2>
        <button onClick={onClose} aria-label="Close settings" className="p-2 text-slate-400">✕</button></div>
      <p className="mt-3 text-sm text-slate-600">Enter the access password to use the configured AI model.</p>
      {notice && <p className="mt-3 text-sm text-amber-700">{notice}</p>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="api-access-password" className="mt-5 block text-sm font-medium text-slate-700">Access password</label>
        <div className="relative mt-2"><input id="api-access-password" autoFocus autoComplete="off" disabled={checking} type={revealed ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 py-3 pl-3 pr-12" />
          <button type="button" onClick={() => setRevealed(!revealed)} aria-label={revealed ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-3 text-slate-500"><Icon size={18} /></button></div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-slate-600">Cancel</button>
          <button disabled={checking} type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{checking ? 'Checking…' : 'Continue'}</button></div>
      </form>
    </section>
  </div>;
};
