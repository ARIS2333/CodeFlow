import { API_BASE_URL } from '../config/apiConfig.ts';
import type { StudyGroup } from '../config/studyConfig.ts';

export interface VerifiedParticipant {
  participantId: string;
  group: StudyGroup;
}

export const verifyParticipant = async (
  participantId: string,
): Promise<VerifiedParticipant> => {
  const response = await fetch(`${API_BASE_URL}/api/participants/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Participant information could not be verified.';
    throw new Error(message);
  }
  if (
    !body || typeof body !== 'object'
    || typeof (body as { participantId?: unknown }).participantId !== 'string'
    || !['A', 'B'].includes(String((body as { group?: unknown }).group))
  ) {
    throw new Error('The participant verification response was invalid.');
  }
  return body as VerifiedParticipant;
};
