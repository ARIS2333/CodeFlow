import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import RightContent from './RightContent';
import { panelConfig } from './config/panelConfig';
import type { FlowchartState } from './lib/analysisRun';
import type { TraceRequest, TraceState } from './lib/traceRun';

interface RightPanelProps {
  isVisible: boolean;
  onClose: () => void;
  onWidthChange?: (width: number) => void;
  flowchartState: FlowchartState;
  traceState: TraceState;
  onRetrace: (request: TraceRequest) => void;
}

export const RightPanel = ({
  isVisible,
  onClose,
  onWidthChange,
  flowchartState,
  traceState,
  onRetrace
}: RightPanelProps) => {
  // Function to get the default width of the panel from config
  const getDefaultWidth = () => panelConfig.defaultWidth();
  
  // State to manage the panel width
  const [panelWidth, setPanelWidth] = useState(getDefaultWidth());
  
  // State to track if the user is currently dragging to resize the panel
  const [isDragging, setIsDragging] = useState(false);
  
  // Refs to store references to DOM elements and values between renders
  const panelRef = useRef(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(panelConfig.defaultWidth());

  /**
   * Handler for when the user starts dragging the resize handle
   * @param e - Mouse event
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    e.preventDefault();
  };

  // 监听窗口大小变化
  // Effect to handle window resize events
  useEffect(() => {
    const handleResize = () => {
      const minWidth = panelConfig.minWidth();
      const maxWidth = panelConfig.maxWidth();
      setPanelWidth(currentWidth => {
        // Ensure panel width stays within min/max bounds when window is resized
        if (currentWidth < minWidth) return minWidth;
        if (currentWidth > maxWidth) return maxWidth;
        return currentWidth;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Effect to handle mouse events during resizing
  useEffect(() => {
    /**
     * Handler for mouse movement during dragging
     * @param e - Mouse event
     */
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      // Calculate new width based on mouse movement
      const deltaX = startXRef.current - e.clientX;
      const minWidth = panelConfig.minWidth();
      const maxWidth = panelConfig.maxWidth();
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + deltaX));
      
      setPanelWidth(newWidth);
      onWidthChange?.(newWidth);
    };

    /**
     * Handler for when the user releases the mouse button
     */
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // Add event listeners during dragging
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    // Cleanup event listeners and styles
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, panelWidth, onWidthChange]);

  // Don't render the panel if it's not visible
  if (!isVisible) return null;

  return (
    // Main panel container positioned fixed on the right side
    <div
      ref={panelRef}
      className="fixed right-0 top-0 h-full bg-white border-l shadow-lg z-50 flex"
      style={{ width: `${panelWidth}px` }}
    >
      {/* Drag Handle - vertical bar on the left side of the panel for resizing */}
      <div
        className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex items-center justify-center transition-colors ${isDragging ? 'bg-blue-500' : ''}`}
        onMouseDown={handleMouseDown}
      >
        {/* Visual indicator in the middle of the drag handle */}
        <div className="w-0.5 h-8 bg-gray-400 opacity-50"></div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 flex flex-col">
        {/* Right Panel Header with close button */}
        <div className="flex items-center justify-end p-4 border-b bg-gray-50">
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Panel Content Area */}
        <div className="p-4 h-full overflow-auto">
          {/* Render the RightContent component inside the panel */}
          <RightContent flowchartState={flowchartState} traceState={traceState} onRetrace={onRetrace} />
        </div>
      </div>
    </div>
  );
};
