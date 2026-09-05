const configuredBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');

// Local development keeps working without an env file. Production points at
// the Render backend through VITE_API_BASE_URL.
export const API_BASE_URL = configuredBaseUrl ||
  (import.meta.env?.PROD ? '' : 'http://127.0.0.1:5001');
export const API_URL = `${API_BASE_URL}/api/resource`;
export const STREAM_API_URL = `${API_BASE_URL}/api/resource/stream`;
export const CODE_ANALYSIS_URL = `${API_BASE_URL}/api/analyze-code`;
