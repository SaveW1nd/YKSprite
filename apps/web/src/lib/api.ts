export type HealthResponse = {
  status: string;
  name: string;
};

export type BrowserStatus = {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  engine: 'chromium';
  headless: true;
  mode: 'headless' | 'visible-login' | null;
  startedAt: string | null;
  pageUrl: string | null;
  lastError: string | null;
};

export type SessionState = {
  hasSession: boolean;
  savedAt: string | null;
  origin: string | null;
  cookieCount: number;
  currentUrl: string | null;
  pageTitle: string | null;
  mode: 'headless' | 'visible-login' | null;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/health');
  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

const readBrowserResponse = async (response: Response): Promise<BrowserStatus> => {
  if (!response.ok) {
    throw new Error(`Browser request failed with status ${response.status}`);
  }

  return response.json() as Promise<BrowserStatus>;
};

const readSessionResponse = async (response: Response): Promise<SessionState> => {
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }

  return response.json() as Promise<SessionState>;
};

export async function fetchBrowserStatus(): Promise<BrowserStatus> {
  const response = await fetch('/browser');
  return readBrowserResponse(response);
}

export async function startBrowser(): Promise<BrowserStatus> {
  const response = await fetch('/browser/start', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function stopBrowser(): Promise<BrowserStatus> {
  const response = await fetch('/browser/stop', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function startLoginSession(): Promise<BrowserStatus> {
  const response = await fetch('/browser/login/start', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function fetchSessionState(): Promise<SessionState> {
  const response = await fetch('/browser/session');
  return readSessionResponse(response);
}

export async function saveSession(): Promise<SessionState> {
  const response = await fetch('/browser/session/save', {
    method: 'POST'
  });
  return readSessionResponse(response);
}
