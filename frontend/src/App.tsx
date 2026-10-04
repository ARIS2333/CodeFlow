import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Layout } from './Layout';
import { Header } from './Header';
import { STUDY_TASKS, STUDY_TASK_SET_VERSION, SURVEY_URLS, feedbackModeFor, type StudyGroup } from './config/studyConfig';
import { STUDY_SEQUENCE, hasCompleteParticipantProfile, loadStudyProgress, saveStudyProgress, type ParticipantProfile, type StudyProgress, type StudyScreen, type SurveyId } from './lib/studyStorage';

function ProfileDialog({ initial, notice, onSave, onClose }: { initial?: ParticipantProfile; notice?: string; onSave: (profile: ParticipantProfile) => void; onClose?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [group, setGroup] = useState<StudyGroup>(initial?.group ?? 'A');
  const [researchPassword, setResearchPassword] = useState(initial?.researchPassword ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && email.trim() && researchPassword.trim()) onSave({ name: name.trim(), email: email.trim(), group, researchPassword: researchPassword.trim() });
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="participant-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="participant-title" className="text-2xl font-bold text-gray-900">Participant information</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">Enter the information assigned for this study. You can update it later.</p>
      {notice && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{notice}</p>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium text-gray-700">Contact email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium text-gray-700">Assigned group<select value={group} onChange={(event) => setGroup(event.target.value as StudyGroup)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="A">Group A</option><option value="B">Group B</option></select></label>
        <label className="block text-sm font-medium text-gray-700">Research password<input required type="text" autoComplete="off" value={researchPassword} onChange={(event) => setResearchPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <div className="flex justify-end gap-2 pt-2">{onClose && <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancel</button>}<button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">Save and continue</button></div>
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
        'Throughout the entire study, your name and email are collected only so we can award extra credit. They will be removed after the extra credit process is complete, and all study data will then be anonymized.',
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
  return <div className="min-h-screen bg-slate-50"><Header onTogglePanel={() => {}} onOpenSettings={() => {}} modelLabel="" isConfigured={false} showModelSettings={false} studyHeader={navigation} /><main className="p-6"><section className="mx-auto mt-10 max-w-2xl rounded-2xl bg-white p-8 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">{copy.eyebrow}</p><h1 className="mt-2 text-3xl font-bold text-gray-900">{copy.title}</h1><div className="mx-auto mt-4 max-w-lg space-y-3 leading-7 text-gray-600">{copy.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><a href={SURVEY_URLS[screen]} target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700">Open Google Form</a><div className="mt-8 border-t border-gray-200 pt-6"><button onClick={onComplete} className="rounded-lg border border-blue-300 bg-blue-50 px-5 py-3 font-medium text-blue-700 hover:bg-blue-100">I completed the survey — {copy.button}</button></div></section></main></div>;
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
        {navigationItems.map((entry) => {
          const index = STUDY_SEQUENCE.indexOf(entry.screen);
          const enabled = index <= progress.furthestIndex;
          return (
            <button
              key={entry.screen}
              disabled={!enabled}
              onClick={() => moveTo(entry.screen)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
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
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          Continue
        </button>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {feedbackMode && (
          <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
            {feedbackMode === 'codeflow' ? 'Flowchart feedback' : 'Textual feedback'}
          </span>
        )}
        <button
          onClick={() => setShowProfile(true)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Participant information
        </button>
      </div>
    </div>
  ) : null;

  let content;
  if (!progress.participant) content = <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">CodeFlow study</p><h1 className="mt-2 text-3xl font-bold">Welcome</h1><p className="mt-4 text-gray-600">Enter your participant information to begin Question 1.</p></section></main>;
  else if (task && feedbackMode) {
    const workspaceId = `${task.id}.v${STUDY_TASK_SET_VERSION}`;
    content = <Layout key={workspaceId} showRightPanel={showRightPanel} onTogglePanel={() => setShowRightPanel((value) => !value)} workspaceId={workspaceId} task={task} feedbackMode={feedbackMode} studyHeader={studyHeader} participant={progress.participant} onRequireParticipant={() => { setProfileNotice('Complete your name, contact email, assigned group, and research password before running code.'); setShowProfile(true); }} />;
  }
  else if (progress.currentScreen === 's1' || progress.currentScreen === 's2' || progress.currentScreen === 's3' || progress.currentScreen === 's4') content = <SurveyPage screen={progress.currentScreen} navigation={studyHeader} onComplete={() => { setProgress((current) => ({ ...current, completedSurveys: [...new Set([...current.completedSurveys, current.currentScreen])] })); continueStudy(); }} />;
  else content = <div className="min-h-screen bg-slate-50"><Header onTogglePanel={() => {}} onOpenSettings={() => {}} modelLabel="" isConfigured={false} showModelSettings={false} studyHeader={studyHeader} /><main className="flex items-center justify-center p-16"><section className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-emerald-600">Study complete</p><h1 className="mt-2 text-3xl font-bold">Thank you</h1><p className="mt-4 text-gray-600">Your study activities are complete. You may review any unlocked question or survey from the navigation above.</p></section></main></div>;
  return <>{content}{showProfile && <ProfileDialog initial={progress.participant} notice={profileNotice} onClose={hasCompleteParticipantProfile(progress.participant) ? () => { setProfileNotice(undefined); setShowProfile(false); } : undefined} onSave={(participant) => { setProgress((current) => ({ ...current, participant })); setProfileNotice(undefined); setShowProfile(false); }} />}</>;
}
