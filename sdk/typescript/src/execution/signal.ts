/**
 * Execution Signal — Abort + Timeout
 * Reference: spec/10-10 §15 Cancellation§16 Abort Architecture§17 Timeout
 * 
 * - Cancellation truthful: cancel() → AbortSignal → handler acknowledges
 * - Timeout enforced AbortController (Promise.race)
 * - ExecutionContext AbortSignal
  */

import type { AEPError } from "../core/types.js";

// ============================================================================
// ExecutionSignal
// ============================================================================

export type Unsubscribe = () => void;

export interface ExecutionSignal {
  readonly aborted: boolean;
  readonly reason?: string;
  readonly deadline?: number; // epoch ms
  /**
    * Throws if aborted.
    */
  throwIfAborted(): void;
  /**
    * Subscribe to abort event.
    */
  onAbort(callback: () => void): Unsubscribe;
  /**
    * Node.js AbortSignal (for fetch, fs, etc.)
    */
  toAbortSignal(): AbortSignal;
}

// ============================================================================
// Implementation
// ============================================================================

export class ExecutionSignalImpl implements ExecutionSignal {
  private controller = new AbortController();
  private listeners = new Set<() => void>();
  private _aborted = false;
  private _reason?: string;
  private _deadline?: number;
  private timeoutHandle?: ReturnType<typeof setTimeout>;

  constructor(opts?: { deadlineMs?: number; signal?: AbortSignal }) {
    if (opts?.deadlineMs) {
      this._deadline = Date.now() + opts.deadlineMs;
      this.timeoutHandle = setTimeout(() => {
        this.abort("TIMEOUT");
      }, opts.deadlineMs);
    }
    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => {
        this.abort(opts.signal?.reason || "PARENT_ABORTED");
      });
    }
  }

  get aborted(): boolean {
    return this._aborted || this.controller.signal.aborted;
  }

  get reason(): string | undefined {
    return this._reason;
  }

  get deadline(): number | undefined {
    return this._deadline;
  }

  abort(reason: string = "CANCELLED"): void {
    if (this._aborted) return;
    this._aborted = true;
    this._reason = reason;
    this.controller.abort(reason);
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    for (const cb of this.listeners) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  throwIfAborted(): void {
    if (this.aborted) {
      const code: AEPError["code"] = this._reason === "TIMEOUT" ? "TIMEOUT" : "EXECUTION_CANCELLED";
      const err: AEPError = {
        code,
        message: `Execution aborted: ${this._reason}`,
        retryable: code === "TIMEOUT",
      };
      throw err;
    }
  }

  onAbort(callback: () => void): Unsubscribe {
    if (this._aborted) {
      try { callback(); } catch { /* ignore */ }
      return () => { /* no-op */ };
    }
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  toAbortSignal(): AbortSignal {
    return this.controller.signal;
  }

  /**
    * Cleanup timers (when execution completes normally).
    */
  dispose(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.listeners.clear();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * signal with timeout.
  */
export function createSignal(opts: { timeoutMs?: number; parentSignal?: AbortSignal } = {}): ExecutionSignalImpl {
  return new ExecutionSignalImpl({
    deadlineMs: opts.timeoutMs,
    signal: opts.parentSignal,
  });
}

/**
 * Wrap promise with signal — Rejects when abort.
  */
export async function withSignal<T>(
  fn: (signal: ExecutionSignal) => Promise<T>,
  signal: ExecutionSignal
): Promise<T> {
  signal.throwIfAborted();
  return fn(signal);
}

/**
 * signal .
  */
export async function checkSignalWhile<T>(
  fn: () => Promise<T>,
  signal: ExecutionSignal,
  checkIntervalMs: number = 100
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal);
        return;
      }
      const interval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(interval);
          reject(signal);
        }
      }, checkIntervalMs);
      signal.onAbort(() => {
        clearInterval(interval);
        reject(signal);
      });
    }),
  ]).catch((err) => {
    if (err === signal) {
      signal.throwIfAborted();
    }
    throw err;
  });
}
