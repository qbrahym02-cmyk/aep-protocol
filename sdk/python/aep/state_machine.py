"""
AEP Execution State Machine — MUST match TypeScript implementation
Reference: spec/core/004-execution.md §State Machine

All transitions not listed below MUST be rejected (return False).
"""

from __future__ import annotations
from .types import ExecutionState


# Allowed transitions table
ALLOWED_TRANSITIONS: dict[ExecutionState, list[ExecutionState]] = {
    ExecutionState.CREATED: [
        ExecutionState.PLANNED, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED,
    ],
    ExecutionState.PLANNED: [
        ExecutionState.AWAITING_APPROVAL, ExecutionState.AUTHORIZED, ExecutionState.QUEUED,
        ExecutionState.CANCELLED, ExecutionState.FAILED, ExecutionState.EXPIRED,
    ],
    ExecutionState.AWAITING_APPROVAL: [
        ExecutionState.AUTHORIZED, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED,
    ],
    ExecutionState.AUTHORIZED: [
        ExecutionState.QUEUED, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED,
    ],
    ExecutionState.QUEUED: [
        ExecutionState.RUNNING, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED,
    ],
    ExecutionState.RUNNING: [
        ExecutionState.PAUSED, ExecutionState.RETRYING, ExecutionState.COMPENSATING,
        ExecutionState.CANCELLING, ExecutionState.CANCELLED, ExecutionState.FAILED,
        ExecutionState.COMPLETED, ExecutionState.QUEUED,
    ],
    ExecutionState.PAUSED: [
        ExecutionState.RUNNING, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED,
    ],
    ExecutionState.CANCELLING: [ExecutionState.CANCELLED, ExecutionState.FAILED],
    ExecutionState.CANCELLED: [],
    ExecutionState.RETRYING: [ExecutionState.RUNNING, ExecutionState.FAILED, ExecutionState.CANCELLED],
    ExecutionState.COMPENSATING: [ExecutionState.COMPLETED, ExecutionState.FAILED, ExecutionState.CANCELLED],
    ExecutionState.COMPLETED: [],
    ExecutionState.FAILED: [],
    ExecutionState.EXPIRED: [],
}


def can_transition(from_state: ExecutionState, to_state: ExecutionState) -> bool:
    """Returns True if transition is allowed."""
    allowed = ALLOWED_TRANSITIONS.get(from_state, [])
    return to_state in allowed


def is_terminal(state: ExecutionState) -> bool:
    """Terminal states: completed, failed, cancelled, expired."""
    return state in (
        ExecutionState.COMPLETED,
        ExecutionState.FAILED,
        ExecutionState.CANCELLED,
        ExecutionState.EXPIRED,
    )


def is_running(state: ExecutionState) -> bool:
    """Active running states."""
    return state in (
        ExecutionState.RUNNING,
        ExecutionState.PAUSED,
        ExecutionState.RETRYING,
        ExecutionState.COMPENSATING,
        ExecutionState.CANCELLING,
    )


# String aliases for convenience (matches TS usage with strings)
def can_transition_str(from_str: str, to_str: str) -> bool:
    """Same as can_transition but with string args."""
    try:
        return can_transition(ExecutionState(from_str), ExecutionState(to_str))
    except ValueError:
        return False


def is_terminal_str(state_str: str) -> bool:
    try:
        return is_terminal(ExecutionState(state_str))
    except ValueError:
        return False
