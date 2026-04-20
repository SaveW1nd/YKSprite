import type { BrowserStatus } from './browser-controller.js';

export type AccountLoginState = {
  loginSessionId: string | null;
  accountId: number | null;
  status: 'idle' | 'pending' | 'completed' | 'error';
  qrCodeDataUrl: string | null;
  lastError: string | null;
  notice?: string | null;
  updatedAt: string | null;
};

export type StartAccountLoginInput = {
  platform?: string;
};

export interface AccountLoginController {
  start(): Promise<void | BrowserStatus>;
  stop(): Promise<void | BrowserStatus>;
  startAccountLogin(input?: StartAccountLoginInput): Promise<AccountLoginState>;
  getAccountLoginState(loginSessionId: string): Promise<AccountLoginState>;
  stopAccountLogin(loginSessionId: string): Promise<AccountLoginState>;
}
