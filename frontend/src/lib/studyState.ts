import { API_BASE_URL } from '../config/apiConfig.ts';
import type { WorkspaceCache } from './workspaceCache.ts';

export interface CloudProgress {
  currentScreen: string;
  furthestIndex: number;
  completedSurveys: string[];
}

export interface CloudStudyState {
  progress: CloudProgress | null;
  workspaces: Record<string, WorkspaceCache>;
}

export class StudyAccountNotFoundError extends Error {}

let activeRegistrationId: string | undefined;
const workspaceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const workspaceSaveChains = new Map<string, Promise<void>>();
let progressSaveChain: Promise<void> = Promise.resolve();

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, init);
      if (response.status < 500) return response;
    } catch {
      // Retry short network interruptions. Local storage remains the fallback.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (response) return response;
  throw new Error('Could not reach the study database.');
};

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const body: unknown = await response.json().catch(() => null);
  return new Error(
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : fallback,
  );
};

export const loadCloudStudyState = async (registrationId: string): Promise<CloudStudyState> => {
  const response = await request(`${API_BASE_URL}/api/participants/${registrationId}/state`);
  if (response.status === 404) {
    throw new StudyAccountNotFoundError('This saved login is no longer available. Please sign in again.');
  }
  if (!response.ok) throw await responseError(response, 'Saved study progress could not be loaded.');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('The saved study state was invalid.');
  const record = body as { progress?: unknown; workspaces?: unknown };
  return {
    progress: record.progress && typeof record.progress === 'object'
      ? record.progress as CloudProgress
      : null,
    workspaces: record.workspaces && typeof record.workspaces === 'object'
      ? record.workspaces as Record<string, WorkspaceCache>
      : {},
  };
};

export const configureCloudWorkspaceSync = (registrationId?: string): void => {
  if (registrationId !== activeRegistrationId) {
    progressSaveChain = Promise.resolve();
    workspaceSaveChains.clear();
  }
  activeRegistrationId = registrationId;
  if (!registrationId) {
    workspaceTimers.forEach((timer) => clearTimeout(timer));
    workspaceTimers.clear();
  }
};

export const saveCloudProgress = async (
  registrationId: string,
  progress: CloudProgress,
): Promise<void> => {
  const operation = progressSaveChain.catch(() => undefined).then(async () => {
    const response = await request(`${API_BASE_URL}/api/participants/${registrationId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    });
    if (!response.ok) throw await responseError(response, 'Study progress could not be saved.');
  });
  progressSaveChain = operation;
  return operation;
};

const saveWorkspace = async (
  registrationId: string,
  workspaceId: string,
  workspace: WorkspaceCache,
): Promise<void> => {
  const response = await request(
    `${API_BASE_URL}/api/participants/${registrationId}/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workspace),
      keepalive: true,
    },
  );
  if (!response.ok) throw await responseError(response, 'Workspace could not be saved.');
};

export const queueCloudWorkspaceSave = (
  workspaceId: string | undefined,
  workspace: WorkspaceCache,
): void => {
  const registrationId = activeRegistrationId;
  if (!registrationId || !workspaceId) return;
  const existing = workspaceTimers.get(workspaceId);
  if (existing) clearTimeout(existing);
  workspaceTimers.set(workspaceId, setTimeout(() => {
    workspaceTimers.delete(workspaceId);
    const previous = workspaceSaveChains.get(workspaceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(
      () => saveWorkspace(registrationId, workspaceId, workspace),
    );
    workspaceSaveChains.set(workspaceId, operation);
    void operation.catch(() => {
      // The local cache remains available. A later edit queues another retry.
    });
  }, 350));
};
