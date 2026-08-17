/**
 * ExecutionRuntime — The single production runtime interface.
 * Reference: AEP_10_10_ZERO_COMPROMISE §4, §160-163
 * 
 * There is exactly ONE production runtime. The Gateway and AEPServer
 * MUST depend on this interface, never on a concrete implementation.
 * 
 * The secure path:
 * AEPServer → ExecutionRuntime → SecureExecutionEngine
 * 
 * The legacy ExecutionEngine is @deprecated (§164).
  */

import type { AEPRequest, AEPResponse, ExecutionRecord, Principal } from "../core/types.js";
import type { VerifiedPrincipal } from "../principal/authenticator.js";

export interface ExecutionRuntime {
  /**
    * Execute a request through the full secure pipeline.
    * This is the ONLY public entry point for privileged execution.
    */
  execute(request: AEPRequest): Promise<AEPResponse>;

  /**
    * Get an execution record by ID.
    * Enforces object-level authorization (§52): caller MUST be the owner
    * or share the tenant.
    */
  getExecution(id: string, principal: VerifiedPrincipal): Promise<ExecutionRecord | null>;

  /**
    * Cancel an execution.
    * Truthful cancellation (§30): transitions to `cancelling`,
    * waits for handler, only then `cancelled`.
    */
  cancel(id: string, principal: VerifiedPrincipal): Promise<{ state: string }>;

  /**
    * Resume a paused execution.
    */
  resume(id: string, principal: VerifiedPrincipal): Promise<AEPResponse>;

  /**
    * List executions for a principal (tenant-scoped).
    */
  listExecutions(
    principal: VerifiedPrincipal,
    filter?: { state?: string; limit?: number }
  ): Promise<ExecutionRecord[]>;

  /**
    * Graceful shutdown (§90):
    * stop accepting → drain safe → persist → close
    */
  shutdown(): Promise<void>;

  /**
    * Health check (§142).
    */
  health(): { live: boolean; ready: boolean; details: Record<string, unknown> };
}
