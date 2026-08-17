/**
 * Execution State Machine
 * Reference: spec/004-execution.md §State Machine§Allowed
  */

import type { ExecutionState } from "../core/types.js";

const ALLOWED_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  created: ["planned", "cancelled", "expired", "failed"],
  planned: ["awaiting_approval", "authorized", "queued", "cancelled", "failed", "expired"],
  awaiting_approval: ["authorized", "cancelled", "expired", "failed"],
  authorized: ["queued", "cancelled", "expired", "failed"],
  queued: ["running", "cancelled", "expired", "failed"],
  running: [
    "paused",
    "retrying",
    "compensating",
    "cancelling",
    "cancelled",
    "failed",
    "completed",
    "queued", // إعادة الطابور
  ],
  paused: ["running", "cancelled", "expired", "failed"],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  retrying: ["running", "failed", "cancelled"],
  compensating: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  expired: [],
};

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(public from: ExecutionState, public to: ExecutionState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(state: ExecutionState): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "expired"
  );
}

export function isRunning(state: ExecutionState): boolean {
  return (
    state === "running" ||
    state === "paused" ||
    state === "retrying" ||
    state === "compensating" ||
    state === "cancelling"
  );
}

/**
 * States — .
  */
export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
