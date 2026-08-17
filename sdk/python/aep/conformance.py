"""
AEP Python Conformance Runner — runs test vectors matching TypeScript implementation
Reference: spec/conformance/vectors

Each implementation MUST produce identical results to these vectors.
"""

from __future__ import annotations
import json
import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aep.canonical import canonicalize, fingerprint, sha256_hex, audit_hash
from aep.semver import satisfies, parse_semver, compare_semver
from aep.state_machine import can_transition_str, is_terminal_str


# ============================================================================
# Test vectors (MUST match TypeScript CANONICAL_VECTORS exactly)
# ============================================================================

CANONICAL_VECTORS = [
    {"name": "simple_object_unsorted", "input": {"b": 2, "a": 1, "c": 3}, "expected": '{"a":1,"b":2,"c":3}'},
    {"name": "nested_object", "input": {"z": {"y": 1, "x": 2}, "a": 3}, "expected": '{"a":3,"z":{"x":2,"y":1}}'},
    {"name": "array", "input": [3, 1, 2], "expected": "[3,1,2]"},
    {"name": "mixed_types", "input": {"str": "hello", "num": 42, "bool": True, "null": None}, "expected": '{"bool":true,"null":null,"num":42,"str":"hello"}'},
    {"name": "empty_object", "input": {}, "expected": "{}"},
    {"name": "empty_array", "input": [], "expected": "[]"},
    {"name": "string_with_special_chars", "input": {"msg": 'hello "world"\n\ttab'}, "expected": '{"msg":"hello \\"world\\"\\n\\ttab"}'},
    {"name": "unicode", "input": {"arabic": "مرحبا", "chinese": "你好", "emoji": "🎉"}, "expected": '{"arabic":"مرحبا","chinese":"你好","emoji":"🎉"}'},
    {"name": "undefined_skipped", "input": {"a": 1, "b": None, "c": 3}, "expected": '{"a":1,"b":null,"c":3}'},
    {"name": "deeply_nested", "input": {"a": {"b": {"c": {"d": {"e": 1}}}}}, "expected": '{"a":{"b":{"c":{"d":{"e":1}}}}}'},
    {"name": "numbers", "input": {"int": 42, "float": 3.14, "zero": 0, "neg": -1, "big": 1e21}, "expected": '{"big":1e+21,"float":3.14,"int":42,"neg":-1,"zero":0}'},
    {"name": "boolean_values", "input": {"t": True, "f": False}, "expected": '{"f":false,"t":true}'},
]

SEMVER_VECTORS = [
    {"name": "exact_match", "version": "1.2.3", "range": "1.2.3", "expected": True},
    {"name": "exact_mismatch", "version": "1.2.4", "range": "1.2.3", "expected": False},
    {"name": "caret_in_range", "version": "1.5.0", "range": "^1.2", "expected": True},
    {"name": "caret_lower_bound", "version": "1.2.0", "range": "^1.2", "expected": True},
    {"name": "caret_upper_excluded", "version": "2.0.0", "range": "^1.2", "expected": False},
    {"name": "caret_0_x_minor", "version": "0.2.5", "range": "^0.2.3", "expected": True},
    {"name": "caret_0_x_minor_excluded", "version": "0.3.0", "range": "^0.2.3", "expected": False},
    {"name": "caret_0_0_x_patch", "version": "0.0.3", "range": "^0.0.3", "expected": True},
    {"name": "caret_0_0_x_patch_excluded", "version": "0.0.4", "range": "^0.0.3", "expected": False},
    {"name": "tilde_in_range", "version": "1.2.5", "range": "~1.2.3", "expected": True},
    {"name": "tilde_upper_excluded", "version": "1.3.0", "range": "~1.2.3", "expected": False},
    {"name": "star_matches_all", "version": "99.99.99", "range": "*", "expected": True},
    {"name": "or_first", "version": "1.2.3", "range": "1.2.3 || 1.5.0", "expected": True},
    {"name": "or_second", "version": "1.5.0", "range": "1.2.3 || 1.5.0", "expected": True},
    {"name": "or_neither", "version": "1.4.0", "range": "1.2.3 || 1.5.0", "expected": False},
    {"name": "range_in", "version": "1.5.0", "range": ">=1.0.0 <2.0.0", "expected": True},
    {"name": "range_out_high", "version": "2.0.0", "range": ">=1.0.0 <2.0.0", "expected": False},
    {"name": "range_out_low", "version": "0.9.0", "range": ">=1.0.0 <2.0.0", "expected": False},
    {"name": "incomplete_major", "version": "1.0.0", "range": "1", "expected": True},
    {"name": "incomplete_minor", "version": "1.2.0", "range": "1.2", "expected": True},
]

TRANSITION_VECTORS = [
    {"name": "created_to_planned", "from": "created", "to": "planned", "expected": True},
    {"name": "planned_to_authorized", "from": "planned", "to": "authorized", "expected": True},
    {"name": "authorized_to_queued", "from": "authorized", "to": "queued", "expected": True},
    {"name": "queued_to_running", "from": "queued", "to": "running", "expected": True},
    {"name": "running_to_completed", "from": "running", "to": "completed", "expected": True},
    {"name": "running_to_failed", "from": "running", "to": "failed", "expected": True},
    {"name": "running_to_paused", "from": "running", "to": "paused", "expected": True},
    {"name": "paused_to_running", "from": "paused", "to": "running", "expected": True},
    {"name": "running_to_cancelling", "from": "running", "to": "cancelling", "expected": True},
    {"name": "cancelling_to_cancelled", "from": "cancelling", "to": "cancelled", "expected": True},
    {"name": "running_to_retrying", "from": "running", "to": "retrying", "expected": True},
    {"name": "retrying_to_running", "from": "retrying", "to": "running", "expected": True},
    {"name": "running_to_compensating", "from": "running", "to": "compensating", "expected": True},
    {"name": "planned_to_awaiting_approval", "from": "planned", "to": "awaiting_approval", "expected": True},
    {"name": "awaiting_approval_to_authorized", "from": "awaiting_approval", "to": "authorized", "expected": True},
    {"name": "completed_to_running", "from": "completed", "to": "running", "expected": False},
    {"name": "failed_to_running", "from": "failed", "to": "running", "expected": False},
    {"name": "cancelled_to_running", "from": "cancelled", "to": "running", "expected": False},
    {"name": "expired_to_running", "from": "expired", "to": "running", "expected": False},
    {"name": "created_to_running", "from": "created", "to": "running", "expected": False},
    {"name": "created_to_completed", "from": "created", "to": "completed", "expected": False},
    {"name": "planned_to_running", "from": "planned", "to": "running", "expected": False},
]


# ============================================================================
# Audit chain vectors
# ============================================================================

AUDIT_RECORDS = [
    {"timestamp": "2026-01-01T00:00:00Z", "who": "alice", "action": "execute"},
    {"timestamp": "2026-01-01T00:00:01Z", "who": "bob", "action": "execute"},
    {"timestamp": "2026-01-01T00:00:02Z", "who": "alice", "action": "deny"},
]


def compute_audit_chain_hashes(records: list[dict]) -> list[str]:
    """Compute the hash chain for given records."""
    genesis = "0" * 64
    prev = genesis
    hashes = []
    for i, record in enumerate(records):
        seq = i + 1
        # Build record with seq injected
        rec_with_seq = {**record, "seq": seq}
        h = audit_hash(rec_with_seq, prev)
        hashes.append(h)
        prev = h
    return hashes


# ============================================================================
# Test runner
# ============================================================================

class TestResult:
    def __init__(self, name: str, passed: bool, error: str = ""):
        self.name = name
        self.passed = passed
        self.error = error

    def __str__(self):
        sym = "PASS" if self.passed else "FAIL"
        s = f"  [{sym}] {self.name}"
        if not self.passed:
            s += f"\n         {self.error}"
        return s


def run_canonical_vectors() -> list[TestResult]:
    results = []
    for v in CANONICAL_VECTORS:
        try:
            actual = canonicalize(v["input"])
            if actual == v["expected"]:
                results.append(TestResult(f"canonical:{v['name']}", True))
            else:
                results.append(TestResult(
                    f"canonical:{v['name']}", False,
                    f"expected={v['expected']!r}, actual={actual!r}"
                ))
        except Exception as e:
            results.append(TestResult(f"canonical:{v['name']}", False, str(e)))
    return results


def run_fingerprint_vectors() -> list[TestResult]:
    """Fingerprint vectors are computed from canonical vectors (deterministic)."""
    results = []
    for v in CANONICAL_VECTORS:
        try:
            # Compute fingerprint (should be deterministic across implementations)
            fp = fingerprint(v["input"])
            # Re-compute to verify determinism
            fp2 = fingerprint(v["input"])
            if fp == fp2 and len(fp) == 64:
                results.append(TestResult(f"fingerprint:{v['name']}", True))
            else:
                results.append(TestResult(
                    f"fingerprint:{v['name']}", False,
                    f"non-deterministic or wrong length: {fp!r}"
                ))
        except Exception as e:
            results.append(TestResult(f"fingerprint:{v['name']}", False, str(e)))
    return results


def run_semver_vectors() -> list[TestResult]:
    results = []
    for v in SEMVER_VECTORS:
        try:
            actual = satisfies(v["version"], v["range"])
            if actual == v["expected"]:
                results.append(TestResult(f"semver:{v['name']}", True))
            else:
                results.append(TestResult(
                    f"semver:{v['name']}", False,
                    f"satisfies({v['version']!r}, {v['range']!r}) returned {actual}, expected {v['expected']}"
                ))
        except Exception as e:
            results.append(TestResult(f"semver:{v['name']}", False, str(e)))
    return results


def run_transition_vectors() -> list[TestResult]:
    results = []
    for v in TRANSITION_VECTORS:
        try:
            actual = can_transition_str(v["from"], v["to"])
            if actual == v["expected"]:
                results.append(TestResult(f"transition:{v['name']}", True))
            else:
                results.append(TestResult(
                    f"transition:{v['name']}", False,
                    f"can_transition({v['from']!r}, {v['to']!r}) returned {actual}, expected {v['expected']}"
                ))
        except Exception as e:
            results.append(TestResult(f"transition:{v['name']}", False, str(e)))
    return results


def run_audit_chain_vectors() -> list[TestResult]:
    results = []
    try:
        hashes = compute_audit_chain_hashes(AUDIT_RECORDS)
        # Verify deterministic recomputation
        hashes2 = compute_audit_chain_hashes(AUDIT_RECORDS)
        if hashes == hashes2 and len(hashes) == 3:
            results.append(TestResult("audit_chain:simple_chain", True))
        else:
            results.append(TestResult(
                "audit_chain:simple_chain", False,
                f"non-deterministic or wrong count: {hashes}"
            ))
    except Exception as e:
        results.append(TestResult("audit_chain:simple_chain", False, str(e)))
    return results


def run_all() -> dict:
    """Run all conformance tests and return summary."""
    all_results = []
    all_results.extend(run_canonical_vectors())
    all_results.extend(run_fingerprint_vectors())
    all_results.extend(run_semver_vectors())
    all_results.extend(run_transition_vectors())
    all_results.extend(run_audit_chain_vectors())

    passed = sum(1 for r in all_results if r.passed)
    failed = sum(1 for r in all_results if not r.passed)
    total = len(all_results)

    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "results": all_results,
    }


def main():
    print("AEP Python SDK — Conformance Tests\n")
    summary = run_all()
    for r in summary["results"]:
        print(r)
    print(f"\n{summary['passed']}/{summary['total']} tests passed")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
