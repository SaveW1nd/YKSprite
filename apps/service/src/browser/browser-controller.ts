export type BrowserStatus = {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  engine: 'chromium';
  headless: true;
  startedAt: string | null;
  pageUrl: string | null;
  lastError: string | null;
};

export interface BrowserController {
  getStatus(): BrowserStatus;
  start(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
}
