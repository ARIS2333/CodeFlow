import type { FC } from 'react';
import {
  ExternalLink,
  FileText,
  Github,
  GraduationCap,
  Linkedin,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

interface ProjectLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

const projectLinks: ProjectLink[] = [
  {
    label: 'GitHub Repository',
    href: 'https://github.com/ARIS2333/CodeFlow',
    icon: Github,
  },
  {
    label: 'SIGCSE Poster',
    href: 'https://dl.acm.org/doi/10.1145/3770761.3777175',
    icon: FileText,
  },
  {
    label: 'Google Scholar',
    href: 'https://scholar.google.com/citations?user=4oc19mAAAAAJ&hl=en',
    icon: GraduationCap,
  },
  {
    label: 'Contact',
    href: 'https://www.linkedin.com/in/kehao-zheng-0333502b7/',
    icon: Linkedin,
  },
];

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
    <header className="border-b border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-6">
      <div className="relative flex flex-col items-center gap-3 lg:min-h-14 lg:justify-center">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-blue-200">
              <Workflow aria-hidden="true" className="h-5 w-5" strokeWidth={2.1} />
            </span>
            <h1 className="bg-gradient-to-r from-blue-700 via-indigo-600 to-violet-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
              CodeFlow
            </h1>
          </div>
          <p className="mt-1 text-xs font-medium tracking-wide text-gray-500">
            AI-assisted flowchart feedback for learning to code
          </p>
        </div>
        <div className="flex items-center gap-3 lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2">
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

      <nav aria-label="Project and research links" className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t border-gray-100 pt-3">
        {projectLinks.map(({ label, href, icon: Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
            <span>{label}</span>
            <ExternalLink
              aria-hidden="true"
              className="h-3 w-3 text-gray-400 transition-colors group-hover:text-blue-500"
              strokeWidth={1.8}
            />
          </a>
        ))}
      </nav>
    </header>
  );
};
