import { API_BASE_URL } from '../config/apiConfig.ts';
import type { FeedbackMode, StudyTaskId } from '../config/studyConfig.ts';
import type { SupportedLanguage } from './codeAnalysis.ts';

export interface CreateSubmissionRequest {
  participantId: string;
  questionId: StudyTaskId;
  sourceCode: string;
  language: SupportedLanguage;
  feedbackFormat: FeedbackMode;
}

export interface CreatedSubmission {
  submissionId: string;
  attemptNumber: number;
}

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (
      body && typeof body === 'object'
      && typeof (body as { error?: unknown }).error === 'string'
    ) {
      return new Error((body as { error: string }).error);
    }
  } catch {
    // A proxy can return HTML or no body. Use the stable fallback below.
  }
  return new Error(fallback);
};

export const createSubmission = async (
  payload: CreateSubmissionRequest,
): Promise<CreatedSubmission> => {
  const submissionId = crypto.randomUUID();
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(`${API_BASE_URL}/api/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, ...payload }),
      });
      if (response.status < 500) break;
    } catch {
      // The server uses submissionId as an idempotency key, so a lost response
      // can be retried without creating another attempt.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  if (!response) throw new Error('Could not reach the study database.');
  if (!response.ok) throw await responseError(response, 'Submission could not be saved.');
  const body: unknown = await response.json();
  if (
    !body || typeof body !== 'object'
    || typeof (body as { submissionId?: unknown }).submissionId !== 'string'
    || typeof (body as { attemptNumber?: unknown }).attemptNumber !== 'number'
  ) {
    throw new Error('The study database returned an invalid response.');
  }
  return body as CreatedSubmission;
};

export interface SubmissionUpdate {
  terminalResult?: unknown;
  flowchart?: unknown;
  codeTrace?: unknown;
  textualFeedback?: unknown;
}

export const updateSubmission = async (
  submissionId: string,
  participantId: string,
  update: SubmissionUpdate,
): Promise<void> => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(`${API_BASE_URL}/api/submissions/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, ...update }),
      });
      if (response.status < 500) break;
    } catch {
      // Updating a fixed column set is idempotent; retry temporary failures.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (!response) throw new Error('Could not update the saved submission.');
  if (!response.ok) throw await responseError(response, 'Submission result could not be saved.');
};
