import type { StudyGroup, StudyTaskId } from '../config/studyConfig';

export type SurveyId = 's1' | 's2' | 's3' | 's4';
export type StudyScreen = StudyTaskId | SurveyId | 'complete';

export interface ParticipantProfile {
  participantId: string;
  group: StudyGroup;
}

export const hasCompleteParticipantProfile = (
  profile: ParticipantProfile | undefined,
): profile is ParticipantProfile => Boolean(
  profile
  && profile.participantId.trim()
  && (profile.group === 'A' || profile.group === 'B'),
);

export interface StudyProgress {
  version: 3;
  participant?: ParticipantProfile;
  currentScreen: StudyScreen;
  furthestIndex: number;
  completedSurveys: string[];
}

const KEY = 'codeflow.study.progress.v3';
const PRIVATE_LEGACY_KEYS = ['codeflow.study.progress.v2', 'codeflow.study.progress.v1'];
export const STUDY_SEQUENCE: StudyScreen[] = ['s1', 'q1', 'q2', 's2', 'q3', 'q4', 's3', 's4', 'complete'];

const emptyProgress = (): StudyProgress => ({
  version: 3,
  currentScreen: 's1',
  furthestIndex: 0,
  completedSurveys: [],
});

export const loadStudyProgress = (): StudyProgress => {
  try {
    // The participant-ID flow no longer uses the former shared browser-side
    // password. Remove any value left behind by an older deployment.
    window.localStorage.removeItem('codeflow.researchPassword');
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (value && typeof value === 'object' && (value as { version?: unknown }).version === 3) {
      const saved = value as StudyProgress;
      return {
        ...emptyProgress(),
        ...saved,
        completedSurveys: Array.isArray(saved.completedSurveys) ? saved.completedSurveys : [],
      };
    }

    // Older profiles contained names and email addresses. Never migrate those
    // fields into the participant-ID-only study profile.
    PRIVATE_LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
    return emptyProgress();
  } catch {
    return emptyProgress();
  }
};

export const saveStudyProgress = (progress: StudyProgress): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // The study remains usable when browser storage is unavailable.
  }
};
