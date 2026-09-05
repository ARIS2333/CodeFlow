import type { EvaluationState, FlowchartState } from './analysisRun';
import type { TraceState } from './traceRun';
import type { ProblemDetails } from './llmSchemas';

const WORKSPACE_CACHE_KEY = 'codeflow.workspace.v1';

export interface WorkspaceCache {
  version: 1;
  code?: string;
  language?: 'java' | 'python';
  problem?: string | null;
  problemDetails?: ProblemDetails | null;
  evaluationState?: EvaluationState;
  flowchartState?: FlowchartState;
  traceState?: TraceState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the student's last workspace. A broken, manually edited, or outdated
 * cache is ignored so local browser data can never prevent the app opening.
 * In-flight requests cannot survive a refresh, so loading states become idle.
 */
export const loadWorkspaceCache = (): WorkspaceCache | null => {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_CACHE_KEY);
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
    };
  } catch {
    return null;
  }
};

/** Merge because MainContent and Layout own different pieces of the workspace. */
export const updateWorkspaceCache = (patch: Partial<WorkspaceCache>): void => {
  try {
    const current = loadWorkspaceCache() ?? { version: 1 as const };
    window.localStorage.setItem(
      WORKSPACE_CACHE_KEY,
      JSON.stringify({ ...current, ...patch, version: 1 }),
    );
  } catch {
    // Storage may be blocked or full. The app remains usable without recovery.
  }
};

/** Remove only the student's work; model credentials use separate storage. */
export const clearWorkspaceCache = (): void => {
  try {
    window.localStorage.removeItem(WORKSPACE_CACHE_KEY);
  } catch {
    // Storage may be blocked. The in-memory reset still succeeds.
  }
};
