import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { panelConfig } from './config/panelConfig';
import {
  textualFeedbackSectionsFrom,
  type TextualFeedbackState,
} from './lib/textualFeedback';

const MarkdownFeedback = ({ children }: { children: string }) => (
  <div className="min-w-0 text-[0.95rem] [&_ol_ol]:mt-2 [&_ol_ol]:list-[lower-alpha] [&_ol_ul]:mt-2 [&_ul_ul]:mt-1.5">
    <ReactMarkdown
      components={{
        h2: ({ children: title }) => <h2 className="mb-3 mt-7 border-b border-gray-200 pb-2 text-lg font-bold text-gray-900 first:mt-0">{title}</h2>,
        h3: ({ children: title }) => <h3 className="mb-3 mt-6 w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 first:mt-0">{title}</h3>,
        p: ({ children: text }) => <p className="my-2 leading-6 text-gray-700">{text}</p>,
        ol: ({ children: items }) => <ol className="my-3 list-decimal space-y-3 pl-5 text-gray-700 marker:font-semibold marker:text-slate-500">{items}</ol>,
        ul: ({ children: items }) => <ul className="my-2 list-disc space-y-1.5 border-l-2 border-slate-200 pl-5 text-gray-700 marker:text-slate-400">{items}</ul>,
        li: ({ children: item }) => <li className="min-w-0 pl-1 leading-6 [&>p]:my-1">{item}</li>,
        code: ({ children: code }) => <code className="whitespace-normal break-words rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900">{code}</code>,
        strong: ({ children: text }) => <strong className="font-semibold text-slate-900">{text}</strong>,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);

const FeedbackSection = ({ title, children, className = '' }: {
  title: string;
  children: string | null;
  className?: string;
}) => (
  <section className={className} aria-label={title}>
    <h2 className="mb-3 border-b border-gray-200 pb-2 text-lg font-bold text-gray-900">{title}</h2>
    {children
      ? <MarkdownFeedback>{children}</MarkdownFeedback>
      : <p className="text-sm text-gray-400">Generating…</p>}
  </section>
);

const StructuredFeedback = ({ markdown }: { markdown: string }) => {
  const sections = textualFeedbackSectionsFrom(markdown);

  return (
    <div className="space-y-7">
      <section aria-label="Logic comparison">
        <div className="grid min-w-[42rem] grid-cols-2 gap-4">
          <div className="min-w-0 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/40 p-5">
            <FeedbackSection title="Student's logic">{sections.studentLogic}</FeedbackSection>
          </div>
          <div className="min-w-0 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/40 p-5">
            <FeedbackSection title="Recommended logic">{sections.recommendedLogic}</FeedbackSection>
          </div>
        </div>
      </section>

      <section aria-label="Execution comparison">
        <div className="grid min-w-[42rem] grid-cols-2 gap-4">
          <div className="min-w-0 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/40 p-5">
            <FeedbackSection title="Student's execution">{sections.studentExecution}</FeedbackSection>
          </div>
          <div className="min-w-0 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/40 p-5">
            <FeedbackSection title="Recommended execution">{sections.recommendedExecution}</FeedbackSection>
          </div>
        </div>
      </section>
    </div>
  );
};

export function TextualPanel({ isVisible, onClose, state, width, onWidthChange, defaultInput, onRegenerate }: {
  isVisible: boolean;
  onClose: () => void;
  state: TextualFeedbackState;
  width: number;
  onWidthChange: (width: number) => void;
  defaultInput: string;
  onRegenerate: (input: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const requestedInput = state.status === 'idle' ? '' : state.requestedInput ?? '';
  const [draft, setDraft] = useState(requestedInput || defaultInput);
  useEffect(() => { setDraft(requestedInput || defaultInput); }, [requestedInput, defaultInput]);

  const startResizing = (event: ReactMouseEvent) => {
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    setIsDragging(true);
    event.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const move = (event: MouseEvent) => {
      const deltaX = startXRef.current - event.clientX;
      const nextWidth = Math.max(
        panelConfig.minWidth(),
        Math.min(panelConfig.maxWidth(), startWidthRef.current + deltaX),
      );
      onWidthChange(nextWidth);
    };
    const stop = () => setIsDragging(false);

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, onWidthChange]);

  useEffect(() => {
    const keepWidthInRange = () => {
      onWidthChange(Math.max(panelConfig.minWidth(), Math.min(panelConfig.maxWidth(), width)));
    };
    window.addEventListener('resize', keepWidthInRange);
    return () => window.removeEventListener('resize', keepWidthInRange);
  }, [onWidthChange, width]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', exitOnEscape);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isVisible) setIsFullscreen(false);
  }, [isVisible]);

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

  return <aside
    style={{ width: isFullscreen ? '100vw' : width }}
    className={`fixed z-50 flex h-full flex-col bg-white shadow-xl ${isFullscreen ? 'inset-0' : 'right-0 top-0 border-l'}`}
    aria-label="Textual AI feedback panel"
  >
    {!isFullscreen && <div
        role="separator"
        aria-label="Resize textual feedback panel"
        aria-orientation="vertical"
        onMouseDown={startResizing}
        className={`absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-gray-200 transition-colors hover:bg-violet-400 ${isDragging ? 'bg-violet-500' : ''}`}
      >
        <div className="absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-gray-500 opacity-50" />
      </div>}
    <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Textual AI feedback</p><h2 className="text-xl font-bold text-gray-900">Step-by-step feedback</h2></div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsFullscreen((value) => !value)}
          aria-expanded={isFullscreen}
          className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <button
          onClick={() => { setIsFullscreen(false); onClose(); }}
          aria-label="Close textual feedback"
          className="rounded-md p-2 text-gray-600 hover:bg-gray-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
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
    <div className={`flex-1 overflow-auto ${isFullscreen ? 'p-6' : 'p-5'}`}>
      {state.status === 'idle' && <p className="rounded-lg bg-gray-50 p-4 text-gray-600">Run your code to generate textual feedback.</p>}
      {state.status === 'loading' && !markdown && <div role="status" className="flex items-center gap-3 rounded-lg bg-violet-50 p-4 text-violet-800"><span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />Generating step-by-step feedback...</div>}
      {markdown && (markdown.includes('## Input used')
        ? <StructuredFeedback markdown={markdown} />
        : <MarkdownFeedback>{markdown}</MarkdownFeedback>)}
      {state.status === 'loading' && markdown && <div role="status" className="mt-5 flex items-center gap-2 text-sm text-violet-700"><span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />Generating…</div>}
      {state.status === 'error' && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"><p className="font-semibold">Textual feedback could not be generated</p><p className="mt-1 text-sm">{state.error}</p></div>}
    </div>
  </aside>;
}
