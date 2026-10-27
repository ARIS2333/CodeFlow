import { useState, type FormEvent } from 'react';
import { API_BASE_URL } from './config/apiConfig';

interface Summary {
  participants: Array<{
    registrationId: string;
    studentName: string;
    group: string;
    totalTokens: number;
    estimatedCostUsd: number;
    runs: Record<string, number>;
  }>;
  totals: { totalTokens: number; estimatedCostUsd: number };
}

export default function AdminPanel({ onClose }: { onClose?: () => void }) {
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');

  const load = async (credential: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/summary`, {
      headers: { Authorization: `Bearer ${credential}` }, cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) { setToken(''); setSummary(undefined); }
      throw new Error(body.error || 'Statistics could not be loaded.');
    }
    setSummary(body);
    setUpdatedAt(new Date().toLocaleString());
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Sign-in failed.');
      setToken(body.token); setPassword('');
      await load(body.token);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true); setError('');
    try { await load(token); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-slate-50 p-5 sm:p-10">
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-blue-600">CodeFlow</p><h1 className="mt-1 text-3xl font-bold text-gray-900">Study administration</h1></div>
        <div className="flex gap-3">
        {token && <>
          <button disabled={busy} onClick={() => void refresh()} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Loading…' : 'Refresh'}</button>
          <button onClick={() => { setToken(''); setSummary(undefined); setError(''); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2">Sign out</button>
        </>}
        {onClose && <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2">Back to study</button>}
        </div>
      </div>
      {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
      {!token && <form role="dialog" aria-modal={true} aria-labelledby="admin-sign-in-title" onSubmit={login} className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h2 id="admin-sign-in-title" className="text-xl font-semibold">Admin sign-in</h2>
        <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-gray-600">For study administrators only. Students do not need to use this panel—please close it and continue the study.</p>
        <label className="mt-5 block text-sm font-medium">Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
        {onClose && <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Close</button>}
      </form>}
      {token && summary && <>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            ['Registered students', summary.participants.length.toLocaleString()],
            ['Total tokens', summary.totals.totalTokens.toLocaleString()],
            ['Total estimated cost', `$${summary.totals.estimatedCostUsd.toFixed(4)}`],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>)}
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-gray-600"><tr>{['Student name', 'Group', 'Tokens', 'Estimated cost', 'Q1 runs', 'Q2 runs', 'Q3 runs', 'Q4 runs'].map((title) => <th key={title} className="whitespace-nowrap px-4 py-3 font-semibold">{title}</th>)}</tr></thead>
            <tbody>{summary.participants.map((student) => <tr key={student.registrationId} className="border-t border-gray-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-gray-900">{student.studentName}</td><td className="px-4 py-3">{student.group}</td>
              <td className="px-4 py-3 tabular-nums">{student.totalTokens.toLocaleString()}</td><td className="px-4 py-3 tabular-nums">${student.estimatedCostUsd.toFixed(4)}</td>
              {['q1', 'q2', 'q3', 'q4'].map((id) => <td key={id} className="px-4 py-3 tabular-nums">{student.runs[id]}</td>)}
            </tr>)}</tbody>
          </table>
          {!summary.participants.length && <p className="p-8 text-center text-gray-500">No registered students yet.</p>}
        </div>
        <p className="mt-4 text-xs leading-5 text-gray-500">Updated: {updatedAt}. Run counts include saved submissions only. Costs are estimates based on recorded model usage.</p>
      </>}
    </div>
  </main>;
}

export function AdminEntry() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Open administrator panel" className="fixed bottom-4 left-4 z-[90] rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm hover:bg-gray-100">⚙ Admin</button>
    {open && <div className="fixed inset-0 z-[150] overflow-auto bg-slate-950/50"><AdminPanel onClose={() => setOpen(false)} /></div>}
  </>;
}
