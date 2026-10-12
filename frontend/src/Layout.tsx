import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { MainContent } from './MainContent';
import { RightPanel } from './RightPanel';
import { TextualPanel } from './TextualPanel';
import { SettingsPanel } from './SettingsPanel';
import { panelConfig } from './config/panelConfig';
import type { EvaluationState, FlowchartRegenerationState, FlowchartState } from './lib/analysisRun';
import { runTrace, type TraceRequest, type TraceState } from './lib/traceRun';
import {
  describeSettings,
  loadRememberedPassword,
  toModelConfig,
  type ModelSettings,
} from './lib/modelSettings';
import { loadWorkspaceCache, updateWorkspaceCache } from './lib/workspaceCache';
import type { FeedbackMode } from './lib/workspaceCache';
import type { TextualFeedbackState } from './lib/textualFeedback';

interface LayoutProps {
  showRightPanel: boolean;
  onTogglePanel: () => void;
}

/*
 * Layout component that defines the overall structure of the application
 * It manages the main content area and the toggleable right panel
 * @param showRightPanel - Boolean indicating whether the right panel is visible
 * @param onTogglePanel - Function to toggle the visibility of the right panel
 */
export const Layout = ({
  showRightPanel,
  onTogglePanel
}: LayoutProps) => {
  const cachedWorkspace = useRef(loadWorkspaceCache()).current;
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
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>(
    cachedWorkspace?.feedbackMode ?? 'flowchart',
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

  /*
   * The model settings live here because every LLM request in the app needs
   * them: the run in MainContent, the problem upload, and the re-trace below.
   *
   * A remembered research password is restored, but a student's own API key
   * never is — it is held in this state only until the tab is closed.
   */
  const [settings, setSettings] = useState<ModelSettings | null>(() => {
    const remembered = loadRememberedPassword();
    return remembered ? { mode: 'research', password: remembered } : null;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | undefined>();

  const openSettings = useCallback((notice?: string) => {
    setSettingsNotice(notice);
    setIsSettingsOpen(true);
  }, []);

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
    updateWorkspaceCache({
      flowchartState,
      traceState,
      textualFeedbackState,
      feedbackMode,
    });
  }, [flowchartState, traceState, textualFeedbackState, feedbackMode]);

  const startRetrace = useCallback((request: TraceRequest) => {
    if (!settings) {
      openSettings('Choose a model before tracing an input.');
      return;
    }
    cancelRetrace();
    const controller = new AbortController();
    retraceAbort.current = controller;
    void runTrace(request, setTraceState, toModelConfig(settings), controller.signal)
      .finally(() => {
        if (retraceAbort.current === controller) retraceAbort.current = null;
      });
  }, [cancelRetrace, settings, openSettings]);

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
          onOpenSettings={() => openSettings()}
          modelLabel={describeSettings(settings)}
          isConfigured={settings !== null}
          feedbackMode={feedbackMode}
          onFeedbackModeChange={setFeedbackMode}
        />
        <MainContent 
          settings={settings}
          onRequireSettings={openSettings}
          flowchartState={flowchartState}
          traceState={traceState}
          onFlowchartStateChange={setFlowchartState}
          onTraceStateChange={setTraceState}
          onCancelRetrace={cancelRetrace}
          onRegisterFlowchartRegenerator={registerFlowchartRegenerator}
          feedbackMode={feedbackMode}
          textualFeedbackState={textualFeedbackState}
          onTextualFeedbackStateChange={setTextualFeedbackState}
          onRegisterTextualRegenerator={registerTextualRegenerator}
          onFlowchartRegenerateAvailabilityChange={setCanRegenerateFlowchart}
          onFlowchartRegenerationStateChange={setFlowchartRegenerationState}
          onEvaluationStateChange={setEvaluationState}
          onRunStart={() => {
            cancelRetrace();
            setTraceState({ status: 'idle' });
            if (!showRightPanel) onTogglePanel();
          }}
        />
      </div>

      {/* Right Panel - Conditionally rendered based on isVisible prop */}
      <RightPanel
        isVisible={showRightPanel && feedbackMode === 'flowchart'}
        onClose={onTogglePanel}
        onWidthChange={handleWidthChange}
        flowchartState={flowchartState}
        evaluationState={evaluationState}
        traceState={traceState}
        onRetrace={startRetrace}
        onRegenerateFlowchart={() => flowchartRegenerator.current?.()}
        canRegenerateFlowchart={canRegenerateFlowchart}
        flowchartRegenerationState={flowchartRegenerationState}
      />

      <TextualPanel
        isVisible={showRightPanel && feedbackMode === 'textual'}
        onClose={onTogglePanel}
        state={textualFeedbackState}
        width={panelWidth}
        onWidthChange={handleWidthChange}
        defaultInput=""
        onRegenerate={(input) => textualRegenerator.current?.(input)}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={setSettings}
        notice={settingsNotice}
      />
    </div>
  );
};
