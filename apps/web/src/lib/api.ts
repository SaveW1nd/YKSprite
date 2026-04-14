export type HealthResponse = {
  status: string;
  name: string;
};

export type BrowserStatus = {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  engine: 'chromium';
  headless: true;
  startedAt: string | null;
  pageUrl: string | null;
  lastError: string | null;
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
