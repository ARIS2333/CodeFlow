import type { EvaluationState, FlowchartState } from './analysisRun';
import type { TraceState } from './traceRun';
import type { ProblemDetails } from './llmSchemas';
import type { SupportedLanguage } from './codeAnalysis';
import type { TextualFeedbackState } from './textualFeedback';

const LEGACY_WORKSPACE_CACHE_KEY = 'codeflow.workspace.v1';
const workspaceCacheKey = (workspaceId?: string) =>
  workspaceId ? `codeflow.study.workspace.v1.${workspaceId}` : LEGACY_WORKSPACE_CACHE_KEY;

export interface WorkspaceCache {
  version: 1;
  code?: string;
  language?: SupportedLanguage;
  problem?: string | null;
  problemDetails?: ProblemDetails | null;
  evaluationState?: EvaluationState;
  flowchartState?: FlowchartState;
  traceState?: TraceState;
  textualFeedbackState?: TextualFeedbackState;
  activeSubmission?: {
    submissionId: string;
    attemptNumber: number;
    participantEmail: string;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the student's last workspace. A broken, manually edited, or outdated
 * cache is ignored so local browser data can never prevent the app opening.
 * In-flight requests cannot survive a refresh, so loading states become idle.
 */
export const loadWorkspaceCache = (workspaceId?: string): WorkspaceCache | null => {
  try {
    const raw = window.localStorage.getItem(workspaceCacheKey(workspaceId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return null;

    const cache = parsed as unknown as WorkspaceCache;
    return {
      ...cache,
      evaluationState: cache.evaluationState?.status === 'loading'
        ? { status: 'idle' }
        : cache.evaluationState,
      flowchartState: cache.flowchartState?.status === 'loading'
        ? { status: 'idle' }
        : cache.flowchartState,
      traceState: cache.traceState?.status === 'loading'
        ? { status: 'idle' }
        : cache.traceState,
      textualFeedbackState: cache.textualFeedbackState?.status === 'loading'
        ? { status: 'idle' }
        : cache.textualFeedbackState,
    };
  } catch {
    return null;
  }
};

/** Merge because MainContent and Layout own different pieces of the workspace. */
export const updateWorkspaceCache = (patch: Partial<WorkspaceCache>, workspaceId?: string): void => {
  try {
    const current = loadWorkspaceCache(workspaceId) ?? { version: 1 as const };
    window.localStorage.setItem(
      workspaceCacheKey(workspaceId),
      JSON.stringify({ ...current, ...patch, version: 1 }),
    );
  } catch {
    // Storage may be blocked or full. The app remains usable without recovery.
  }
};

/** Remove only the student's work; model credentials use separate storage. */
export const clearWorkspaceCache = (workspaceId?: string): void => {
  try {
    window.localStorage.removeItem(workspaceCacheKey(workspaceId));
  } catch {
    // Storage may be blocked. The in-memory reset still succeeds.
  }
};
