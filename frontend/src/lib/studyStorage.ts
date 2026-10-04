import type { StudyGroup, StudyTaskId } from '../config/studyConfig';

export type SurveyId = 's1' | 's2' | 's3' | 's4';
export type StudyScreen = StudyTaskId | SurveyId | 'complete';

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
  version: 2;
  participant?: ParticipantProfile;
  currentScreen: StudyScreen;
  furthestIndex: number;
  completedSurveys: string[];
}

const KEY = 'codeflow.study.progress.v2';
const LEGACY_KEY = 'codeflow.study.progress.v1';
export const STUDY_SEQUENCE: StudyScreen[] = ['s1', 'q1', 'q2', 's2', 'q3', 'q4', 's3', 's4', 'complete'];

const emptyProgress = (): StudyProgress => ({
  version: 2,
  currentScreen: 's1',
  furthestIndex: 0,
  completedSurveys: [],
});

export const loadStudyProgress = (): StudyProgress => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (value && typeof value === 'object' && (value as { version?: unknown }).version === 2) {
      const saved = value as StudyProgress;
      return {
        ...emptyProgress(),
        ...saved,
        completedSurveys: Array.isArray(saved.completedSurveys) ? saved.completedSurveys : [],
      };
    }

    // The former sequence began at Q1 and used S1-S3 for different survey
    // positions. Preserve participant information, but restart navigation at
    // the new required pre-study S1 so an old browser cannot skip it.
    const legacy: unknown = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? 'null');
    if (legacy && typeof legacy === 'object') {
      const participant = (legacy as { participant?: ParticipantProfile }).participant;
      return { ...emptyProgress(), ...(hasCompleteParticipantProfile(participant) ? { participant } : {}) };
    }
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
