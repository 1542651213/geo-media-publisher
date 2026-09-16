export class OneShotConfirmationCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  has(identity: string): boolean { return this.inFlight.has(identity); }

  run<T>(identity: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(identity);
    if (existing) return existing as Promise<T>;
    const result = operation().finally(() => this.inFlight.delete(identity));
    this.inFlight.set(identity, result);
    return result;
  }
}
