import { API_BASE_URL } from '../config/apiConfig.ts';
import type { StudyGroup } from '../config/studyConfig.ts';

export interface RegisteredParticipant {
  registrationId: string;
  studentName: string;
  group: StudyGroup;
}

export const registerParticipant = async (
  studentName: string,
  registrationId: string,
  password: string,
  action: 'register' | 'login',
): Promise<RegisteredParticipant> => {
  const response = await fetch(`${API_BASE_URL}/api/participants/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationId, studentName, password, action }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Participant information could not be saved.';
    throw new Error(message);
  }
  if (
    !body || typeof body !== 'object'
    || typeof (body as { registrationId?: unknown }).registrationId !== 'string'
    || typeof (body as { studentName?: unknown }).studentName !== 'string'
    || !['A', 'B'].includes(String((body as { group?: unknown }).group))
  ) {
    throw new Error('The participant registration response was invalid.');
  }
  return body as RegisteredParticipant;
};

export const updateParticipantName = async (
  registrationId: string,
  studentName: string,
): Promise<RegisteredParticipant> => {
  const response = await fetch(`${API_BASE_URL}/api/participants/${registrationId}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentName }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Your name could not be updated.';
    throw new Error(message);
  }
  if (
    !body || typeof body !== 'object'
    || typeof (body as { registrationId?: unknown }).registrationId !== 'string'
    || typeof (body as { studentName?: unknown }).studentName !== 'string'
    || !['A', 'B'].includes(String((body as { group?: unknown }).group))
  ) {
    throw new Error('The participant update response was invalid.');
  }
  return body as RegisteredParticipant;
};
