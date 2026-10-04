import type { StudyGroup, StudyTaskId } from '../config/studyConfig';

export type StudyScreen = StudyTaskId | 'mid1' | 'mid2' | 'post' | 'complete';

export interface ParticipantProfile {
  name: string;
  email: string;
  group: StudyGroup;
  researchPassword: string;
}

export const hasCompleteParticipantProfile = (
  profile: ParticipantProfile | undefined,
): profile is ParticipantProfile => Boolean(
  profile
  && profile.name.trim()
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())
  && (profile.group === 'A' || profile.group === 'B')
  && profile.researchPassword.trim(),
);

export interface StudyProgress {
  version: 1;
  participant?: ParticipantProfile;
  currentScreen: StudyScreen;
  furthestIndex: number;
  completedSurveys: string[];
}

const KEY = 'codeflow.study.progress.v1';
export const STUDY_SEQUENCE: StudyScreen[] = ['q1', 'q2', 'mid1', 'q3', 'q4', 'mid2', 'post', 'complete'];

const emptyProgress = (): StudyProgress => ({
  version: 1,
  currentScreen: 'q1',
  furthestIndex: 0,
  completedSurveys: [],
});

export const loadStudyProgress = (): StudyProgress => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
      return emptyProgress();
    }
    const saved = value as StudyProgress;
    return {
      ...emptyProgress(),
      ...saved,
      completedSurveys: Array.isArray(saved.completedSurveys) ? saved.completedSurveys : [],
    };
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
