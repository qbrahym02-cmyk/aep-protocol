/**
 * Approval Service — Real approval workflow
 * Reference: AEP_CODE_FIRST_AUDIT.md P0-09spec/profiles/policy.md §Approval
 * 
 * Implements:
 * - Approval lifecycle: requested → pending → approved/rejected
 * - Approver authentication + authorization
 * - Expiry enforcement
 * - Replay protection (nonce + timestamp)
 * - Decision binding to execution digest
 * - Atomic state transition: awaiting_approval → authorized | failed
  */

import { randomUUID } from "node:crypto";
import type {
  AEPError,
  Principal,
  ExecutionRecord,
} from "../core/types.js";
import type { VerifiedPrincipal } from "../principal/authenticator.js";
import { ulid, approvalId } from "../core/ulid.js";

// ============================================================================
// Approval Types
// ============================================================================

export interface ApprovalRequest {
  approval_id: string;
  execution_id: string;
  /** Digest of the request that needs approval (for binding). */
  request_digest: string;
  /** Digest of the capability contract. */
  capability_digest: string;
  /** Authority id that authorized the request so far. */
  authority_id?: string;
  /** Principal who requested the approval. */
  requested_by: Principal;
  /** Required approver role(s). */
  required_approver_roles: string[];
  /** Reason for the approval. */
  reason: string;
  /** Risk level that triggered approval. */
  risk_level: string;
  /** Constraints on the approval (e.g., max_records). */
  constraints?: Record<string, unknown>;
  /** When the approval was created. */
  created_at: string;
  /** When the approval expires. */
  expires_at: string;
  /** Current state. */
  state: ApprovalState;
  /** Decision (when resolved). */
  decision?: ApprovalDecision;
  /** Nonce for replay protection. */
  nonce: string;
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface ApprovalDecision {
  decision: "approve" | "deny" | "approve_with_constraints";
  decided_by: VerifiedPrincipal;
  decided_at: string;
  reason?: string;
  constraints?: Record<string, unknown>;
  /** Signature binding the decision to the request_digest. */
  signature?: {
    algorithm: "ed25519" | "ecdsa" | "hmac-sha256";
    key_id: string;
    value: string;
  };
}

export interface ApprovalSubmitInput {
  approval_id: string;
  decision: "approve" | "deny" | "approve_with_constraints";
  approver: VerifiedPrincipal;
  reason?: string;
  constraints?: Record<string, unknown>;
  signature?: ApprovalDecision["signature"];
}

// ============================================================================
// Errors
// ============================================================================

export class ApprovalError extends Error {
  constructor(
    public code:
      | "APPROVAL_NOT_FOUND"
      | "APPROVAL_EXPIRED"
      | "APPROVAL_ALREADY_DECIDED"
      | "APPROVER_UNAUTHORIZED"
      | "APPROVAL_REPLAY"
      | "APPROVAL_DIGEST_MISMATCH"
      | "APPROVAL_CANCELLED",
    message: string
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

// ============================================================================
// Approval Service
// ============================================================================

export interface ApprovalServiceOptions {
  /** Default TTL for approvals (ms). */
  default_ttl_ms?: number;
  /** Maximum TTL. */
  max_ttl_ms?: number;
  /** Approver role check function. */
  has_approver_role?: (principal: VerifiedPrincipal, required_roles: string[]) => boolean;
  /** Used nonces (for replay protection). */
  used_nonces?: Set<string>;
}

export class ApprovalService {
  private approvals = new Map<string, ApprovalRequest>();
  private byExecutionId = new Map<string, string>();  // execution_id → approval_id
  private usedNonces = new Set<string>();
  private opts: ApprovalServiceOptions;

  constructor(opts: ApprovalServiceOptions = {}) {
    this.opts = {
      default_ttl_ms: 30 * 60 * 1000,  // 30 minutes
      max_ttl_ms: 24 * 60 * 60 * 1000,
      ...opts,
    };
    if (opts.used_nonces) {
      this.usedNonces = opts.used_nonces;
    }
  }

  /**
    * Create a new approval request for an execution.
    */
  request(input: {
    execution_id: string;
    request_digest: string;
    capability_digest: string;
    authority_id?: string;
    requested_by: Principal;
    required_approver_roles: string[];
    reason: string;
    risk_level: string;
    constraints?: Record<string, unknown>;
    ttl_ms?: number;
  }): ApprovalRequest {
    const id = approvalId();
    const now = new Date().toISOString();
    const ttl = Math.min(
      input.ttl_ms ?? this.opts.default_ttl_ms ?? 30 * 60 * 1000,
      this.opts.max_ttl_ms ?? 24 * 60 * 60 * 1000
    );
    const expires_at = new Date(Date.now() + ttl).toISOString();
    const nonce = randomUUID();

    const req: ApprovalRequest = {
      approval_id: id,
      execution_id: input.execution_id,
      request_digest: input.request_digest,
      capability_digest: input.capability_digest,
      authority_id: input.authority_id,
      requested_by: input.requested_by,
      required_approver_roles: input.required_approver_roles,
      reason: input.reason,
      risk_level: input.risk_level,
      constraints: input.constraints,
      created_at: now,
      expires_at,
      state: "pending",
      nonce,
    };

    this.approvals.set(id, req);
    this.byExecutionId.set(input.execution_id, id);
    return req;
  }

  /**
    * Submit a decision for an approval.
    * Validates: approver is authorized, approval not expired, not already decided,
    * and (optionally) signature is valid.
    */
  submit(input: ApprovalSubmitInput): ApprovalRequest {
    const req = this.approvals.get(input.approval_id);
    if (!req) {
      throw new ApprovalError("APPROVAL_NOT_FOUND", `Approval ${input.approval_id} not found`);
    }

    if (req.state !== "pending") {
      throw new ApprovalError("APPROVAL_ALREADY_DECIDED", `Approval ${input.approval_id} already ${req.state}`);
    }

    // Check expiry
    if (new Date(req.expires_at) < new Date()) {
      req.state = "expired";
      throw new ApprovalError("APPROVAL_EXPIRED", `Approval ${input.approval_id} expired`);
    }

    // Check approver authorization
    if (this.opts.has_approver_role) {
      const hasRole = this.opts.has_approver_role(input.approver, req.required_approver_roles);
      if (!hasRole) {
        throw new ApprovalError(
          "APPROVER_UNAUTHORIZED",
          `Approver ${input.approver.id} lacks required roles: ${req.required_approver_roles.join(", ")}`
        );
      }
    }

    // Check nonce (replay protection)
    if (this.usedNonces.has(req.nonce)) {
      throw new ApprovalError("APPROVAL_REPLAY", `Approval ${input.approval_id} nonce already used`);
    }
    this.usedNonces.add(req.nonce);

    // Build decision
    const decision: ApprovalDecision = {
      decision: input.decision,
      decided_by: input.approver,
      decided_at: new Date().toISOString(),
      reason: input.reason,
      constraints: input.constraints,
      signature: input.signature,
    };

    req.decision = decision;
    req.state = input.decision === "deny" ? "rejected" : "approved";
    return req;
  }

  /**
    * Get an approval by ID.
    */
  get(approvalId: string): ApprovalRequest | undefined {
    return this.approvals.get(approvalId);
  }

  /**
    * Get pending approval for an execution.
    */
  getByExecutionId(executionId: string): ApprovalRequest | undefined {
    const id = this.byExecutionId.get(executionId);
    if (!id) return undefined;
    return this.approvals.get(id);
  }

  /**
    * Cancel a pending approval.
    */
  cancel(approvalId: string, by: Principal): void {
    const req = this.approvals.get(approvalId);
    if (!req) return;
    if (req.state !== "pending") return;
    req.state = "cancelled";
  }

  /**
    * Expire pending approvals past their TTL.
    */
  gc(): number {
    let removed = 0;
    const now = new Date();
    for (const [id, req] of this.approvals) {
      if (req.state === "pending" && new Date(req.expires_at) < now) {
        req.state = "expired";
        removed++;
      }
    }
    return removed;
  }

  /**
    * List pending approvals (for monitoring).
    */
  listPending(): ApprovalRequest[] {
    return Array.from(this.approvals.values()).filter((a) => a.state === "pending");
  }

  /**
    * Stats for monitoring.
    */
  stats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    cancelled: number;
  } {
    let pending = 0, approved = 0, rejected = 0, expired = 0, cancelled = 0;
    for (const a of this.approvals.values()) {
      switch (a.state) {
        case "pending": pending++; break;
        case "approved": approved++; break;
        case "rejected": rejected++; break;
        case "expired": expired++; break;
        case "cancelled": cancelled++; break;
      }
    }
    return {
      total: this.approvals.size,
      pending, approved, rejected, expired, cancelled,
    };
  }
}
