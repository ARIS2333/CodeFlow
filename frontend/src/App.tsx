import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Layout } from './Layout';
import { Header } from './Header';
import { STUDY_TASKS, STUDY_TASK_SET_VERSION, SURVEY_URLS, feedbackModeFor } from './config/studyConfig';
import { registerParticipant, updateParticipantName } from './lib/participants';
import { STUDY_SEQUENCE, hasCompleteParticipantProfile, loadStudyProgress, saveStudyProgress, type ParticipantProfile, type StudyProgress, type StudyScreen, type SurveyId } from './lib/studyStorage';
import { configureCloudWorkspaceSync, loadCloudStudyState, saveCloudProgress, StudyAccountNotFoundError } from './lib/studyState';
import { replaceWorkspaceCache } from './lib/workspaceCache';

function ProfileDialog({ initial, notice, onSave, onClose }: { initial?: ParticipantProfile; notice?: string; onSave: (profile: ParticipantProfile) => void; onClose?: () => void }) {
  const [studentName, setStudentName] = useState(initial?.studentName ?? '');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Keep one token for every retry so a lost response cannot consume a second
  // A/B assignment.
  const registrationId = useRef(initial?.registrationId ?? crypto.randomUUID());
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const save = async (action: 'register' | 'login') => {
    if (!studentName.trim() || password.length < 4) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const registered = await registerParticipant(
        studentName,
        registrationId.current,
        password,
        action,
      );
      onSave(registered);
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : 'Participant information could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setError('Passwords do not match. Please enter them again.');
      return;
    }
    void save('register');
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="participant-title" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
      <h2 id="participant-title" className="text-2xl font-bold text-gray-900">Participant information</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">Enter your real full name and create a password. Your feedback order will be assigned automatically.</p>
      <section aria-labelledby="before-you-begin" className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
        <h3 id="before-you-begin" className="font-semibold text-gray-900">Before you begin</h3>
        <ul className="mt-3 space-y-2.5 text-sm leading-5 text-gray-700">
          <li className="flex gap-2.5"><span aria-hidden="true">⏱️</span><span>If possible, please complete all four questions and surveys in one sitting.</span></li>
          <li className="flex gap-2.5"><span aria-hidden="true">✓</span><span>Extra credit is awarded for completing the full study, not for answering every question correctly—so don&apos;t worry!</span></li>
          <li className="flex gap-2.5"><span aria-hidden="true">💡</span><span>Do not worry about making mistakes; they actually help us understand whether the feedback is useful!</span></li>
        </ul>
      </section>
      {notice && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Full name<input required autoComplete="name" value={studentName} onChange={(event) => { setStudentName(event.target.value); setError(undefined); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Enter your real full name" maxLength={100} /><span className="mt-1.5 block text-xs leading-5 text-gray-500">Please use your real name.</span></label>
        <label className="block text-sm font-medium text-gray-700">Password<span className="relative mt-1 block"><input required type={showPassword ? 'text' : 'password'} autoComplete={initial ? 'current-password' : 'new-password'} value={password} onChange={(event) => { setPassword(event.target.value); setError(undefined); }} className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-16" placeholder={initial ? 'Enter your password to save changes' : 'Create a password'} minLength={4} maxLength={100} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 px-3 text-sm font-medium text-blue-700 hover:text-blue-900" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span><span className="mt-1.5 block text-xs leading-5 text-gray-500">Use at least 4 characters. You will need this password if you return later.</span></label>
        {!initial && <label className="block text-sm font-medium text-gray-700">Confirm password<input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => { setPasswordConfirmation(event.target.value); setError(undefined); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Enter the same password again" minLength={4} maxLength={100} /></label>}
        {!initial && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">Already started the study? Enter the same name and password, then choose <strong>Resume existing study</strong>.</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">{onClose && <button type="button" onClick={onClose} disabled={isSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>}{!initial && <button type="button" onClick={() => void save('login')} disabled={isSaving || password.length < 4 || !studentName.trim()} className="rounded-lg border border-blue-600 px-4 py-2 font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">Resume existing study</button>}<button type="submit" disabled={isSaving || password.length < 4 || (!initial && passwordConfirmation.length < 4)} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? 'Saving…' : initial ? 'Save changes' : 'Start new study'}</button></div>
      </form>
    </div>
  </div>;
}

function NameDialog({ participant, onSave, onClose }: { participant: ParticipantProfile; onSave: (profile: ParticipantProfile) => void; onClose: () => void }) {
  const [studentName, setStudentName] = useState(participant.studentName);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const normalizedName = studentName.trim().replace(/\s+/g, ' ');
  const hasChanged = Boolean(normalizedName && normalizedName !== participant.studentName);
  const save = async () => {
    if (!hasChanged) return;
    setIsSaving(true);
    setError(undefined);
    try {
      onSave(await updateParticipantName(participant.registrationId, normalizedName));
    } catch (updateError) {
      setShowConfirmation(false);
      setError(updateError instanceof Error ? updateError.message : 'Your name could not be updated.');
    } finally {
      setIsSaving(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (hasChanged) setShowConfirmation(true);
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="name-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
      <h2 id="name-title" className="text-2xl font-bold text-gray-900">Change your name</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">Use this only if you need to correct the name entered when you started the study.</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Full name<input required autoComplete="name" value={studentName} onChange={(event) => { setStudentName(event.target.value); setError(undefined); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={100} /></label>
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} disabled={isSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button><button type="submit" disabled={isSaving || !hasChanged} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500">Review change</button></div>
      </form>
    </div>
    {showConfirmation && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-name-title" className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl"><h3 id="confirm-name-title" className="text-xl font-bold text-gray-900">Change your saved name?</h3><p className="mt-3 text-sm leading-6 text-gray-600">Your name will be changed from <strong>{participant.studentName}</strong> to <strong>{normalizedName}</strong>.</p><div className="mt-6 flex justify-center gap-3"><button type="button" onClick={() => setShowConfirmation(false)} disabled={isSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Keep current name</button><button type="button" onClick={() => void save()} disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">{isSaving ? 'Saving…' : 'Confirm change'}</button></div></div></div>}
  </div>;
}

function SurveyPage({ screen, onComplete, navigation }: { screen: SurveyId; onComplete: () => void; navigation: ReactNode }) {
  const copy = {
    s1: {
      eyebrow: 'Before you begin',
      title: 'Survey 1',
      body: [
        'This survey asks about your programming background.',
        'Throughout the study, your work is associated with the name you enter.',
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
  const [cloudHydrated, setCloudHydrated] = useState(!initial.participant);
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string>();
  const activeParticipant = progress.participant;

  useEffect(() => {
    const participant = activeParticipant;
    if (!participant) {
      configureCloudWorkspaceSync(undefined);
      setCloudHydrated(true);
      setCloudSyncReady(false);
      return;
    }
    let cancelled = false;
    setCloudHydrated(false);
    setCloudSyncReady(false);
    setCloudSyncError(undefined);
    configureCloudWorkspaceSync(undefined);
    void loadCloudStudyState(participant.registrationId)
      .then((state) => {
        if (cancelled) return;
        const validWorkspaceIds = new Set(STUDY_TASKS.map((entry) => `${entry.id}.v${STUDY_TASK_SET_VERSION}`));
        Object.entries(state.workspaces).forEach(([workspaceId, workspace]) => {
          if (validWorkspaceIds.has(workspaceId) && workspace?.version === 2) {
            replaceWorkspaceCache(workspace, workspaceId);
          }
        });
        if (
          state.progress
          && STUDY_SEQUENCE.includes(state.progress.currentScreen as StudyScreen)
          && Number.isInteger(state.progress.furthestIndex)
          && state.progress.furthestIndex >= 0
          && state.progress.furthestIndex < STUDY_SEQUENCE.length
          && Array.isArray(state.progress.completedSurveys)
        ) {
          setProgress((current) => ({
            ...current,
            participant,
            currentScreen: state.progress!.currentScreen as StudyScreen,
            furthestIndex: state.progress!.furthestIndex,
            completedSurveys: state.progress!.completedSurveys,
          }));
        }
        configureCloudWorkspaceSync(participant.registrationId);
        setCloudSyncReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (error instanceof StudyAccountNotFoundError) {
            setProgress((current) => ({ ...current, participant: undefined }));
            setProfileNotice(error.message);
            setShowProfile(true);
          } else {
            setCloudSyncError(error instanceof Error ? error.message : 'Saved progress could not be loaded.');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setCloudHydrated(true);
      });
    return () => { cancelled = true; };
  }, [activeParticipant]);

  useEffect(() => {
    saveStudyProgress(progress);
    if (!cloudSyncReady || !progress.participant) return;
    void saveCloudProgress(progress.participant.registrationId, {
      currentScreen: progress.currentScreen,
      furthestIndex: progress.furthestIndex,
      completedSurveys: progress.completedSurveys,
    }).then(() => setCloudSyncError(undefined)).catch((error: unknown) => {
      setCloudSyncError(error instanceof Error ? error.message : 'Study progress could not be saved.');
    });
  }, [cloudSyncReady, progress]);
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
    { screen: 'complete', label: 'Finish' },
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
          Change name
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
        {cloudSyncError && <span className="rounded-full bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Cloud save unavailable</span>}
        {feedbackMode && (
          <span className="rounded-full bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">
            {feedbackMode === 'codeflow' ? 'Flowchart feedback' : 'Textual feedback'}
          </span>
        )}
      </div>
    </div>
  ) : null;

  let content;
  if (!progress.participant) content = <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-lg"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">CodeFlow study</p><h1 className="mt-2 text-3xl font-bold">Welcome</h1><p className="mt-4 text-gray-600">Enter your real full name to begin the study.</p></section></main>;
  else if (!cloudHydrated) content = <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="rounded-2xl bg-white px-10 py-8 text-center shadow-lg"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /><p className="mt-4 font-medium text-gray-700">Restoring your study progress…</p></section></main>;
  else if (task && feedbackMode) {
    const workspaceId = `${task.id}.v${STUDY_TASK_SET_VERSION}`;
    content = <Layout key={workspaceId} showRightPanel={showRightPanel} onTogglePanel={() => setShowRightPanel((value) => !value)} workspaceId={workspaceId} task={task} feedbackMode={feedbackMode} studyHeader={studyHeader} participant={progress.participant} onRequireParticipant={() => { setProfileNotice('Enter your name before running code.'); setShowProfile(true); }} />;
  }
  else if (progress.currentScreen === 's1' || progress.currentScreen === 's2' || progress.currentScreen === 's3' || progress.currentScreen === 's4') content = <SurveyPage screen={progress.currentScreen} navigation={studyHeader} onComplete={() => { setProgress((current) => ({ ...current, completedSurveys: [...new Set([...current.completedSurveys, current.currentScreen])] })); continueStudy(); }} />;
  else content = <div className="min-h-screen bg-slate-50"><Header onTogglePanel={() => {}} onOpenSettings={() => {}} modelLabel="" isConfigured={false} showModelSettings={false} studyHeader={studyHeader} /><main className="flex items-center justify-center p-6 sm:p-16"><section className="w-full max-w-2xl rounded-2xl bg-white p-8 text-center shadow-lg sm:p-10"><div aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><p className="mt-5 text-sm font-semibold uppercase tracking-wider text-emerald-600">Study complete</p><h1 className="mt-2 text-3xl font-bold text-gray-900">Thank you for participating!</h1><div className="mx-auto mt-5 max-w-xl space-y-3 leading-7 text-gray-600"><p>You have completed the full study. Your extra-credit reward will be issued after participation records are reviewed.</p><p>If you chose to participate in a Zoom interview, we will contact you with the next steps.</p><p className="font-medium text-gray-700">You may now close this page.</p></div></section></main></div>;
  const saveParticipant = (participant: ParticipantProfile) => {
    setCloudHydrated(false);
    setCloudSyncReady(false);
    setProgress((current) => ({ ...current, participant }));
    setProfileNotice(undefined);
    setShowProfile(false);
  };
  return <>{content}{showProfile && (progress.participant
    ? <NameDialog participant={progress.participant} onClose={() => { setProfileNotice(undefined); setShowProfile(false); }} onSave={saveParticipant} />
    : <ProfileDialog notice={profileNotice} onSave={saveParticipant} />)}</>;
}
