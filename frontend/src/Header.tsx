import type { FC } from 'react';

interface HeaderProps {
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  /** Short description of the active model, e.g. "Research mode". */
  modelLabel: string;
  /** Dimmed until a model is configured, since nothing can run without one. */
  isConfigured: boolean;
}

export const Header: FC<HeaderProps> = ({
  onTogglePanel, onOpenSettings, modelLabel, isConfigured,
}) => {
  return (
    <header className="bg-white shadow-sm border-b px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">CodeFlow</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSettings}
            title="Model settings"
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
              isConfigured
                ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <span aria-hidden="true">⚙</span>
            <span>{modelLabel}</span>
          </button>
          <button
            onClick={onTogglePanel}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Code Analysis
          </button>
        </div>
      </div>
    </header>
  );
};
