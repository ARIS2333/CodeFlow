import { useEffect, useRef, useState, type FC } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  describeSettings,
  fetchProviderCatalog,
  forgetPassword,
  rememberPassword,
  verifySettings,
  type ModelSettings,
  type ProviderCatalog,
  type ProviderId,
} from './lib/modelSettings';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ModelSettings | null;
  onSave: (settings: ModelSettings) => void;
  /** Explains why the panel opened itself, e.g. after the backend said 401. */
  notice?: string;
}

type Mode = 'research' | 'byok';

interface SecretFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}

/**
 * A masked input with a reveal toggle. Both secrets in this panel are typed by
 * hand rather than pasted from a manager, so being unable to see what was typed
 * makes a mistyped character indistinguishable from a wrong credential.
 */
const SecretField: FC<SecretFieldProps> = ({ value, onChange, placeholder, label }) => {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;

  return (
    <div className="relative mt-1">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setRevealed((shown) => !shown)}
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={revealed}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-600"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export const SettingsPanel: FC<SettingsPanelProps> = ({
  isOpen, onClose, settings, onSave, notice,
}) => {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(settings?.mode ?? 'research');
  const [password, setPassword] = useState(
    settings?.mode === 'research' ? settings.password : '',
  );
  const [provider, setProvider] = useState<ProviderId>(
    settings?.mode === 'byok' ? settings.provider : 'openai',
  );
  const [model, setModel] = useState(settings?.mode === 'byok' ? settings.model : '');
  // Never seeded from saved settings: the key is only ever held in memory, and
  // re-opening the panel should not redisplay it.
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    settings?.mode === 'byok' ? settings.baseUrl ?? '' : '',
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifyAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setCatalogError(null);
    fetchProviderCatalog(controller.signal)
      .then((loaded) => {
        setCatalog(loaded);
        // A deployment without a research password offers BYOK only.
        if (!loaded.researchModeAvailable) setMode('byok');
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setCatalogError('Could not load the provider list. Is the backend running?');
      });
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => () => verifyAbort.current?.abort(), []);

  if (!isOpen) return null;

  const draft = (): ModelSettings => mode === 'research'
    ? { mode: 'research', password: password.trim() }
    : {
      mode: 'byok',
      provider,
      model: model.trim(),
      apiKey: apiKey.trim(),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
    };

  const handleSave = async () => {
    const candidate = draft();
    setError(null);

    if (candidate.mode === 'research' && !candidate.password) {
      setError('Enter the research password.');
      return;
    }
    if (candidate.mode === 'byok' && (!candidate.model || !candidate.apiKey)) {
      setError('Model and API key are both required.');
      return;
    }

    verifyAbort.current?.abort();
    const controller = new AbortController();
    verifyAbort.current = controller;
    setChecking(true);
    try {
      const result = await verifySettings(candidate, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (candidate.mode === 'research') rememberPassword(candidate.password);
      else forgetPassword();
      onSave(candidate);
      onClose();
    } catch (saveError: unknown) {
      if (saveError instanceof DOMException && saveError.name === 'AbortError') return;
      setError('Could not reach the server.');
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  const providers = catalog?.providers ?? [];
  const selected = providers.find((option) => option.id === provider);
  const researchAvailable = catalog?.researchModeAvailable ?? true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Model settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-gray-400 transition-colors hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {notice && (
            <p className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {notice}
            </p>
          )}
          {catalogError && (
            <p className="rounded-md border-l-4 border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
              {catalogError}
            </p>
          )}

          {researchAvailable && (
            <div className="flex gap-2">
              {(['research', 'byok'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => { setMode(option); setError(null); }}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    mode === option
                      ? 'border-blue-600 bg-blue-50 font-medium text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {option === 'research' ? 'Research password' : 'Use my own model'}
                </button>
              ))}
            </div>
          )}

          {mode === 'research' ? (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Research password</span>
              <SecretField
                value={password}
                onChange={setPassword}
                placeholder="Provided by the study team"
                label="research password"
              />
              <span className="mt-1 block text-xs text-gray-500">
                Uses the study's model. The password is checked on the server and
                remembered in this browser.
              </span>
            </label>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Provider</span>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as ProviderId)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {providers.length === 0 && <option value={provider}>Loading…</option>}
                  {providers.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Model</span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={selected?.exampleModel ?? 'Model name'}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">API key</span>
                <SecretField
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder="sk-…"
                  label="API key"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  Base URL <span className="font-normal text-gray-400">(optional)</span>
                </span>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="Leave empty for the provider's default"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </label>

              <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Your key is sent to this app's server, which forwards each request
                to your provider. It is never logged or saved, and it is kept only
                until you close or reload this tab.
              </p>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <span className="text-xs text-gray-500">
            Current: {describeSettings(settings)}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={checking}
              className={`rounded-md px-4 py-2 text-sm text-white transition-colors ${
                checking ? 'cursor-not-allowed bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {checking ? 'Checking…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
