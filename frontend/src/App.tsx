import { useState } from 'react';
import { Layout } from './Layout';

export default function App() {
  const [showRightPanel, setShowRightPanel] = useState(false);

  const toggleRightPanel = () => {
    setShowRightPanel(!showRightPanel);
  };

  return (
    <Layout
      showRightPanel={showRightPanel}
      onTogglePanel={toggleRightPanel}
    />
  );
}