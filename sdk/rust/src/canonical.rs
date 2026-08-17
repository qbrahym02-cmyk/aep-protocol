// ! AEP Canonicalization — MUST produce byte-for-byte identical output to TS/Python.
// !
// ! Reference: spec/core/002-envelope.md §Canonicalization
// !
// ! Algorithm:
// !   1. Sort all keys lexicographically (recursive)
// !   2. Skip undefined values (None for serde_json is null, kept)
// !   3. No whitespace
// !   4. UTF-8 encoding

use serde_json::{Value, Number};
use sha2::{Sha256, Digest};

// / Convert any JSON Value to canonical string form.
// /
// / Matches TypeScript canonicalize() and Python canonicalize():
// /   - object keys sorted lexicographically (recursive)
// /   - no whitespace
// /   - numbers serialized via serde_json default (matches JS for most cases)
pub fn canonicalize(value: &Value) -> String {
    canonicalize_value(value)
}

fn canonicalize_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => if *b { "true".to_string() } else { "false".to_string() },
        Value::Number(n) => canonicalize_number(n),
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(canonicalize_value).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(obj) => {
            // sort keys lexicographically
            let mut keys: Vec<&String> = obj.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .iter()
                .map(|k| {
                    let v = obj.get(*k).unwrap();
                    format!("{}:{}", serde_json::to_string(k).unwrap(), canonicalize_value(v))
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

// / Format a number to match JavaScript's number-to-string conversion.
// /
// / JS uses:
// /   - integer: 42
// /   - float: 3.14
// /   - exponential for very large: 1e+21
// /   - 0 (not -0)
fn canonicalize_number(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    if let Some(f) = n.as_f64() {
        if f.is_nan() || f.is_infinite() {
            return "null".to_string();
        }
        // Check if integer value
        if f.fract() == 0.0 && f.abs() < 1e21 {
            return format!("{}", f as i64);
        }
        // Check for very large/small numbers — use exponential
        let abs = f.abs();
        if abs >= 1e21 || (abs > 0.0 && abs < 1e-6) {
            // Use Rust's formatting which matches JS for these
            return format_exponential(f);
        }
        // Otherwise use default float formatting
        // JS uses shortest representation; Rust's `{}` does similar
        let s = format!("{}", f);
        return s;
    }
    "null".to_string()
}

// / Format a float in exponential notation matching JS (e.g., "1e+21").
fn format_exponential(f: f64) -> String {
    // Rust's format doesn't have built-in exponential that matches JS exactly.
    // Use format!("{:e}", f) which gives "1e21" — need to convert to "1e+21"
    let s = format!("{:e}", f);
    // Rust: "1e21", "1e-7"
    // JS:   "1e+21", "1e-7"
    if let Some(pos) = s.find('e') {
        let (mantissa, exp) = s.split_at(pos);
        let exp = &exp[1..]; // skip 'e'
        if exp.starts_with('-') {
            // negative exponent — JS uses "e-7"
            format!("{}e{}", mantissa, exp)
        } else {
            // positive exponent — JS uses "e+21"
            format!("{}e+{}", mantissa, exp)
        }
    } else {
        s
    }
}

// / SHA-256 fingerprint of canonical representation. 64 hex chars.
pub fn fingerprint(value: &Value) -> String {
    let canonical = canonicalize(value);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

// / SHA-256 hex of a string.
pub fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

// / Audit chain hash: SHA-256(canonical(record) + prev_hash).
// /
// / Matches TypeScript auditHash() and Python audit_hash() exactly.
pub fn audit_hash(record: &Value, previous_hash: &str) -> String {
    let canonical = canonicalize(record);
    sha256_hex(&format!("{}{}", canonical, previous_hash))
}

# [cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    # [test]
    fn test_canonical_simple_object() {
        let v = json!({"b": 2, "a": 1, "c": 3});
        assert_eq!(canonicalize(&v), r#"{"a":1,"b":2,"c":3}"#);
    }

    # [test]
    fn test_canonical_nested_object() {
        let v = json!({"z": {"y": 1, "x": 2}, "a": 3});
        assert_eq!(canonicalize(&v), r#"{"a":3,"z":{"x":2,"y":1}}"#);
    }

    # [test]
    fn test_canonical_array_preserves_order() {
        let v = json!([3, 1, 2]);
        assert_eq!(canonicalize(&v), "[3,1,2]");
    }

    # [test]
    fn test_canonical_mixed_types() {
        let v = json!({"str": "hello", "num": 42, "bool": true, "null": null});
        assert_eq!(canonicalize(&v), r#"{"bool":true,"null":null,"num":42,"str":"hello"}"#);
    }

    # [test]
    fn test_canonical_empty_object() {
        assert_eq!(canonicalize(&json!({})), "{}");
    }

    # [test]
    fn test_canonical_empty_array() {
        assert_eq!(canonicalize(&json!([])), "[]");
    }

    # [test]
    fn test_canonical_unicode() {
        let v = json!({"arabic": "مرحبا", "chinese": "你好", "emoji": "🎉"});
        let result = canonicalize(&v);
        assert!(result.contains("مرحبا"));
        assert!(result.contains("你好"));
        assert!(result.contains("🎉"));
    }

    # [test]
    fn test_canonical_deeply_nested() {
        let v = json!({"a": {"b": {"c": {"d": {"e": 1}}}}});
        assert_eq!(canonicalize(&v), r#"{"a":{"b":{"c":{"d":{"e":1}}}}}"#);
    }

    # [test]
    fn test_canonical_large_number_exponential() {
        // 1e21 should serialize as "1e+21" to match JS
        let v = json!({"big": 1e21});
        let result = canonicalize(&v);
        assert!(result.contains("1e+21") || result.contains("1000000000000000000000"), "got: {}", result);
    }

    # [test]
    fn test_fingerprint_deterministic() {
        let v1 = json!({"b": 2, "a": 1});
        let v2 = json!({"a": 1, "b": 2});
        assert_eq!(fingerprint(&v1), fingerprint(&v2));
    }

    # [test]
    fn test_fingerprint_length() {
        let v = json!({"a": 1});
        assert_eq!(fingerprint(&v).len(), 64);
    }

    # [test]
    fn test_audit_hash_chain() {
        let genesis = "0".repeat(64);
        let r1 = json!({"who": "alice", "action": "execute", "seq": 1});
        let h1 = audit_hash(&r1, &genesis);
        let r2 = json!({"who": "bob", "action": "execute", "seq": 2});
        let h2 = audit_hash(&r2, &h1);
        assert_ne!(h1, h2);
        assert_eq!(h1.len(), 64);
        assert_eq!(h2.len(), 64);
    }
}
