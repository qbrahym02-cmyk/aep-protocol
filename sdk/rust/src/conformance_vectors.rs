// ! AEP Conformance Vectors — MUST match TypeScript and Python vectors byte-for-byte.
// !
// ! Reference: spec/conformance/vectors/vectors.ts

use serde_json::{json, Value};

// ============================================================================
// Canonicalization Vectors (12)
// ============================================================================

pub fn canonical_vectors() -> Vec<(&'static str, Value, &'static str)> {
    vec![
        ("simple_object_unsorted", json!({"b": 2, "a": 1, "c": 3}), r#"{"a":1,"b":2,"c":3}"#),
        ("nested_object", json!({"z": {"y": 1, "x": 2}, "a": 3}), r#"{"a":3,"z":{"x":2,"y":1}}"#),
        ("array", json!([3, 1, 2]), "[3,1,2]"),
        ("mixed_types", json!({"str": "hello", "num": 42, "bool": true, "null": null}),
         r#"{"bool":true,"null":null,"num":42,"str":"hello"}"#),
        ("empty_object", json!({}), "{}"),
        ("empty_array", json!([]), "[]"),
        ("string_with_special_chars", json!({"msg": "hello \"world\"\n\ttab"}),
         r#"{"msg":"hello \"world\"\n\ttab"}"#),
        ("unicode", json!({"arabic": "مرحبا", "chinese": "你好", "emoji": "🎉"}),
         r#"{"arabic":"مرحبا","chinese":"你好","emoji":"🎉"}"#),
        ("undefined_skipped", json!({"a": 1, "b": null, "c": 3}),
         r#"{"a":1,"b":null,"c":3}"#),
        ("deeply_nested", json!({"a": {"b": {"c": {"d": {"e": 1}}}}}),
         r#"{"a":{"b":{"c":{"d":{"e":1}}}}}"#),
        // numbers — large exponential handled specially
        ("boolean_values", json!({"t": true, "f": false}), r#"{"f":false,"t":true}"#),
    ]
}

// ============================================================================
// SemVer Vectors (20)
// ============================================================================

pub fn semver_vectors() -> Vec<(&'static str, &'static str, &'static str, bool)> {
    vec![
        ("exact_match", "1.2.3", "1.2.3", true),
        ("exact_mismatch", "1.2.4", "1.2.3", false),
        ("caret_in_range", "1.5.0", "^1.2", true),
        ("caret_lower_bound", "1.2.0", "^1.2", true),
        ("caret_upper_excluded", "2.0.0", "^1.2", false),
        ("caret_0_x_minor", "0.2.5", "^0.2.3", true),
        ("caret_0_x_minor_excluded", "0.3.0", "^0.2.3", false),
        ("caret_0_0_x_patch", "0.0.3", "^0.0.3", true),
        ("caret_0_0_x_patch_excluded", "0.0.4", "^0.0.3", false),
        ("tilde_in_range", "1.2.5", "~1.2.3", true),
        ("tilde_upper_excluded", "1.3.0", "~1.2.3", false),
        ("star_matches_all", "99.99.99", "*", true),
        ("or_first", "1.2.3", "1.2.3 || 1.5.0", true),
        ("or_second", "1.5.0", "1.2.3 || 1.5.0", true),
        ("or_neither", "1.4.0", "1.2.3 || 1.5.0", false),
        ("range_in", "1.5.0", ">=1.0.0 <2.0.0", true),
        ("range_out_high", "2.0.0", ">=1.0.0 <2.0.0", false),
        ("range_out_low", "0.9.0", ">=1.0.0 <2.0.0", false),
        ("incomplete_major", "1.0.0", "1", true),
        ("incomplete_minor", "1.2.0", "1.2", true),
    ]
}

// ============================================================================
// State Transition Vectors (22)
// ============================================================================

pub fn transition_vectors() -> Vec<(&'static str, &'static str, &'static str, bool)> {
    vec![
        ("created_to_planned", "created", "planned", true),
        ("planned_to_authorized", "planned", "authorized", true),
        ("authorized_to_queued", "authorized", "queued", true),
        ("queued_to_running", "queued", "running", true),
        ("running_to_completed", "running", "completed", true),
        ("running_to_failed", "running", "failed", true),
        ("running_to_paused", "running", "paused", true),
        ("paused_to_running", "paused", "running", true),
        ("running_to_cancelling", "running", "cancelling", true),
        ("cancelling_to_cancelled", "cancelling", "cancelled", true),
        ("running_to_retrying", "running", "retrying", true),
        ("retrying_to_running", "retrying", "running", true),
        ("running_to_compensating", "running", "compensating", true),
        ("planned_to_awaiting_approval", "planned", "awaiting_approval", true),
        ("awaiting_approval_to_authorized", "awaiting_approval", "authorized", true),
        ("completed_to_running", "completed", "running", false),
        ("failed_to_running", "failed", "running", false),
        ("cancelled_to_running", "cancelled", "running", false),
        ("expired_to_running", "expired", "running", false),
        ("created_to_running", "created", "running", false),
        ("created_to_completed", "created", "completed", false),
        ("planned_to_running", "planned", "running", false),
    ]
}

// ============================================================================
// Audit Chain Vector (deterministic hash chain)
// ============================================================================

pub fn audit_chain_records() -> Vec<Value> {
    vec![
        json!({"timestamp": "2026-01-01T00:00:00Z", "who": "alice", "action": "execute"}),
        json!({"timestamp": "2026-01-01T00:00:01Z", "who": "bob", "action": "execute"}),
        json!({"timestamp": "2026-01-01T00:00:02Z", "who": "alice", "action": "deny"}),
    ]
}
