//! AEP Rust SDK — Core Types
//!
//! Third independent implementation. MUST match TypeScript and Python test vectors.
//!
//! Reference: AEP 0.4 specification (spec/core/*).

use serde::{Deserialize, Serialize};

/// AEP protocol version.
pub const AEP_VERSION: &str = "0.1";

// ============================================================================
// Principal
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PrincipalType {
    User,
    Agent,
    Service,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Principal {
    #[serde(rename = "type")]
    pub principal_type: PrincipalType,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_chain: Option<Vec<String>>,
}

// ============================================================================
// Capability Reference
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityRef {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

// ============================================================================
// Execution Mode / Options
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    Sync,
    Async,
    Streaming,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
}

// ============================================================================
// Budget
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Budget {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_calls: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_artifact_size_mb: Option<u32>,
}

// ============================================================================
// Risk Level
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

// ============================================================================
// Execution State
// ============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionState {
    Created,
    Planned,
    AwaitingApproval,
    Authorized,
    Queued,
    Running,
    Paused,
    Cancelling,
    Cancelled,
    Retrying,
    Compensating,
    Completed,
    Failed,
    Expired,
}

impl ExecutionState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionState::Created => "created",
            ExecutionState::Planned => "planned",
            ExecutionState::AwaitingApproval => "awaiting_approval",
            ExecutionState::Authorized => "authorized",
            ExecutionState::Queued => "queued",
            ExecutionState::Running => "running",
            ExecutionState::Paused => "paused",
            ExecutionState::Cancelling => "cancelling",
            ExecutionState::Cancelled => "cancelled",
            ExecutionState::Retrying => "retrying",
            ExecutionState::Compensating => "compensating",
            ExecutionState::Completed => "completed",
            ExecutionState::Failed => "failed",
            ExecutionState::Expired => "expired",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "created" => ExecutionState::Created,
            "planned" => ExecutionState::Planned,
            "awaiting_approval" => ExecutionState::AwaitingApproval,
            "authorized" => ExecutionState::Authorized,
            "queued" => ExecutionState::Queued,
            "running" => ExecutionState::Running,
            "paused" => ExecutionState::Paused,
            "cancelling" => ExecutionState::Cancelling,
            "cancelled" => ExecutionState::Cancelled,
            "retrying" => ExecutionState::Retrying,
            "compensating" => ExecutionState::Compensating,
            "completed" => ExecutionState::Completed,
            "failed" => ExecutionState::Failed,
            "expired" => ExecutionState::Expired,
            _ => return None,
        })
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            ExecutionState::Completed
                | ExecutionState::Failed
                | ExecutionState::Cancelled
                | ExecutionState::Expired
        )
    }
}

// ============================================================================
// Error Codes
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    InvalidRequest,
    Unauthorized,
    AuthorityNotFound,
    AuthorityRevoked,
    AuthorityExpired,
    CapabilityNotFound,
    CapabilityNotAllowed,
    PolicyDenied,
    BudgetExceeded,
    Timeout,
    RateLimited,
    ProviderUnavailable,
    SchemaValidationFailed,
    InternalError,
    DelegationDenied,
    ResourceRequired,
    ResourceNotAllowed,
    SubjectMismatch,
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::InvalidRequest => "INVALID_REQUEST",
            ErrorCode::Unauthorized => "UNAUTHORIZED",
            ErrorCode::AuthorityNotFound => "AUTHORITY_NOT_FOUND",
            ErrorCode::AuthorityRevoked => "AUTHORITY_REVOKED",
            ErrorCode::AuthorityExpired => "AUTHORITY_EXPIRED",
            ErrorCode::CapabilityNotFound => "CAPABILITY_NOT_FOUND",
            ErrorCode::CapabilityNotAllowed => "CAPABILITY_NOT_ALLOWED",
            ErrorCode::PolicyDenied => "POLICY_DENIED",
            ErrorCode::BudgetExceeded => "BUDGET_EXCEEDED",
            ErrorCode::Timeout => "TIMEOUT",
            ErrorCode::RateLimited => "RATE_LIMITED",
            ErrorCode::ProviderUnavailable => "PROVIDER_UNAVAILABLE",
            ErrorCode::SchemaValidationFailed => "SCHEMA_VALIDATION_FAILED",
            ErrorCode::InternalError => "INTERNAL_ERROR",
            ErrorCode::DelegationDenied => "DELEGATION_DENIED",
            ErrorCode::ResourceRequired => "RESOURCE_REQUIRED",
            ErrorCode::ResourceNotAllowed => "RESOURCE_NOT_ALLOWED",
            ErrorCode::SubjectMismatch => "SUBJECT_MISMATCH",
        }
    }

    /// Default retryable flag per spec/10-10 §33.
    pub fn default_retryable(&self) -> bool {
        matches!(
            self,
            ErrorCode::Timeout
                | ErrorCode::RateLimited
                | ErrorCode::ProviderUnavailable
                | ErrorCode::InternalError
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AepError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AepError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        let retryable = code.default_retryable();
        Self {
            code,
            message: message.into(),
            retryable,
            retry_after_ms: None,
            recovery: None,
            details: None,
        }
    }
}

// ============================================================================
// Request / Response
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RequestType {
    Execute,
    Discover,
    Cancel,
    Resume,
    Subscribe,
    Approve,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AepRequest {
    pub aep: String,
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: RequestType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal: Option<Principal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability: Option<CapabilityRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<ExecutionOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<Budget>,
}

impl AepRequest {
    pub fn new(id: impl Into<String>, request_type: RequestType) -> Self {
        Self {
            aep: AEP_VERSION.to_string(),
            id: id.into(),
            request_type,
            principal: None,
            capability: None,
            input: None,
            execution: None,
            budget: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResponseStatus {
    Accepted,
    Completed,
    Error,
    ApprovalRequired,
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AepResponse {
    pub aep: String,
    pub id: String,
    pub status: ResponseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AepError>,
}
