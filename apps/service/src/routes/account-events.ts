export type AccountStreamEvent = {
  type: 'accounts_changed';
  accountId?: number;
};

export class AccountEventHub {
  private readonly listeners = new Set<(event: AccountStreamEvent) => void>();

  subscribe(listener: (event: AccountStreamEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: AccountStreamEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
