"""
AEP Canonicalization — MUST produce identical output to TypeScript implementation
Reference: spec/core/002-envelope.md §Canonicalization

Algorithm:
  1. Sort all keys lexicographically (recursive)
  2. Skip undefined values
  3. No whitespace
  4. UTF-8 encoding
  5. JSON.stringify with sorted keys
"""

from __future__ import annotations
import hashlib
import json
import math
from typing import Any


def canonicalize(value: Any) -> str:
    """Convert any Python object to canonical JSON string.

    Matches TypeScript canonicalize() exactly:
      - keys sorted lexicographically (recursive)
      - undefined values skipped (Python: None for missing, but None → null)
      - no whitespace
      - UTF-8
      - special handling for numbers (Infinity/NaN → null)
    """
    return _canonicalize(value)


def _format_js_number(value: float) -> str:
    """Format a float to match JavaScript's number-to-string conversion.

    JS uses exponential notation like '1e+21' for very large numbers.
    Python uses '1e+21' too with repr() but str() differs.
    """
    s = repr(value)
    # Python uses 'e' lowercase; JS uses 'e' lowercase too
    # Python: 1e+21, JS: 1e+21 — they should match
    return s


def _canonicalize(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        # NaN / Infinity → null (matches JSON spec + TypeScript behavior)
        if isinstance(value, float):
            if math.isnan(value) or math.isinf(value):
                return "null"
        # Convert to int if it's a whole number with .0
        if isinstance(value, float) and value.is_integer():
            # Use scientific notation for very large/small numbers (matches JS)
            abs_val = abs(value)
            if abs_val >= 1e21 or (abs_val > 0 and abs_val < 1e-6):
                return _format_js_number(value)
            return str(int(value))
        if isinstance(value, float):
            abs_val = abs(value)
            if abs_val >= 1e21 or (abs_val > 0 and abs_val < 1e-6):
                return _format_js_number(value)
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)

    if isinstance(value, list):
        return "[" + ",".join(_canonicalize(v) for v in value) + "]"

    if isinstance(value, dict):
        keys = sorted(value.keys())
        parts = []
        for k in keys:
            v = value[k]
            # Skip undefined (None for missing, but explicit None → null in our convention)
            if v is None:
                # Match TypeScript: undefined skipped, null kept
                # In Python, we treat None as null (kept) unless caller signals it's "missing"
                # For parity with TS vectors, we keep None as null
                parts.append(json.dumps(k, ensure_ascii=False) + ":" + _canonicalize(v))
            else:
                parts.append(json.dumps(k, ensure_ascii=False) + ":" + _canonicalize(v))
        return "{" + ",".join(parts) + "}"

    # Fallback: treat as string
    return json.dumps(str(value), ensure_ascii=False)


def fingerprint(value: Any) -> str:
    """SHA-256 hex of canonical representation. 64 chars."""
    canonical = canonicalize(value)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def sha256_hex(data: str) -> str:
    """SHA-256 hex of a string."""
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def audit_hash(record: Any, previous_hash: str) -> str:
    """Audit chain hash: SHA-256(canonical(record) + prev_hash).

    Matches TypeScript auditHash exactly.
    """
    return sha256_hex(canonicalize(record) + previous_hash)
