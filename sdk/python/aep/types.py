"""
AEP Python SDK — Core Types
Reference: AEP 0.3 specification (TypeScript SDK parity)

Independent implementation. MUST match TypeScript test vectors.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Union, Callable, Awaitable


# ============================================================================
# AEP Version
# ============================================================================

AEP_VERSION = "0.1"


# ============================================================================
# Principal
# ============================================================================

class PrincipalType(str, Enum):
    USER = "user"
    AGENT = "agent"
    SERVICE = "service"
    SYSTEM = "system"


@dataclass
class Principal:
    type: PrincipalType
    id: str
    tenant_id: Optional[str] = None
    delegation_chain: Optional[list[str]] = None

    def to_dict(self) -> dict:
        d: dict = {"type": self.type.value, "id": self.id}
        if self.tenant_id is not None:
            d["tenant_id"] = self.tenant_id
        if self.delegation_chain is not None:
            d["delegation_chain"] = self.delegation_chain
        return d


# ============================================================================
# Capability Reference
# ============================================================================

@dataclass
class CapabilityRef:
    id: str
    version: Optional[str] = None

    def to_dict(self) -> dict:
        d: dict = {"id": self.id}
        if self.version is not None:
            d["version"] = self.version
        return d


# ============================================================================
# Execution Options
# ============================================================================

class ExecutionMode(str, Enum):
    SYNC = "sync"
    ASYNC = "async"
    STREAMING = "streaming"


@dataclass
class ExecutionOptions:
    mode: Optional[ExecutionMode] = None
    idempotency_key: Optional[str] = None
    deadline: Optional[str] = None
    dry_run: Optional[bool] = None
    timeout_ms: Optional[int] = None
    max_retries: Optional[int] = None

    def to_dict(self) -> dict:
        d: dict = {}
        if self.mode is not None:
            d["mode"] = self.mode.value
        if self.idempotency_key is not None:
            d["idempotency_key"] = self.idempotency_key
        if self.deadline is not None:
            d["deadline"] = self.deadline
        if self.dry_run is not None:
            d["dry_run"] = self.dry_run
        if self.timeout_ms is not None:
            d["timeout_ms"] = self.timeout_ms
        if self.max_retries is not None:
            d["max_retries"] = self.max_retries
        return d


# ============================================================================
# Budget
# ============================================================================

@dataclass
class Budget:
    max_cost_usd: Optional[float] = None
    max_calls: Optional[int] = None
    max_duration_ms: Optional[int] = None
    max_parallel: Optional[int] = None
    max_artifact_size_mb: Optional[int] = None


# ============================================================================
# Risk
# ============================================================================

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class RiskAssessment:
    level: RiskLevel
    side_effect: bool
    reversible: bool
    impact: Optional[str] = None
    blast_radius: Optional[str] = None
    data_sensitivity: Optional[str] = None


# ============================================================================
# Execution Semantics
# ============================================================================

@dataclass
class ExecutionSemantics:
    sync: bool
    async_: bool  # 'async' is keyword in Python
    streaming: bool
    cancel: bool
    retry: bool
    idempotent: bool
    dry_run: bool


# ============================================================================
# Capability Kind
# ============================================================================

class CapabilityKind(str, Enum):
    READ = "read"
    QUERY = "query"
    SEARCH = "search"
    TRANSFORM = "transform"
    ACTION = "action"
    WORKFLOW = "workflow"
    SUBSCRIBE = "subscribe"
    STREAM = "stream"
    DELEGATE = "delegate"
    AGENT = "agent"
    ARTIFACT = "artifact"
    UI = "ui"


# ============================================================================
# Capability Contract
# ============================================================================

@dataclass
class CapabilityContract:
    id: str
    version: str
    kind: CapabilityKind
    description: str
    input: dict
    output: dict
    execution: ExecutionSemantics
    risk: RiskAssessment
    authorization: dict
    cost: Optional[dict] = None
    performance: Optional[dict] = None
    semantic_class: Optional[str] = None
    compensation: Optional[str] = None
    provider: Optional[dict] = None


# ============================================================================
# Execution State
# ============================================================================

class ExecutionState(str, Enum):
    CREATED = "created"
    PLANNED = "planned"
    AWAITING_APPROVAL = "awaiting_approval"
    AUTHORIZED = "authorized"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    RETRYING = "retrying"
    COMPENSATING = "compensating"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


# ============================================================================
# Error Codes
# ============================================================================

class ErrorCode(str, Enum):
    INVALID_REQUEST = "INVALID_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    AUTHORITY_NOT_FOUND = "AUTHORITY_NOT_FOUND"
    AUTHORITY_REVOKED = "AUTHORITY_REVOKED"
    AUTHORITY_EXPIRED = "AUTHORITY_EXPIRED"
    CAPABILITY_NOT_FOUND = "CAPABILITY_NOT_FOUND"
    CAPABILITY_NOT_ALLOWED = "CAPABILITY_NOT_ALLOWED"
    POLICY_DENIED = "POLICY_DENIED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    DELEGATION_DENIED = "DELEGATION_DENIED"
    RESOURCE_REQUIRED = "RESOURCE_REQUIRED"
    RESOURCE_NOT_ALLOWED = "RESOURCE_NOT_ALLOWED"
    SUBJECT_MISMATCH = "SUBJECT_MISMATCH"


@dataclass
class AEPError:
    code: ErrorCode
    message: str
    retryable: bool
    retry_after_ms: Optional[int] = None
    recovery: Optional[list[str]] = None
    details: Optional[dict] = None
    trace_id: Optional[str] = None
    execution_id: Optional[str] = None


# ============================================================================
# AEP Request / Response
# ============================================================================

class RequestType(str, Enum):
    EXECUTE = "execute"
    DISCOVER = "discover"
    CANCEL = "cancel"
    RESUME = "resume"
    SUBSCRIBE = "subscribe"
    APPROVE = "approve"


@dataclass
class AEPRequest:
    id: str
    type: RequestType
    principal: Optional[Principal] = None
    capability: Optional[CapabilityRef] = None
    input: Optional[Any] = None
    execution: Optional[ExecutionOptions] = None
    budget: Optional[Budget] = None
    aep: str = AEP_VERSION


class ResponseStatus(str, Enum):
    ACCEPTED = "accepted"
    COMPLETED = "completed"
    ERROR = "error"
    APPROVAL_REQUIRED = "approval_required"
    PARTIAL = "partial"


@dataclass
class AEPResponse:
    id: str
    status: ResponseStatus
    execution: Optional[dict] = None
    output: Optional[Any] = None
    artifacts: Optional[list[str]] = None
    error: Optional[AEPError] = None
    aep: str = AEP_VERSION
