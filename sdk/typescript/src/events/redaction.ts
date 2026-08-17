/**
 * Secret Redaction
 * Reference: spec/10-10 §44 Secret Redaction§88 Logging
 * 
 * Audit / Events / Errors MUST redaction before persistence.
 * 
 * Deletes:
 * - password, token, api_key, authorization, cookie
 * - private_key, secret
 * 
 * Supports:
 * - field names matching
 * - Bearer token patterns
 * - private key PEM blocks
  */

const SENSITIVE_FIELDS = new Set([
  "password", "passwd", "pwd",
  "token", "access_token", "refresh_token", "id_token",
  "api_key", "apikey", "x-api-key",
  "authorization",
  "cookie",
  "private_key", "privatekey", "secret",
  "client_secret",
  "credential_ref",
  "signature",
]);

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-_\.=]+/g, replacement: "Bearer [REDACTED]" },
  // API keys (common patterns)
  { pattern: /sk_[A-Za-z0-9]{20,}/g, replacement: "sk_[REDACTED]" },      // Stripe-style
  { pattern: /pk_[A-Za-z0-9]{20,}/g, replacement: "pk_[REDACTED]" },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "AKIA[REDACTED]" },        // AWS access key
  // PEM private key blocks
  { pattern: /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----/g,
    replacement: "-----BEGIN PRIVATE KEY-----[REDACTED]-----END PRIVATE KEY-----" },
];

// ============================================================================
// Redaction functions
// ============================================================================

/**
 * Redact sensitive values in an object (deep).
  */
export function redact<T>(value: T, opts: { depth?: number } = {}): T {
  return redactInternal(value, opts.depth ?? 10, new WeakSet()) as T;
}

function redactInternal(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth <= 0) return value;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "object") {
    // avoid cycles
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((v) => redactInternal(v, depth - 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveField(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactInternal(v, depth - 1, seen);
      }
    }
    return out;
  }

  return value;
}

/**
 * Redact patterns in a string.
  */
export function redactString(s: string): string {
  let result = s;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Field 
  */
export function isSensitiveField(name: string): boolean {
  const lower = name.toLowerCase();
  // exact match
  if (SENSITIVE_FIELDS.has(lower)) return true;
  // contains sensitive substring
  for (const f of SENSITIVE_FIELDS) {
    if (lower.includes(f)) return true;
  }
  return false;
}

/**
 * Filter headers — redact sensitive ones.
  */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (isSensitiveField(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactString(v);
    }
  }
  return out;
}

/**
 * Generate safe log line.
  */
export function safeLog(label: string, value: unknown): string {
  return `${label}: ${JSON.stringify(redact(value))}`;
}
