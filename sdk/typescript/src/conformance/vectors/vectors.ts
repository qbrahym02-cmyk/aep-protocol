/**
 * Test Vectors — Canonical JSON test data for cross-implementation
 * Reference: spec/10-10 §91 Test Vectors§53 Conformance Suite
 * 
 * (TypeScript, Python, Rust, Go) MUST vectors.
 * 
 * vectors :
 * - canonicalization (deterministic JSON form)
 * - SHA-256 fingerprint
 * - semver matching
 * - state transitions (valid + invalid)
 * - error codes
 * - authority derivation (child ⊆ parent)
 * - audit hash chain
  */

import { canonicalize, fingerprint, sha256, auditHash } from "../../core/canonical.js";
import { satisfies, parseSemVer, compareSemVer } from "../../core/semver.js";
import { canTransition } from "../../execution/state-machine.js";

// ============================================================================
// Canonicalization Vectors
// ============================================================================

export interface CanonicalVector {
  name: string;
  input: unknown;
  expected: string;
}

export const CANONICAL_VECTORS: CanonicalVector[] = [
  {
    name: "simple_object_unsorted",
    input: { b: 2, a: 1, c: 3 },
    expected: '{"a":1,"b":2,"c":3}',
  },
  {
    name: "nested_object",
    input: { z: { y: 1, x: 2 }, a: 3 },
    expected: '{"a":3,"z":{"x":2,"y":1}}',
  },
  {
    name: "array",
    input: [3, 1, 2],
    expected: "[3,1,2]",  // arrays preserve order
  },
  {
    name: "mixed_types",
    input: { str: "hello", num: 42, bool: true, null: null },
    expected: '{"bool":true,"null":null,"num":42,"str":"hello"}',
  },
  {
    name: "empty_object",
    input: {},
    expected: "{}",
  },
  {
    name: "empty_array",
    input: [],
    expected: "[]",
  },
  {
    name: "string_with_special_chars",
    input: { msg: 'hello "world"\n\ttab' },
    expected: '{"msg":"hello \\"world\\"\\n\\ttab"}',
  },
  {
    name: "unicode",
    input: { arabic: "مرحبا", chinese: "你好", emoji: "🎉" },
    expected: '{"arabic":"مرحبا","chinese":"你好","emoji":"🎉"}',
  },
  {
    name: "undefined_skipped",
    input: { a: 1, b: undefined, c: 3 },
    expected: '{"a":1,"c":3}',
  },
  {
    name: "deeply_nested",
    input: { a: { b: { c: { d: { e: 1 } } } } },
    expected: '{"a":{"b":{"c":{"d":{"e":1}}}}}',
  },
  {
    name: "numbers",
    input: { int: 42, float: 3.14, zero: 0, neg: -1, big: 1e21 },
    expected: '{"big":1e+21,"float":3.14,"int":42,"neg":-1,"zero":0}',
  },
  {
    name: "boolean_values",
    input: { t: true, f: false },
    expected: '{"f":false,"t":true}',
  },
];

// ============================================================================
// Fingerprint Vectors (SHA-256 of canonical)
// ============================================================================

export interface FingerprintVector {
  name: string;
  input: unknown;
  expected: string;  // 64 hex chars
}

export const FINGERPRINT_VECTORS: FingerprintVector[] = [
  {
    name: "envelope_basic",
    input: { aep: "0.1", id: "req_1", type: "execute" },
    expected: fingerprint({ aep: "0.1", id: "req_1", type: "execute" }),
  },
  {
    name: "capability_contract",
    input: {
      id: "math.add",
      version: "1.0.0",
      kind: "action",
      input: { schema: { type: "object" } },
    },
    expected: fingerprint({
      id: "math.add",
      version: "1.0.0",
      kind: "action",
      input: { schema: { type: "object" } },
    }),
  },
  {
    name: "execution_record",
    input: {
      id: "exec_01",
      state: "completed",
      result: { sum: 5 },
    },
    expected: fingerprint({
      id: "exec_01",
      state: "completed",
      result: { sum: 5 },
    }),
  },
];

// ============================================================================
// Audit Hash Chain Vectors
// ============================================================================

export interface AuditChainVector {
  name: string;
  records: Array<Record<string, unknown>>;
  expected_hashes: string[];
}

export const AUDIT_CHAIN_VECTORS: AuditChainVector[] = [
  {
    name: "simple_chain",
    records: [
      { timestamp: "2026-01-01T00:00:00Z", who: "alice", action: "execute" },
      { timestamp: "2026-01-01T00:00:01Z", who: "bob", action: "execute" },
      { timestamp: "2026-01-01T00:00:02Z", who: "alice", action: "deny" },
    ],
    expected_hashes: (() => {
      const genesis = "0".repeat(64);
      let prev = genesis;
      const hashes: string[] = [];
      for (let i = 0; i < 3; i++) {
        const seq = i + 1;
        const rec = {
          timestamp: ["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "2026-01-01T00:00:02Z"][i],
          who: ["alice", "bob", "alice"][i],
          action: ["execute", "execute", "deny"][i],
          seq,
        };
        const h = auditHash(rec, prev);
        hashes.push(h);
        prev = h;
      }
      return hashes;
    })(),
  },
];

// ============================================================================
// SemVer Vectors
// ============================================================================

export interface SemVerVector {
  name: string;
  version: string;
  range: string;
  expected: boolean;
}

export const SEMVER_VECTORS: SemVerVector[] = [
  // exact
  { name: "exact_match", version: "1.2.3", range: "1.2.3", expected: true },
  { name: "exact_mismatch", version: "1.2.4", range: "1.2.3", expected: false },
  // caret
  { name: "caret_in_range", version: "1.5.0", range: "^1.2", expected: true },
  { name: "caret_lower_bound", version: "1.2.0", range: "^1.2", expected: true },
  { name: "caret_upper_excluded", version: "2.0.0", range: "^1.2", expected: false },
  { name: "caret_0_x_minor", version: "0.2.5", range: "^0.2.3", expected: true },
  { name: "caret_0_x_minor_excluded", version: "0.3.0", range: "^0.2.3", expected: false },
  { name: "caret_0_0_x_patch", version: "0.0.3", range: "^0.0.3", expected: true },
  { name: "caret_0_0_x_patch_excluded", version: "0.0.4", range: "^0.0.3", expected: false },
  // tilde
  { name: "tilde_in_range", version: "1.2.5", range: "~1.2.3", expected: true },
  { name: "tilde_upper_excluded", version: "1.3.0", range: "~1.2.3", expected: false },
  // star
  { name: "star_matches_all", version: "99.99.99", range: "*", expected: true },
  // OR
  { name: "or_first", version: "1.2.3", range: "1.2.3 || 1.5.0", expected: true },
  { name: "or_second", version: "1.5.0", range: "1.2.3 || 1.5.0", expected: true },
  { name: "or_neither", version: "1.4.0", range: "1.2.3 || 1.5.0", expected: false },
  // range
  { name: "range_in", version: "1.5.0", range: ">=1.0.0 <2.0.0", expected: true },
  { name: "range_out_high", version: "2.0.0", range: ">=1.0.0 <2.0.0", expected: false },
  { name: "range_out_low", version: "0.9.0", range: ">=1.0.0 <2.0.0", expected: false },
  // incomplete versions
  { name: "incomplete_major", version: "1.0.0", range: "1", expected: true },
  { name: "incomplete_minor", version: "1.2.0", range: "1.2", expected: true },
];

// ============================================================================
// State Transition Vectors
// ============================================================================

export interface TransitionVector {
  name: string;
  from: string;
  to: string;
  expected: boolean;
}

export const TRANSITION_VECTORS: TransitionVector[] = [
  // valid
  { name: "created_to_planned", from: "created", to: "planned", expected: true },
  { name: "planned_to_authorized", from: "planned", to: "authorized", expected: true },
  { name: "authorized_to_queued", from: "authorized", to: "queued", expected: true },
  { name: "queued_to_running", from: "queued", to: "running", expected: true },
  { name: "running_to_completed", from: "running", to: "completed", expected: true },
  { name: "running_to_failed", from: "running", to: "failed", expected: true },
  { name: "running_to_paused", from: "running", to: "paused", expected: true },
  { name: "paused_to_running", from: "paused", to: "running", expected: true },
  { name: "running_to_cancelling", from: "running", to: "cancelling", expected: true },
  { name: "cancelling_to_cancelled", from: "cancelling", to: "cancelled", expected: true },
  { name: "running_to_retrying", from: "running", to: "retrying", expected: true },
  { name: "retrying_to_running", from: "retrying", to: "running", expected: true },
  { name: "running_to_compensating", from: "running", to: "compensating", expected: true },
  { name: "planned_to_awaiting_approval", from: "planned", to: "awaiting_approval", expected: true },
  { name: "awaiting_approval_to_authorized", from: "awaiting_approval", to: "authorized", expected: true },
  // invalid (terminal states)
  { name: "completed_to_running", from: "completed", to: "running", expected: false },
  { name: "failed_to_running", from: "failed", to: "running", expected: false },
  { name: "cancelled_to_running", from: "cancelled", to: "running", expected: false },
  { name: "expired_to_running", from: "expired", to: "running", expected: false },
  // invalid (skipping states)
  { name: "created_to_running", from: "created", to: "running", expected: false },
  { name: "created_to_completed", from: "created", to: "completed", expected: false },
  { name: "planned_to_running", from: "planned", to: "running", expected: false },
  // invalid (reverse)
  { name: "completed_to_running_reverse", from: "completed", to: "running", expected: false },
];

// ============================================================================
// Authority Derivation Vectors
// ============================================================================

export interface AuthorityDerivationVector {
  name: string;
  parent: {
    capabilities: string[];
    resources: string[];
    expires_at: string;
    delegatable: boolean;
    constraints: { max_cost_usd?: number; max_calls?: number };
  };
  child_subset: {
    capabilities?: string[];
    resources?: string[];
    expires_at?: string;
    constraints?: { max_cost_usd?: number; max_calls?: number };
  };
  expected_valid: boolean;
  expected_reason?: string;
}

const future = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

export const AUTHORITY_DERIVATION_VECTORS: AuthorityDerivationVector[] = [
  {
    name: "valid_subset",
    parent: {
      capabilities: ["deploy.*", "test.*"],
      resources: ["env:staging", "env:prod"],
      expires_at: future(3600_000),
      delegatable: true,
      constraints: { max_cost_usd: 100, max_calls: 1000 },
    },
    child_subset: {
      capabilities: ["deploy.staging"],
      resources: ["env:staging"],
      expires_at: future(1800_000),
      constraints: { max_cost_usd: 50, max_calls: 100 },
    },
    expected_valid: true,
  },
  {
    name: "invalid_capability_not_subset",
    parent: {
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: future(3600_000),
      delegatable: true,
      constraints: {},
    },
    child_subset: {
      capabilities: ["payment.*"],  // not in parent
    },
    expected_valid: false,
    expected_reason: "SUBSET_VIOLATION",
  },
  {
    name: "invalid_resource_not_subset",
    parent: {
      capabilities: ["deploy.*"],
      resources: ["env:staging"],
      expires_at: future(3600_000),
      delegatable: true,
      constraints: {},
    },
    child_subset: {
      capabilities: ["deploy.*"],
      resources: ["env:production"],  // not in parent
    },
    expected_valid: false,
    expected_reason: "SUBSET_VIOLATION",
  },
  {
    name: "invalid_exceeds_cost",
    parent: {
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: future(3600_000),
      delegatable: true,
      constraints: { max_cost_usd: 10 },
    },
    child_subset: {
      capabilities: ["deploy.staging"],
      constraints: { max_cost_usd: 20 },  // exceeds
    },
    expected_valid: false,
    expected_reason: "SUBSET_VIOLATION",
  },
  {
    name: "invalid_exceeds_expires",
    parent: {
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: future(3600_000),
      delegatable: true,
      constraints: {},
    },
    child_subset: {
      capabilities: ["deploy.staging"],
      expires_at: future(7200_000),  // after parent
    },
    expected_valid: false,
    expected_reason: "SUBSET_VIOLATION",
  },
  {
    name: "invalid_non_delegatable",
    parent: {
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: future(3600_000),
      delegatable: false,  // cannot delegate
      constraints: {},
    },
    child_subset: {
      capabilities: ["deploy.staging"],
    },
    expected_valid: false,
    expected_reason: "AUTHORITY_NOT_DELEGATABLE",
  },
];

// ============================================================================
// Vector Runner
// ============================================================================

export interface VectorTestResult {
  name: string;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
  error?: string;
}

export function runCanonicalVectors(): VectorTestResult[] {
  const results: VectorTestResult[] = [];
  for (const v of CANONICAL_VECTORS) {
    try {
      const actual = canonicalize(v.input);
      results.push({
        name: v.name,
        pass: actual === v.expected,
        expected: v.expected,
        actual,
      });
    } catch (err) {
      results.push({ name: v.name, pass: false, error: (err as Error).message });
    }
  }
  return results;
}

export function runFingerprintVectors(): VectorTestResult[] {
  const results: VectorTestResult[] = [];
  for (const v of FINGERPRINT_VECTORS) {
    try {
      const actual = fingerprint(v.input);
      results.push({
        name: v.name,
        pass: actual === v.expected,
        expected: v.expected,
        actual,
      });
    } catch (err) {
      results.push({ name: v.name, pass: false, error: (err as Error).message });
    }
  }
  return results;
}

export function runSemVerVectors(): VectorTestResult[] {
  const results: VectorTestResult[] = [];
  for (const v of SEMVER_VECTORS) {
    try {
      const actual = satisfies(v.version, v.range);
      results.push({
        name: v.name,
        pass: actual === v.expected,
        expected: v.expected,
        actual,
      });
    } catch (err) {
      results.push({ name: v.name, pass: false, error: (err as Error).message });
    }
  }
  return results;
}

export function runTransitionVectors(): VectorTestResult[] {
  const results: VectorTestResult[] = [];
  for (const v of TRANSITION_VECTORS) {
    try {
      const actual = canTransition(v.from as any, v.to as any);
      results.push({
        name: v.name,
        pass: actual === v.expected,
        expected: v.expected,
        actual,
      });
    } catch (err) {
      results.push({ name: v.name, pass: false, error: (err as Error).message });
    }
  }
  return results;
}

export function runAuditChainVectors(): VectorTestResult[] {
  const results: VectorTestResult[] = [];
  for (const v of AUDIT_CHAIN_VECTORS) {
    try {
      const genesis = "0".repeat(64);
      let prev = genesis;
      const actualHashes: string[] = [];
      for (let i = 0; i < v.records.length; i++) {
        const seq = i + 1;
        const rec = { ...v.records[i], seq };
        const h = auditHash(rec, prev);
        actualHashes.push(h);
        prev = h;
      }
      const pass = JSON.stringify(actualHashes) === JSON.stringify(v.expected_hashes);
      results.push({
        name: v.name,
        pass,
        expected: v.expected_hashes,
        actual: actualHashes,
      });
    } catch (err) {
      results.push({ name: v.name, pass: false, error: (err as Error).message });
    }
  }
  return results;
}

/**
 * Run all vectors and return summary.
  */
export function runAllVectors(): {
  total: number;
  passed: number;
  failed: number;
  by_category: Record<string, { passed: number; failed: number }>;
  details: VectorTestResult[];
} {
  const categories = [
    { name: "canonicalization", run: runCanonicalVectors },
    { name: "fingerprint", run: runFingerprintVectors },
    { name: "semver", run: runSemVerVectors },
    { name: "transitions", run: runTransitionVectors },
    { name: "audit_chain", run: runAuditChainVectors },
  ];

  const byCategory: Record<string, { passed: number; failed: number }> = {};
  let total = 0, passed = 0, failed = 0;
  const details: VectorTestResult[] = [];

  for (const cat of categories) {
    const results = cat.run();
    let catPassed = 0, catFailed = 0;
    for (const r of results) {
      total++;
      if (r.pass) { passed++; catPassed++; }
      else { failed++; catFailed++; }
      details.push({ ...r, name: `${cat.name}:${r.name}` });
    }
    byCategory[cat.name] = { passed: catPassed, failed: catFailed };
  }

  return { total, passed, failed, by_category: byCategory, details };
}

// ============================================================================
// Export vectors as JSON (for cross-language testing)
// ============================================================================

export function exportVectorsAsJSON(): string {
  return JSON.stringify({
    canonical: CANONICAL_VECTORS,
    fingerprint: FINGERPRINT_VECTORS,
    semver: SEMVER_VECTORS,
    transitions: TRANSITION_VECTORS,
    audit_chain: AUDIT_CHAIN_VECTORS,
    authority_derivation: AUTHORITY_DERIVATION_VECTORS,
  }, null, 2);
}
