/**
 * Coalescing single-flight runner for retain flushes.
 *
 * `retainBatch({ async: false })` waits for server-side LLM extraction, which
 * can take seconds. Mid-session flushes therefore must not block the agent:
 * `request()` is fire-and-forget, and while a flush is in flight further
 * requests collapse into one trailing run instead of piling up.
 *
 * Boundary flushes use `request()` + `whenIdle()` so shutdown still waits for
 * the queue to be durable on the server.
 */
export class FlushRunner {
  private inFlight: Promise<void> | null = null;
  private trailing = false;
  private runs = 0;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly onError?: (error: unknown) => void,
  ) {}

  request(): void {
    if (this.inFlight) {
      this.trailing = true;
      return;
    }
    this.runs += 1;
    this.inFlight = this.execute();
  }

  /** Resolves once no run is in flight and no trailing run is pending. */
  async whenIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  /** Number of started runs; used by tests to prove coalescing. */
  get runCount(): number {
    return this.runs;
  }

  reset(): void {
    this.trailing = false;
  }

  private async execute(): Promise<void> {
    try {
      await this.task();
    } catch (error) {
      // A failed flush must never break the event that triggered it; the queue
      // file is still on disk and the next trigger retries it.
      this.onError?.(error);
    } finally {
      this.inFlight = null;
      if (this.trailing) {
        this.trailing = false;
        this.request();
      }
    }
  }
}
