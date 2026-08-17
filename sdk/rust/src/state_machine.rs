//! AEP Execution State Machine — MUST match TypeScript and Python implementations.
//!
//! Reference: spec/core/004-execution.md §State Machine
//!
//! All transitions not listed below MUST be rejected (return false).

use crate::types::ExecutionState;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Allowed transitions table (matches TS ALLOWED_TRANSITIONS exactly).
fn allowed_transitions() -> &'static HashMap<ExecutionState, Vec<ExecutionState>> {
    static TABLE: OnceLock<HashMap<ExecutionState, Vec<ExecutionState>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        use ExecutionState::*;
        let mut m = HashMap::new();
        m.insert(Created, vec![Planned, Cancelled, Expired, Failed]);
        m.insert(Planned, vec![AwaitingApproval, Authorized, Queued, Cancelled, Failed, Expired]);
        m.insert(AwaitingApproval, vec![Authorized, Cancelled, Expired, Failed]);
        m.insert(Authorized, vec![Queued, Cancelled, Expired, Failed]);
        m.insert(Queued, vec![Running, Cancelled, Expired, Failed]);
        m.insert(Running, vec![Paused, Retrying, Compensating, Cancelling, Cancelled, Failed, Completed, Queued]);
        m.insert(Paused, vec![Running, Cancelled, Expired, Failed]);
        m.insert(Cancelling, vec![Cancelled, Failed]);
        m.insert(Cancelled, vec![]);
        m.insert(Retrying, vec![Running, Failed, Cancelled]);
        m.insert(Compensating, vec![Completed, Failed, Cancelled]);
        m.insert(Completed, vec![]);
        m.insert(Failed, vec![]);
        m.insert(Expired, vec![]);
        m
    })
}

/// Returns true if transition is allowed.
pub fn can_transition(from: ExecutionState, to: ExecutionState) -> bool {
    allowed_transitions()
        .get(&from)
        .map(|v| v.contains(&to))
        .unwrap_or(false)
}

/// Returns true if state is terminal.
pub fn is_terminal(state: ExecutionState) -> bool {
    state.is_terminal()
}

/// String-based variant for convenience.
pub fn can_transition_str(from: &str, to: &str) -> bool {
    let from = match ExecutionState::from_str(from) {
        Some(s) => s,
        None => return false,
    };
    let to = match ExecutionState::from_str(to) {
        Some(s) => s,
        None => return false,
    };
    can_transition(from, to)
}

pub fn is_terminal_str(state: &str) -> bool {
    ExecutionState::from_str(state).map(|s| s.is_terminal()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_transitions() {
        assert!(can_transition_str("created", "planned"));
        assert!(can_transition_str("planned", "authorized"));
        assert!(can_transition_str("authorized", "queued"));
        assert!(can_transition_str("queued", "running"));
        assert!(can_transition_str("running", "completed"));
        assert!(can_transition_str("running", "failed"));
        assert!(can_transition_str("running", "paused"));
        assert!(can_transition_str("paused", "running"));
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(!can_transition_str("completed", "running"));
        assert!(!can_transition_str("failed", "running"));
        assert!(!can_transition_str("cancelled", "running"));
        assert!(!can_transition_str("expired", "running"));
        assert!(!can_transition_str("created", "running"));
        assert!(!can_transition_str("created", "completed"));
        assert!(!can_transition_str("planned", "running"));
    }

    #[test]
    fn test_terminal_states() {
        assert!(is_terminal_str("completed"));
        assert!(is_terminal_str("failed"));
        assert!(is_terminal_str("cancelled"));
        assert!(is_terminal_str("expired"));
        assert!(!is_terminal_str("running"));
        assert!(!is_terminal_str("paused"));
        assert!(!is_terminal_str("queued"));
    }
}
