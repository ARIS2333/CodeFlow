import { API_BASE_URL } from '../config/apiConfig.ts';

export interface ParticipantUsageSummary {
  spentUsd: number;
  limitUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export interface StudyUsageSummary {
  modelCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export const loadParticipantUsage = async (
  registrationId: string,
): Promise<ParticipantUsageSummary> => {
  const response = await fetch(`${API_BASE_URL}/api/participants/${registrationId}/usage`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'AI usage could not be loaded.';
    throw new Error(message);
  }
  if (
    !body || typeof body !== 'object'
    || typeof (body as { spentUsd?: unknown }).spentUsd !== 'number'
    || typeof (body as { limitUsd?: unknown }).limitUsd !== 'number'
    || typeof (body as { remainingUsd?: unknown }).remainingUsd !== 'number'
    || typeof (body as { exhausted?: unknown }).exhausted !== 'boolean'
  ) throw new Error('The AI usage response was invalid.');
  return body as ParticipantUsageSummary;
};

export const loadStudyUsage = async (registrationId: string): Promise<StudyUsageSummary> => {
  const response = await fetch(`${API_BASE_URL}/api/participants/${registrationId}/study-usage`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Study usage could not be loaded.';
    throw new Error(message);
  }
  const numericFields: (keyof StudyUsageSummary)[] = [
    'modelCalls', 'inputTokens', 'cachedInputTokens', 'cacheWriteTokens',
    'outputTokens', 'totalTokens', 'estimatedCostUsd',
  ];
  if (!body || typeof body !== 'object' || numericFields.some((field) => typeof (body as Record<string, unknown>)[field] !== 'number')) {
    throw new Error('The study usage response was invalid.');
  }
  return body as StudyUsageSummary;
};
