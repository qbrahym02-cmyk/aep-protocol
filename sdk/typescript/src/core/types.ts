/**
 * AEP Core Types — Types Core 
 * Reference: spec/002-envelope.md, spec/003-capabilities.md, spec/004-execution.md, spec/005-errors.md
  */

export const AEP_VERSION = "0.1" as const;

// ============================================================================
// Principal
// ============================================================================

export type PrincipalType = "user" | "agent" | "service" | "system";

export interface Principal {
  type: PrincipalType;
  id: string;
  tenant_id?: string;
  delegation_chain?: string[];
}

// ============================================================================
// Capability Reference
// ============================================================================

export interface CapabilityRef {
  id: string; // e.g. "github.issue.create"
  version?: string; // semver range: "1.2.3", "^1.2", "~1.2.3", ">=1.0.0 <2.0.0"
}

// ============================================================================
// Execution Options
// ============================================================================

export type ExecutionMode = "sync" | "async" | "streaming";

export interface ExecutionOptions {
  mode?: ExecutionMode;
  idempotency_key?: string;
  deadline?: string; // ISO 8601
  dry_run?: boolean;
  timeout_ms?: number;
  max_retries?: number;
}

export interface Budget {
  max_cost_usd?: number;
  max_calls?: number;
  max_duration_ms?: number;
  max_parallel?: number;
  max_artifact_size_mb?: number;
}

// ============================================================================
// Trace
// ============================================================================

export interface TraceContext {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  baggage?: Record<string, string>;
}

// ============================================================================
// Request Type & Envelope
// ============================================================================

export type RequestType =
  | "execute"
  | "discover"
  | "cancel"
  | "resume"
  | "subscribe"
  | "approve";

export interface AEPRequest {
  aep: typeof AEP_VERSION;
  id: string;
  type: RequestType;
  principal?: Principal;
  capability?: CapabilityRef;
  input?: unknown;
  execution?: ExecutionOptions;
  trace?: TraceContext;
  authorization?: {
    token_ref?: string;
    scopes?: string[];
    /** Bearer token from Authorization header */
    bearer_token?: string;
    /** API key from header */
    api_key?: string;
    /** mTLS subject DN (from TLS layer) */
    mtls_subject_dn?: string;
    /** mTLS cert fingerprint */
    mtls_cert_fingerprint?: string;
    /** mTLS issuer DN */
    mtls_issuer_dn?: string;
    /** mTLS cert expiry */
    mtls_valid_to?: string;
    /** SPIFFE workload identity */
    workload_spiffe_id?: string;
  };
  budget?: Budget;
  delegation?: {
    delegation_chain?: string[];
    parent_execution_id?: string;
  };
  // For "approve" type
  approval?: {
    approval_id: string;
    decision: "approve" | "deny" | "approve_with_constraints";
    constraints?: Record<string, unknown>;
  };
}

export type ResponseStatus =
  | "accepted"
  | "completed"
  | "error"
  | "approval_required"
  | "partial";

export interface AEPResponse {
  aep: typeof AEP_VERSION;
  id: string;
  status: ResponseStatus;
  execution?: {
    id: string;
    state: ExecutionState;
  };
  output?: unknown;
  artifacts?: string[];
  error?: AEPError;
  approval?: ApprovalObject;
  cursor?: string;
  partial?: boolean;
  continuation_handle?: string;
}

// ============================================================================
// Approval
// ============================================================================

export interface ApprovalObject {
  approval_id: string;
  reason: string;
  risk: RiskLevel;
  expires_at: string;
  allowed_decisions: ("approve" | "deny" | "approve_with_constraints")[];
}

// ============================================================================
// Capability Kind & Execution Semantics
// ============================================================================

export type CapabilityKind =
  | "read"
  | "query"
  | "search"
  | "transform"
  | "action"
  | "workflow"
  | "subscribe"
  | "stream"
  | "delegate"
  | "agent"
  | "artifact"
  | "ui";

export interface ExecutionSemantics {
  sync: boolean;
  async: boolean;
  streaming: boolean;
  cancel: boolean;
  retry: boolean;
  idempotent: boolean;
  dry_run: boolean;
}

// ============================================================================
// Risk
// ============================================================================

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskAssessment {
  level: RiskLevel;
  impact?:
    | "none"
    | "operational"
    | "financial"
    | "reputational"
    | "compliance"
    | "safety";
  side_effect: boolean;
  reversible: boolean;
  blast_radius?:
    | "single_record"
    | "multi_record"
    | "service"
    | "tenant"
    | "account"
    | "global";
  data_sensitivity?: "public" | "internal" | "confidential" | "restricted" | "secret";
}

// ============================================================================
// Authorization
// ============================================================================

export interface AuthorizationSpec {
  scopes: string[];
  require_approval?: "always" | "on_high_risk" | "never";
  require_strong_auth?: boolean;
  require_step_up?: boolean;
}

// ============================================================================
// Capability Contract
// ============================================================================

export interface CapabilityContract {
  id: string;
  version: string; // exact semver
  kind: CapabilityKind;
  description: string;
  input: { schema: object };
  output: { schema: object };
  errors?: Array<{
    code: string;
    description: string;
    retryable?: boolean;
  }>;
  execution: ExecutionSemantics;
  risk: RiskAssessment;
  authorization: AuthorizationSpec;
  cost?: { currency?: string; estimated?: number };
  performance?: { p50_ms?: number; p95_ms?: number };
  freshness?: "real_time" | "seconds" | "minutes" | "daily";
  compensation?: string; // inverse capability id
  provider?: { id: string; version?: string };
  region?: string;
  data_classification?: "public" | "internal" | "confidential" | "restricted" | "secret";
  semantic_class?: string;
  examples?: unknown[];
}

// ============================================================================
// Execution State Machine
// ============================================================================

export type ExecutionState =
  | "created"
  | "planned"
  | "awaiting_approval"
  | "authorized"
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "retrying"
  | "compensating"
  | "completed"
  | "failed"
  | "expired";

// ============================================================================
// Execution Record
// ============================================================================

export interface ExecutionRecord {
  id: string;
  request_id: string;
  principal: Principal;
  capability: CapabilityRef;
  capability_version?: string;
  input?: unknown;
  state: ExecutionState;
  previous_state?: ExecutionState;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  policy_decision?: PolicyDecision;
  risk_assessment?: {
    level: RiskLevel;
    score?: number;
    factors?: string[];
  };
  trace_id?: string;
  delegation_chain?: string[];
  budget?: Budget;
  budget_used?: {
    cost_usd?: number;
    calls?: number;
    duration_ms?: number;
  };
  result?: unknown;
  artifacts?: string[];
  error?: AEPError;
  approval?: {
    approval_id: string;
    decision?: "approve" | "deny" | "approve_with_constraints";
    decided_by?: string;
    decided_at?: string;
    constraints?: Record<string, unknown>;
  };
  idempotency_key?: string;
  parent_execution_id?: string;
  checkpoint_id?: string;
}

// ============================================================================
// Policy
// ============================================================================

export type PolicyEffect = "allow" | "deny" | "approval" | "constrain";

export interface PolicyRule {
  id?: string;
  principal?: string; // glob pattern
  principal_type?: PrincipalType;
  capability?: string; // glob pattern
  resource?: string;
  tenant_id?: string;
  environment?: "test" | "staging" | "production";
  effect: PolicyEffect;
  reason_code?: string;
  require?: Array<"human_approval" | "strong_auth" | "step_up" | "dry_run_first">;
  constraints?: Record<string, unknown>;
  max_risk_level?: RiskLevel;
  max_cost_usd?: number;
}

export interface PolicyDocument {
  version: string;
  id?: string;
  default_decision: "allow" | "deny";
  rules: PolicyRule[];
}

export interface PolicyDecision {
  decision: PolicyEffect;
  reason_code?: string;
  matched_rules: string[];
  constraints?: Record<string, unknown>;
}

// ============================================================================
// Error
// ============================================================================

export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CAPABILITY"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_VERSION_UNSUPPORTED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "POLICY_DENIED"
  | "RISK_TOO_HIGH"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_CONFLICT"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "EXECUTION_CANCELLED"
  | "EXECUTION_EXPIRED"
  | "CHECKPOINT_NOT_FOUND"
  | "COMPENSATION_FAILED"
  | "SCHEMA_VALIDATION_FAILED"
  | "CONCURRENCY_CONFLICT"
  | "BUDGET_EXCEEDED"
  | "DELEGATION_DENIED"
  | "TOKEN_EXPIRED"
  | "INVALID_STATE_TRANSITION"
  | "INTERNAL_ERROR";

export type RecoveryAction =
  | "retry"
  | "fallback"
  | "reauthorize"
  | "ask_user"
  | "compensate"
  | "abort";

export interface AEPError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retry_after_ms?: number;
  recovery?: RecoveryAction[];
  details?: Record<string, unknown>;
  trace_id?: string;
  execution_id?: string;
}

// ============================================================================
// Event
// ============================================================================

export interface AEPEvent {
  event_id: string;
  type: string; // e.g. "execution.started"
  source: string;
  timestamp: string;
  sequence?: number;
  execution_id?: string;
  trace_id?: string;
  principal?: Principal;
  data?: Record<string, unknown>;
  delivery?: "at_most_once" | "at_least_once" | "effectively_once";
}

// ============================================================================
// Artifact
// ============================================================================

export interface Artifact {
  id: string;
  mime_type: string;
  size: number;
  checksum: {
    algorithm: "sha256" | "sha512" | "md5";
    value: string;
  };
  encoding?: "raw" | "base64" | "url";
  location?: string;
  retention?: {
    until?: string;
    policy?: "temporary" | "permanent" | "audit";
  };
  provenance?: {
    execution_id?: string;
    capability?: string;
    sources?: string[];
  };
  access_policy?: {
    read_scopes?: string[];
    expires_at?: string;
  };
}

// ============================================================================
// Handler signature for capability implementations
// ============================================================================

export interface ExecutionContext {
  execution_id: string;
  request_id: string;
  principal: Principal;
  capability: CapabilityContract;
  input: unknown;
  trace?: TraceContext;
  budget?: Budget;
  dry_run?: boolean;
  signal?: { cancelled: boolean; onCancel?: (cb: () => void) => void };
  emit?: (type: string, data?: Record<string, unknown>) => void;
}

export interface ExecutionResult {
  output?: unknown;
  artifacts?: string[];
  error?: AEPError;
  cost_usd?: number;
}

export type CapabilityHandler = (
  ctx: ExecutionContext
) => Promise<ExecutionResult> | ExecutionResult;

// ============================================================================
// Discovery
// ============================================================================

export interface DiscoveryQuery {
  intent?: {
    description?: string;
    constraints?: {
      risk_max?: RiskLevel;
      latency_max_ms?: number;
      cost_max_usd?: number;
    };
  };
  id?: string;
  semantic_class?: string;
  kind?: CapabilityKind;
  limit?: number;
  level?: 1 | 2 | 3 | 4; // progressive disclosure
}

export interface DiscoveryResultItem {
  id: string;
  version: string;
  kind: CapabilityKind;
  description: string;
  semantic_class?: string;
  risk_level: RiskLevel;
  cost_estimated?: number;
  p95_ms?: number;
  provider?: string;
  health?: "healthy" | "degraded" | "offline" | "unknown";
  // level 2+
  contract?: CapabilityContract;
}
