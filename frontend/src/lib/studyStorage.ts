import type { StudyGroup, StudyTaskId } from '../config/studyConfig';

export type SurveyId = 's1' | 's2' | 's3' | 's4';
export type StudyScreen = StudyTaskId | SurveyId | 'complete';

export interface ParticipantProfile {
  registrationId: string;
  studentName: string;
  group: StudyGroup;
}

export const hasCompleteParticipantProfile = (
  profile: ParticipantProfile | undefined,
): profile is ParticipantProfile => Boolean(
  profile
  && profile.registrationId.trim()
  && profile.studentName.trim()
  && (profile.group === 'A' || profile.group === 'B'),
);

export interface StudyProgress {
  version: 6;
  participant?: ParticipantProfile;
  currentScreen: StudyScreen;
  furthestIndex: number;
  completedSurveys: string[];
}

const KEY = 'codeflow.study.progress.v6';
const PRIVATE_LEGACY_KEYS = [
  'codeflow.study.progress.v5',
  'codeflow.study.progress.v4',
  'codeflow.study.progress.v3',
  'codeflow.study.progress.v2',
  'codeflow.study.progress.v1',
];
export const STUDY_SEQUENCE: StudyScreen[] = ['s1', 'q1', 'q2', 's2', 'q3', 'q4', 's3', 's4', 'complete'];

const emptyProgress = (): StudyProgress => ({
  version: 6,
  currentScreen: 's1',
  furthestIndex: 0,
  completedSurveys: [],
});

export const loadStudyProgress = (): StudyProgress => {
  try {
    // The study flow no longer uses the former shared browser-side
    // password. Remove any value left behind by an older deployment.
    window.localStorage.removeItem('codeflow.researchPassword');
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (value && typeof value === 'object' && (value as { version?: unknown }).version === 6) {
      const saved = value as StudyProgress;
      return {
        ...emptyProgress(),
        ...saved,
        completedSurveys: Array.isArray(saved.completedSurveys) ? saved.completedSurveys : [],
      };
    }

    // Never migrate an older identity. Earlier versions used email addresses,
    // passwords, or preassigned participant IDs. Version 6 creates a
    // password-backed account and stores only its internal registration UUID;
    // the password itself is never written to browser storage.
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
