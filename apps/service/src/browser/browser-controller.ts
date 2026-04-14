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

export type PageSnapshot = {
  currentUrl: string | null;
  pageTitle: string | null;
  html: string | null;
};

export type ScreenshotPayload = {
  mimeType: 'image/png';
  data: string;
} | null;

export interface BrowserController {
  getStatus(): BrowserStatus;
  start(): Promise<BrowserStatus>;
  startLogin(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
  getSessionState(): Promise<SessionState>;
  saveSession(): Promise<SessionState>;
  navigate(url: string): Promise<BrowserStatus>;
  inspectPage(): Promise<PageSnapshot>;
  captureScreenshot(): Promise<ScreenshotPayload>;
}
