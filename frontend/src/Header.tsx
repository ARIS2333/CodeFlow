import type { FC } from 'react';

interface HeaderProps {
  showRightPanel: boolean;
  onTogglePanel: () => void;
}

export const Header: FC<HeaderProps> = ({ showRightPanel: _showRightPanel, onTogglePanel }) => {
  return (
    <header className="bg-white shadow-sm border-b px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">CodeFlow</h1>
        <button
          onClick={onTogglePanel}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Click me
        </button>
      </div>
    </header>
  );
};