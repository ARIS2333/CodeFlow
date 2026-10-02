import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X } from 'lucide-react';
import type { TextualFeedbackState } from './lib/textualFeedback';

const MarkdownFeedback = ({ children }: { children: string }) => (
  <ReactMarkdown
    components={{
      h2: ({ children: title }) => <h2 className="mb-3 mt-8 border-b border-gray-200 pb-2 text-lg font-bold text-gray-900 first:mt-0">{title}</h2>,
      h3: ({ children: title }) => <h3 className="mb-2 mt-6 font-semibold text-gray-900">{title}</h3>,
      p: ({ children: text }) => <p className="my-3 leading-7 text-gray-700">{text}</p>,
      ol: ({ children: items }) => <ol className="my-4 list-decimal space-y-4 pl-6 text-gray-700">{items}</ol>,
      ul: ({ children: items }) => <ul className="my-4 list-disc space-y-2 pl-6 text-gray-700">{items}</ul>,
      li: ({ children: item }) => <li className="pl-1 leading-7">{item}</li>,
      code: ({ children: code }) => <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900">{code}</code>,
      strong: ({ children: text }) => <strong className="font-semibold text-gray-900">{text}</strong>,
    }}
  >
    {children}
  </ReactMarkdown>
);

export function TextualPanel({ isVisible, onClose, state, width, defaultInput, onRegenerate }: {
  isVisible: boolean;
  onClose: () => void;
  state: TextualFeedbackState;
  width: number;
  defaultInput: string;
  onRegenerate: (input: string) => void;
}) {
  const requestedInput = state.status === 'idle' ? '' : state.requestedInput ?? '';
  const [draft, setDraft] = useState(requestedInput || defaultInput);
  useEffect(() => { setDraft(requestedInput || defaultInput); }, [requestedInput, defaultInput]);
  if (!isVisible) return null;
  const markdown = state.status === 'loading' || state.status === 'success'
    ? state.markdown
    : state.status === 'error'
      ? state.markdown ?? ''
      : '';
  const loading = state.status === 'loading';
  const submit = () => {
    const input = draft.trim();
    if (!input || loading) return;
    onRegenerate(input);
  };

  return <aside style={{ width }} className="fixed right-0 top-0 z-50 flex h-full flex-col border-l bg-white shadow-xl" aria-label="Textual AI feedback panel">
    <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Textual AI feedback</p><h2 className="text-xl font-bold text-gray-900">Step-by-step feedback</h2></div>
      <button onClick={onClose} aria-label="Close textual feedback" className="rounded-md p-2 text-gray-600 hover:bg-gray-200"><X className="h-5 w-5" /></button>
    </div>
    <div className="border-b border-violet-200 bg-violet-50/60 p-4">
      <p className="mb-2 text-sm text-gray-700">Enter a function call to generate both walkthroughs with that input.</p>
      <div className="flex items-center gap-2">
        <label htmlFor="textual-input" className="text-sm font-medium text-gray-700">Input</label>
        <input
          id="textual-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm"
        />
        <button type="button" onClick={submit} disabled={loading || !draft.trim()} className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
          Re-generate
        </button>
      </div>
    </div>
    <div className="flex-1 overflow-auto p-5">
      {state.status === 'idle' && <p className="rounded-lg bg-gray-50 p-4 text-gray-600">Run your code to generate textual feedback.</p>}
      {state.status === 'loading' && !markdown && <div role="status" className="flex items-center gap-3 rounded-lg bg-violet-50 p-4 text-violet-800"><span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />Generating step-by-step feedback...</div>}
      {markdown && <MarkdownFeedback>{markdown}</MarkdownFeedback>}
      {state.status === 'loading' && markdown && <div role="status" className="mt-5 flex items-center gap-2 text-sm text-violet-700"><span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />Generating…</div>}
      {state.status === 'error' && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"><p className="font-semibold">Textual feedback could not be generated</p><p className="mt-1 text-sm">{state.error}</p></div>}
    </div>
  </aside>;
}
