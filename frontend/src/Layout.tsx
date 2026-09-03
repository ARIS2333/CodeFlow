import { useState } from 'react';
import { Header } from './Header';
import { MainContent } from './MainContent';
import { RightPanel } from './RightPanel';
import { panelConfig } from './config/panelConfig';
import type { FlowchartState } from './lib/analysisRun';

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
          onRunStart={() => {
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
      />
    </div>
  );
};
