/**
 * Recovery Engine — Crash Recovery + State Reconstruction
 * Reference: spec/10-10 §32 Replay§39 Event Sourcing§83 Crash Recovery
 * 
 * after restart:
 * load unfinished executions
 * ↓
 * reconstruct state from event log
 * ↓
 * determine safe recovery
 * ↓
 * resume / compensate / fail
 * 
 * Returns side effects .
  */

import type { ExecutionRecord, ExecutionState, AEPEvent } from "../core/types.js";
import type { ExecutionStore, EventStore, IdempotencyStore } from "../persistence/interfaces.js";

// ============================================================================
// Recovery types
// ============================================================================

export interface RecoveryReport {
  total_unfinished: number;
  recovered: Array<{
    execution_id: string;
    action: "resume" | "compensate" | "fail" | "no_action";
    reason: string;
    reconstructed_state?: ExecutionState;
  }>;
  audit_chain_valid: boolean;
  events_replayed: number;
  errors: string[];
}

export interface RecoveryOptions {
  executionStore: ExecutionStore;
  eventStore: EventStore;
  idempotencyStore?: IdempotencyStore;
  auditStore?: { verify(): Promise<{ valid: boolean; broken_at?: number }> };
  /**
    * before execution "stuck".
    * : 5 .
    */
  stuckThresholdMs?: number;
  /**
    * Must resume paused executions
    */
  resumePaused?: boolean;
}

// ============================================================================
// Recovery Engine
// ============================================================================

export class RecoveryEngine {
  private opts: RecoveryOptions;

  constructor(opts: RecoveryOptions) {
    this.opts = opts;
  }

  /**
    * executions recovery action.
    * 
    * states :
    * - created
    * - planned
    * - awaiting_approval (expire if past deadline)
    * - authorized
    * - queued
    * - running (likely crashed mid-execution)
    * - paused (resume if requested)
    * - retrying
    * - cancelling
    * - compensating
    * 
    * recovery logic:
    * - created/planned/authorized/queued → fail (never started)
    * - awaiting_approval (expired) → expire
    * - running/retrying (stuck) → compensate if has compensation, else fail
    * - paused → resume (if requested)
    * - cancelling → mark as cancelled
    * - compensating → fail (compensation was incomplete)
    */
  async recover(): Promise<RecoveryReport> {
    const errors: string[] = [];
    const recovered: RecoveryReport["recovered"] = [];
    let eventsReplayed = 0;

    // 1) verify audit chain (if available)
    let auditValid = true;
    if (this.opts.auditStore) {
      try {
        const v = await this.opts.auditStore.verify();
        auditValid = v.valid;
        if (!v.valid) {
          errors.push(`Audit chain broken at seq ${v.broken_at}`);
        }
      } catch (err) {
        errors.push(`Audit verification failed: ${(err as Error).message}`);
        auditValid = false;
      }
    }

    // 2) replay events to reconstruct state (informational)
    try {
      const events = await this.opts.eventStore.read(0);
      eventsReplayed = events.length;
    } catch (err) {
      errors.push(`Event log read failed: ${(err as Error).message}`);
    }

    // 3) find unfinished executions
    const unfinishedStates: ExecutionState[] = [
      "created", "planned", "awaiting_approval", "authorized", "queued",
      "running", "paused", "retrying", "cancelling", "compensating",
    ];

    let unfinished: ExecutionRecord[] = [];
    for (const state of unfinishedStates) {
      try {
        const records = await this.opts.executionStore.list({ state });
        unfinished = unfinished.concat(records);
      } catch (err) {
        errors.push(`Failed to list ${state} executions: ${(err as Error).message}`);
      }
    }

    // 4) for each, determine recovery action
    const now = Date.now();
    const stuckThreshold = this.opts.stuckThresholdMs || 5 * 60 * 1000;

    for (const record of unfinished) {
      const createdAt = new Date(record.created_at).getTime();
      const age = now - createdAt;
      const action = await this.determineAction(record, age, stuckThreshold);

      try {
        // apply action
        switch (action.action) {
          case "fail":
            await this.opts.executionStore.transition(
              record.id,
              record.state,
              "failed",
              { error: { code: "INTERNAL_ERROR", message: `Recovered after crash in state ${record.state}`, retryable: false } }
            );
            break;
          case "compensate":
            // mark as compensating → then fail (we don't re-execute compensation automatically)
            await this.opts.executionStore.transition(
              record.id,
              record.state,
              "compensating"
            );
            await this.opts.executionStore.transition(
              record.id,
              "compensating",
              "failed",
              { error: { code: "COMPENSATION_FAILED", message: "Recovery: compensation incomplete after crash", retryable: false } }
            );
            break;
          case "resume":
            await this.opts.executionStore.transition(
              record.id,
              "paused",
              "running"
            );
            break;
          case "no_action":
            // do nothing
            break;
        }
        recovered.push({ execution_id: record.id, ...action });
      } catch (err) {
        errors.push(`Recovery failed for ${record.id}: ${(err as Error).message}`);
        recovered.push({
          execution_id: record.id,
          action: "no_action",
          reason: `Recovery error: ${(err as Error).message}`,
        });
      }
    }

    // 5) cleanup expired idempotency entries
    if (this.opts.idempotencyStore) {
      try {
        await this.opts.idempotencyStore.gc();
      } catch (err) {
        errors.push(`Idempotency GC failed: ${(err as Error).message}`);
      }
    }

    return {
      total_unfinished: unfinished.length,
      recovered,
      audit_chain_valid: auditValid,
      events_replayed: eventsReplayed,
      errors,
    };
  }

  /**
    * action execution .
    */
  private async determineAction(
    record: ExecutionRecord,
    ageMs: number,
    stuckThresholdMs: number
  ): Promise<{ action: "resume" | "compensate" | "fail" | "no_action"; reason: string; reconstructed_state?: ExecutionState }> {
    // awaiting_approval → expire if past deadline
    if (record.state === "awaiting_approval") {
      if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
        return { action: "fail", reason: "Approval expired" };
      }
      return { action: "no_action", reason: "Still awaiting approval (not expired)" };
    }

    // paused → resume if requested
    if (record.state === "paused") {
      if (this.opts.resumePaused) {
        return { action: "resume", reason: "Resuming paused execution" };
      }
      return { action: "no_action", reason: "Paused, will not auto-resume" };
    }

    // cancelling → mark as cancelled
    if (record.state === "cancelling") {
      return { action: "fail", reason: "Cancellation was incomplete, marking as failed" };
    }

    // created/planned/authorized/queued → never started, fail
    if (["created", "planned", "authorized", "queued"].includes(record.state)) {
      return { action: "fail", reason: `Execution never started (state: ${record.state})` };
    }

    // running/retrying/compensating → check if stuck
    if (["running", "retrying", "compensating"].includes(record.state)) {
      if (ageMs < stuckThresholdMs) {
        // might still be running on another node
        return { action: "no_action", reason: `Recent execution (${ageMs}ms ago), might still be running` };
      }
      // stuck → compensate or fail
      if (record.state === "compensating") {
        return { action: "fail", reason: "Compensation was incomplete after crash" };
      }
      // check if there's a compensation capability
      // (we don't have direct access to capability contracts here, so we mark for compensation)
      return { action: "compensate", reason: `Stuck in ${record.state} for ${ageMs}ms, attempting compensation` };
    }

    return { action: "no_action", reason: `Unknown state: ${record.state}` };
  }

  /**
    * State reconstruction from event log (for a specific execution).
    * Returns the latest state inferred from events.
    * Does NOT re-execute side effects.
    */
  async reconstructState(executionId: string): Promise<{
    final_state?: ExecutionState;
    events: AEPEvent[];
    timeline: Array<{ t: number; event: string; data?: Record<string, unknown> }>;
  }> {
    const events = await this.opts.eventStore.read(0, {
      filter: (e) => e.execution_id === executionId,
    });

    if (events.length === 0) {
      return { events: [], timeline: [] };
    }

    // sort by sequence
    events.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    const t0 = new Date(events[0].timestamp).getTime();
    const timeline = events.map((e) => ({
      t: new Date(e.timestamp).getTime() - t0,
      event: e.type,
      data: e.data,
    }));

    // determine final state from event type
    const lastEvent = events[events.length - 1];
    let finalState: ExecutionState | undefined;
    const stateMap: Record<string, ExecutionState> = {
      "execution.created": "created",
      "execution.planned": "planned",
      "execution.awaiting_approval": "awaiting_approval",
      "execution.authorized": "authorized",
      "execution.queued": "queued",
      "execution.started": "running",
      "execution.paused": "paused",
      "execution.resumed": "running",
      "execution.retrying": "retrying",
      "execution.compensating": "compensating",
      "execution.cancelling": "cancelling",
      "execution.cancelled": "cancelled",
      "execution.completed": "completed",
      "execution.failed": "failed",
      "execution.expired": "expired",
    };
    finalState = stateMap[lastEvent.type];

    return { final_state: finalState, events, timeline };
  }
}
