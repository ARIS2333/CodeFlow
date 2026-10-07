import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Layout } from './Layout';
import { Header } from './Header';
import { STUDY_TASKS, STUDY_TASK_SET_VERSION, SURVEY_URLS, feedbackModeFor } from './config/studyConfig';
import { verifyParticipant } from './lib/participants';
import { STUDY_SEQUENCE, hasCompleteParticipantProfile, loadStudyProgress, saveStudyProgress, type ParticipantProfile, type StudyProgress, type StudyScreen, type SurveyId } from './lib/studyStorage';

function ProfileDialog({ initial, notice, onSave, onClose }: { initial?: ParticipantProfile; notice?: string; onSave: (profile: ParticipantProfile) => void; onClose?: () => void }) {
  const [participantId, setParticipantId] = useState(initial?.participantId ?? '');
  const [error, setError] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!participantId.trim()) return;
    setIsVerifying(true);
    setError(undefined);
    try {
      const verified = await verifyParticipant(participantId);
      onSave(verified);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Participant information could not be verified.');
    } finally {
      setIsVerifying(false);
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="participant-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="participant-title" className="text-2xl font-bold text-gray-900">Participant information</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">Enter the participant ID assigned for this study. Your study group will be selected automatically.</p>
      {notice && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Participant ID<input required autoCapitalize="characters" autoComplete="off" value={participantId} onChange={(event) => setParticipantId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="CF-P001" /></label>
        <div className="flex justify-end gap-2 pt-2">{onClose && <button type="button" onClick={onClose} disabled={isVerifying} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>}<button type="submit" disabled={isVerifying} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isVerifying ? 'Verifying…' : 'Save and continue'}</button></div>
      </form>
    </div>
  </div>;
}

function SurveyPage({ screen, onComplete, navigation }: { screen: SurveyId; onComplete: () => void; navigation: ReactNode }) {
  const copy = {
    s1: {
      eyebrow: 'Before you begin',
      title: 'Survey 1',
      body: [
        'This survey asks about your programming background.',
        'Throughout the study, your work is associated only with your assigned participant ID.',
        'Your participation and all answers provided throughout the study will not affect your course grade.',
      ],
      button: 'Continue to Question 1',
    },
    s2: {
      eyebrow: 'Stage 1 complete',
      title: 'Survey 2',
      body: ['This survey asks about your experience using the feedback format provided in the first stage.'],
      button: 'Continue to Question 3',
    },
    s3: {
      eyebrow: 'Stage 2 complete',
      title: 'Survey 3',
      body: ['This survey asks about your experience using the feedback format provided in the second stage.'],
      button: 'Continue to Survey 4',
    },
    s4: {
      eyebrow: 'Final step',
      title: 'Survey 4',
      body: ['This final survey asks you to compare the two feedback formats you used during the study.'],
      button: 'Complete study',
    },
  }[screen];
  return <div className="min-h-screen bg-slate-50"><Header onTogglePanel={() => {}} onOpenSettings={() => {}} modelLabel="" isConfigured={false} showModelSettings={false} studyHeader={navigation} /><main className="p-6"><section className="mx-auto mt-10 max-w-2xl rounded-2xl bg-white p-8 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">{copy.eyebrow}</p><h1 className="mt-2 text-3xl font-bold text-gray-900">{copy.title}</h1><div className="mx-auto mt-4 max-w-lg space-y-3 leading-7 text-gray-600">{copy.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><a href={SURVEY_URLS[screen]} target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700">Open Google Form</a><div className="mt-8 border-t border-gray-200 pt-6"><button onClick={onComplete} className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700">I completed the survey — {copy.button}</button></div></section></main></div>;
}

export default function App() {
  const initial = useMemo(() => loadStudyProgress(), []);
  const [progress, setProgress] = useState<StudyProgress>(initial);
  const [showProfile, setShowProfile] = useState(!hasCompleteParticipantProfile(initial.participant));
  const [profileNotice, setProfileNotice] = useState<string | undefined>();
  const [showRightPanel, setShowRightPanel] = useState(false);
  useEffect(() => saveStudyProgress(progress), [progress]);
  const currentIndex = STUDY_SEQUENCE.indexOf(progress.currentScreen);
  const moveTo = (screen: StudyScreen) => {
    const index = STUDY_SEQUENCE.indexOf(screen);
    setShowRightPanel(false);
    setProgress((current) => ({ ...current, currentScreen: screen, furthestIndex: Math.max(current.furthestIndex, index) }));
  };
  const continueStudy = () => moveTo(STUDY_SEQUENCE[Math.min(currentIndex + 1, STUDY_SEQUENCE.length - 1)]);
  const task = STUDY_TASKS.find((entry) => entry.id === progress.currentScreen);
  const feedbackMode = useMemo(() => task && progress.participant ? feedbackModeFor(progress.participant.group, task.id) : undefined, [task, progress.participant]);
  const navigationItems: { screen: StudyScreen; label: string }[] = [
    { screen: 's1', label: 'S1' }, { screen: 'q1', label: 'Q1' },
    { screen: 'q2', label: 'Q2' }, { screen: 's2', label: 'S2' },
    { screen: 'q3', label: 'Q3' }, { screen: 'q4', label: 'Q4' },
    { screen: 's3', label: 'S3' }, { screen: 's4', label: 'S4' },
  ];
  const canContinueFromNavigation = Boolean(task && currentIndex === progress.furthestIndex);
  const studyHeader = progress.participant ? (
    <div className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap justify-start gap-1.5" aria-label="Study navigation">
        <button
          type="button"
          onClick={() => setShowProfile(true)}
          className="rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
        >
          Participant information
        </button>
        {navigationItems.map((entry) => {
          const index = STUDY_SEQUENCE.indexOf(entry.screen);
          const enabled = index <= progress.furthestIndex;
          return (
            <button
              key={entry.screen}
              disabled={!enabled}
              onClick={() => moveTo(entry.screen)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                entry.screen === progress.currentScreen
                  ? 'bg-blue-600 text-white'
                  : enabled
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-gray-50 text-gray-300'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={continueStudy}
          disabled={!canContinueFromNavigation}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          Continue
        </button>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {feedbackMode && (
          <span className="rounded-full bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">
            {feedbackMode === 'codeflow' ? 'Flowchart feedback' : 'Textual feedback'}
          </span>
        )}
      </div>
    </div>
  ) : null;

  let content;
  if (!progress.participant) content = <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">CodeFlow study</p><h1 className="mt-2 text-3xl font-bold">Welcome</h1><p className="mt-4 text-gray-600">Enter your participant information to begin Question 1.</p></section></main>;
  else if (task && feedbackMode) {
    const workspaceId = `${task.id}.v${STUDY_TASK_SET_VERSION}`;
    content = <Layout key={workspaceId} showRightPanel={showRightPanel} onTogglePanel={() => setShowRightPanel((value) => !value)} workspaceId={workspaceId} task={task} feedbackMode={feedbackMode} studyHeader={studyHeader} participant={progress.participant} onRequireParticipant={() => { setProfileNotice('Enter a valid participant ID before running code.'); setShowProfile(true); }} />;
  }
  else if (progress.currentScreen === 's1' || progress.currentScreen === 's2' || progress.currentScreen === 's3' || progress.currentScreen === 's4') content = <SurveyPage screen={progress.currentScreen} navigation={studyHeader} onComplete={() => { setProgress((current) => ({ ...current, completedSurveys: [...new Set([...current.completedSurveys, current.currentScreen])] })); continueStudy(); }} />;
  else content = <div className="min-h-screen bg-slate-50"><Header onTogglePanel={() => {}} onOpenSettings={() => {}} modelLabel="" isConfigured={false} showModelSettings={false} studyHeader={studyHeader} /><main className="flex items-center justify-center p-16"><section className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-emerald-600">Study complete</p><h1 className="mt-2 text-3xl font-bold">Thank you</h1><p className="mt-4 text-gray-600">Your study activities are complete. You may review any unlocked question or survey from the navigation above.</p></section></main></div>;
  return <>{content}{showProfile && <ProfileDialog initial={progress.participant} notice={profileNotice} onClose={hasCompleteParticipantProfile(progress.participant) ? () => { setProfileNotice(undefined); setShowProfile(false); } : undefined} onSave={(participant) => { setProgress((current) => ({ ...current, participant })); setProfileNotice(undefined); setShowProfile(false); }} />}</>;
}
