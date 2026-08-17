/**
 * Canonicalization & Fingerprint
 * Reference: spec/002-envelope.md §Canonicalizationspec/003-capabilities.md §Capability Fingerprint
  */

import { createHash } from "node:crypto";

/**
 * object canonical JSON string.
 * - lexicographically
 * - without whitespace
 * - UTF-8
 * - 
  */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .filter((k) => obj[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") +
      "}"
    );
  }

  return "null";
}

/**
 * SHA-256 canonical representation.
 * Uses fingerprintcache keydeduplicationaudit integrity.
  */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * SHA-256 .
  */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Hash chain audit log (tamper-evident).
 * hash_n = SHA256(canonical(record_n) || hash_(n-1))
  */
export function auditHash(record: unknown, previousHash: string): string {
  return sha256(canonicalize(record) + previousHash);
}
