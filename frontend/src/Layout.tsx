import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Header } from './Header';
import { MainContent } from './MainContent';
import { RightPanel } from './RightPanel';
import { TextualPanel } from './TextualPanel';
import { panelConfig } from './config/panelConfig';
import type { EvaluationState, FlowchartRegenerationState, FlowchartState } from './lib/analysisRun';
import { runTrace, type TraceRequest, type TraceState } from './lib/traceRun';
import {
  toModelConfig,
  type ModelSettings,
} from './lib/modelSettings';
import { loadWorkspaceCache, updateWorkspaceCache } from './lib/workspaceCache';
import type { FeedbackMode, StudyTask } from './config/studyConfig';
import type { TextualFeedbackState } from './lib/textualFeedback';
import type { ParticipantProfile } from './lib/studyStorage';
import type { SupportedLanguage } from './lib/codeAnalysis';
import {
  createSubmission,
  updateSubmission,
  type CreatedSubmission,
  type SubmissionUpdate,
} from './lib/submissions';

interface LayoutProps {
  showRightPanel: boolean;
  onTogglePanel: () => void;
  workspaceId: string;
  task: StudyTask;
  feedbackMode: FeedbackMode;
  studyHeader: ReactNode;
  participant: ParticipantProfile;
}

/*
 * Layout component that defines the overall structure of the application
 * It manages the main content area and the toggleable right panel
 * @param showRightPanel - Boolean indicating whether the right panel is visible
 * @param onTogglePanel - Function to toggle the visibility of the right panel
 */
export const Layout = ({
  showRightPanel,
  onTogglePanel,
  workspaceId,
  task,
  feedbackMode,
  studyHeader,
  participant,
}: LayoutProps) => {
  const cachedWorkspace = useRef(loadWorkspaceCache(workspaceId)).current;
  // State to manage the width of the right panel, initialized with default width from config
  const [panelWidth, setPanelWidth] = useState(() =>
    panelConfig.defaultWidth()
  );
  
  // Keep status and data together so closing the panel does not lose progress.
  const [flowchartState, setFlowchartState] = useState<FlowchartState>(
    cachedWorkspace?.flowchartState ?? { status: 'idle' },
  );
  const [flowchartRegenerationState, setFlowchartRegenerationState] =
    useState<FlowchartRegenerationState>({ status: 'idle' });
  const [evaluationState, setEvaluationState] = useState<EvaluationState>(
    cachedWorkspace?.evaluationState ?? { status: 'idle' },
  );
  const [textualFeedbackState, setTextualFeedbackState] = useState<TextualFeedbackState>(
    cachedWorkspace?.textualFeedbackState ?? { status: 'idle' },
  );

  // The trace lives here rather than in the panel so that a re-trace survives
  // the panel being closed, and so a new run can cancel one the student left
  // running against flowcharts that no longer exist.
  const [traceState, setTraceState] = useState<TraceState>(
    cachedWorkspace?.traceState ?? { status: 'idle' },
  );
  const retraceAbort = useRef<AbortController | null>(null);
  const flowchartRegenerator = useRef<(() => void) | null>(null);
  const textualRegenerator = useRef<((input: string) => void) | null>(null);
  const [canRegenerateFlowchart, setCanRegenerateFlowchart] = useState(false);
  const restoredSubmission = cachedWorkspace?.activeSubmission?.participantEmail === participant.email.trim().toLowerCase()
    ? cachedWorkspace.activeSubmission
    : undefined;
  const activeSubmissionRef = useRef(restoredSubmission);
  const [activeSubmission, setActiveSubmission] = useState(restoredSubmission);
  const submissionUpdateChain = useRef<Promise<void>>(Promise.resolve());
  const [submissionSyncError, setSubmissionSyncError] = useState<string | null>(null);

  // Study participants enter the shared password with their participant data.
  // Every model request uses that research configuration; there is no separate
  // provider/settings workflow in the study UI.
  const settings = useMemo<ModelSettings>(
    () => ({ mode: 'research', password: participant.researchPassword }),
    [participant.researchPassword],
  );

  const persistSubmissionUpdate = useCallback((update: SubmissionUpdate) => {
    const submission = activeSubmissionRef.current;
    if (!submission) return;
    const submissionId = submission.submissionId;
    submissionUpdateChain.current = submissionUpdateChain.current
      .catch(() => undefined)
      .then(() => updateSubmission(
        submissionId,
        participant.researchPassword,
        update,
      ))
      .then(() => setSubmissionSyncError(null))
      .catch((error: unknown) => {
        setSubmissionSyncError(
          error instanceof Error ? error.message : 'Submission result could not be saved.',
        );
      });
  }, [participant.researchPassword]);

  const handleCreateSubmission = useCallback(async (
    sourceCode: string,
    language: SupportedLanguage,
  ): Promise<CreatedSubmission> => {
    const created = await createSubmission({
      name: participant.name,
      email: participant.email,
      group: participant.group,
      questionId: task.id,
      sourceCode,
      language,
      feedbackFormat: feedbackMode,
      researchPassword: participant.researchPassword,
    });
    const stored = {
      ...created,
      participantEmail: participant.email.trim().toLowerCase(),
    };
    activeSubmissionRef.current = stored;
    setActiveSubmission(stored);
    setSubmissionSyncError(null);
    return created;
  }, [feedbackMode, participant, task.id]);

  useEffect(() => {
    if (participant.email.trim().toLowerCase() === activeSubmissionRef.current?.participantEmail) return;
    activeSubmissionRef.current = undefined;
    setActiveSubmission(undefined);
  }, [participant.email]);

  useEffect(() => {
    updateWorkspaceCache({ activeSubmission }, workspaceId);
  }, [activeSubmission, workspaceId]);

  useEffect(() => {
    if (evaluationState.status === 'success' || evaluationState.status === 'error') {
      persistSubmissionUpdate({ terminalResult: evaluationState });
    }
  }, [evaluationState, persistSubmissionUpdate]);

  useEffect(() => {
    if (feedbackMode !== 'codeflow') return;
    if (flowchartState.status === 'success' || flowchartState.status === 'error') {
      const savedState = flowchartState.status === 'success'
        ? { status: 'success', data: flowchartState.data }
        : { status: 'error', error: flowchartState.error };
      persistSubmissionUpdate({ flowchart: savedState });
    }
  }, [feedbackMode, flowchartState, persistSubmissionUpdate]);

  useEffect(() => {
    if (feedbackMode !== 'codeflow') return;
    if (traceState.status === 'success' || traceState.status === 'error' || traceState.status === 'skipped') {
      const savedState = traceState.status === 'success'
        ? {
            status: 'success',
            data: traceState.data,
            testCase: traceState.request.testCase,
            ...(traceState.warning ? { warning: traceState.warning } : {}),
          }
        : traceState.status === 'error'
          ? {
              status: 'error',
              error: traceState.error,
              testCase: traceState.request.testCase,
            }
          : traceState;
      persistSubmissionUpdate({ codeTrace: savedState });
    }
  }, [feedbackMode, persistSubmissionUpdate, traceState]);

  useEffect(() => {
    if (feedbackMode !== 'textual') return;
    if (textualFeedbackState.status === 'success' || textualFeedbackState.status === 'error') {
      persistSubmissionUpdate({ textualFeedback: textualFeedbackState });
    }
  }, [feedbackMode, persistSubmissionUpdate, textualFeedbackState]);

  const cancelRetrace = useCallback(() => {
    retraceAbort.current?.abort();
    retraceAbort.current = null;
  }, []);

  const registerFlowchartRegenerator = useCallback((handler: (() => void) | null) => {
    flowchartRegenerator.current = handler;
  }, []);
  const registerTextualRegenerator = useCallback((handler: ((input: string) => void) | null) => {
    textualRegenerator.current = handler;
  }, []);

  useEffect(() => cancelRetrace, [cancelRetrace]);

  useEffect(() => {
    updateWorkspaceCache({ flowchartState, traceState, textualFeedbackState }, workspaceId);
  }, [flowchartState, traceState, textualFeedbackState, workspaceId]);

  const startRetrace = useCallback((request: TraceRequest) => {
    cancelRetrace();
    const controller = new AbortController();
    retraceAbort.current = controller;
    void runTrace(request, setTraceState, toModelConfig(settings), controller.signal)
      .finally(() => {
        if (retraceAbort.current === controller) retraceAbort.current = null;
      });
  }, [cancelRetrace, settings]);

  /**
   * Handler function to update the panel width
   * @param width - New width value for the panel
   */
  const handleWidthChange = (width: number) => {
    setPanelWidth(width);
  };
  
  return (
    // Main container with flex layout and full height
    <div className="flex h-screen bg-gray-50">
      {/* Main Content Area */}
      <div
        className="flex-1 flex flex-col transition-all duration-300"
        style={{
          // Apply margin based on panel visibility to make space for the right panel
          marginRight: showRightPanel ? `${panelWidth}px` : '0px'
        }}
      >
        <Header
          onTogglePanel={onTogglePanel}
          onOpenSettings={() => {}}
          modelLabel=""
          isConfigured
          showModelSettings={false}
          studyHeader={studyHeader}
          feedbackMode={feedbackMode}
        />
        {submissionSyncError && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm font-medium text-red-700">
            {submissionSyncError} Please click Run Code again.
          </div>
        )}
        <MainContent 
          workspaceId={workspaceId}
          task={task}
          feedbackMode={feedbackMode}
          textualFeedbackState={textualFeedbackState}
          onTextualFeedbackStateChange={setTextualFeedbackState}
          settings={settings}
          onCreateSubmission={handleCreateSubmission}
          onRequireSettings={() => {}}
          flowchartState={flowchartState}
          traceState={traceState}
          onFlowchartStateChange={setFlowchartState}
          onTraceStateChange={setTraceState}
          onCancelRetrace={cancelRetrace}
          onRegisterFlowchartRegenerator={registerFlowchartRegenerator}
          onRegisterTextualRegenerator={registerTextualRegenerator}
          onFlowchartRegenerateAvailabilityChange={setCanRegenerateFlowchart}
          onFlowchartRegenerationStateChange={setFlowchartRegenerationState}
          onEvaluationStateChange={setEvaluationState}
          onRunStart={() => {
            cancelRetrace();
            activeSubmissionRef.current = undefined;
            setActiveSubmission(undefined);
            setEvaluationState({ status: 'idle' });
            setFlowchartState({ status: 'idle' });
            setTraceState({ status: 'idle' });
            setTextualFeedbackState({ status: 'idle' });
            setSubmissionSyncError(null);
            if (!showRightPanel) onTogglePanel();
          }}
        />
      </div>

      {/* Right Panel - Conditionally rendered based on isVisible prop */}
      {feedbackMode === 'codeflow' && <RightPanel
        isVisible={showRightPanel}
        onClose={onTogglePanel}
        onWidthChange={handleWidthChange}
        flowchartState={flowchartState}
        evaluationState={evaluationState}
        traceState={traceState}
        onRetrace={startRetrace}
        onRegenerateFlowchart={() => flowchartRegenerator.current?.()}
        canRegenerateFlowchart={canRegenerateFlowchart}
        flowchartRegenerationState={flowchartRegenerationState}
      />}
      {feedbackMode === 'textual' && <TextualPanel
        isVisible={showRightPanel}
        onClose={onTogglePanel}
        state={textualFeedbackState}
        width={panelWidth}
        onWidthChange={handleWidthChange}
        defaultInput={task.problem.examples[0]?.input ?? ''}
        onRegenerate={(input) => textualRegenerator.current?.(input)}
      />}

    </div>
  );
};
