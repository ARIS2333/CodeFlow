import { useState } from 'react';
import { Header } from './Header';
import { MainContent } from './MainContent';
import { RightPanel } from './RightPanel';
import { panelConfig } from './config/panelConfig';

// Flowchart data interfaces
interface FlowchartNode {
  id: string;
  type?: string;
  data: {
    label: string;
  };
}

interface FlowchartEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface FlowchartData {
  student: {
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  };
  llm: {
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  };
}

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
  
  // State to manage flowchart data
  const [flowchartData, setFlowchartData] = useState<FlowchartData | null>(null);

  /**
   * Handler function to update the panel width
   * @param width - New width value for the panel
   */
  const handleWidthChange = (width: number) => {
    setPanelWidth(width);
  };
  
  /**
   * Handler function to update flowchart data
   * @param data - New flowchart data
   */
  const handleFlowchartDataChange = (data: FlowchartData | null) => {
    setFlowchartData(data);
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
          showRightPanel={showRightPanel}
          onTogglePanel={onTogglePanel}
        />
        <MainContent 
          showRightPanel={showRightPanel} 
          onFlowchartDataChange={handleFlowchartDataChange}
        />
      </div>

      {/* Right Panel - Conditionally rendered based on isVisible prop */}
      <RightPanel
        isVisible={showRightPanel}
        onClose={onTogglePanel}
        onWidthChange={handleWidthChange}
        flowchartData={flowchartData}
      />
    </div>
  );
};