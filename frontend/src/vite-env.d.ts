/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time fallback for the backend API URL (dev convenience). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Injected at container startup via /config.js — wins over VITE_API_URL. */
  __TASKFLOW_CONFIG__?: { apiUrl?: string };
}
