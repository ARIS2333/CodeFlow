import { useCallback, useRef, useState } from 'react';
import { Header } from './Header';
import { MainContent } from './MainContent';
import { RightPanel } from './RightPanel';
import { panelConfig } from './config/panelConfig';
import type { FlowchartState } from './lib/analysisRun';
import { runTrace, type TraceRequest, type TraceState } from './lib/traceRun';

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
  // State to manage the width of the right panel, initialized with default width from config
  const [panelWidth, setPanelWidth] = useState(() =>
    panelConfig.defaultWidth()
  );
  
  // Keep status and data together so closing the panel does not lose progress.
  const [flowchartState, setFlowchartState] = useState<FlowchartState>({ status: 'idle' });

  // The trace lives here rather than in the panel so that a re-trace survives
  // the panel being closed, and so a new run can cancel one the student left
  // running against flowcharts that no longer exist.
  const [traceState, setTraceState] = useState<TraceState>({ status: 'idle' });
  const retraceAbort = useRef<AbortController | null>(null);

  const startRetrace = useCallback((request: TraceRequest) => {
    retraceAbort.current?.abort();
    const controller = new AbortController();
    retraceAbort.current = controller;
    void runTrace(request, setTraceState, controller.signal);
  }, []);

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
        />
        <MainContent 
          flowchartState={flowchartState}
          onFlowchartStateChange={setFlowchartState}
          onTraceStateChange={setTraceState}
          onRunStart={() => {
            retraceAbort.current?.abort();
            setTraceState({ status: 'idle' });
            if (!showRightPanel) onTogglePanel();
          }}
        />
      </div>

      {/* Right Panel - Conditionally rendered based on isVisible prop */}
      <RightPanel
        isVisible={showRightPanel}
        onClose={onTogglePanel}
        onWidthChange={handleWidthChange}
        flowchartState={flowchartState}
        traceState={traceState}
        onRetrace={startRetrace}
      />
    </div>
  );
};
