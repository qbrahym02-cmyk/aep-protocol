/**
 * CORS Configuration — Configurable allowlist (no wildcard by default)
 * Reference: AEP_CODE_FIRST_AUDIT.md P0-12
 * 
 * Production-safe CORS:
 * - Default: deny all origins
 * - Configurable allowlist of specific origins
 * - Per-method allowlist
 * - Per-header allowlist
 * - Credentials support (requires non-wildcard)
  */

export interface CorsConfig {
  /**
    * Allowed origins. Use [] (empty) to disable CORS entirely.
    * Default: [] (no CORS)
    */
  allowed_origins: string[];

  /**
    * Allowed methods.
    * Default: GET, POST, OPTIONS
    */
  allowed_methods?: string[];

  /**
    * Allowed request headers.
    * Default: Content-Type, Authorization, X-AEP-Trace
    */
  allowed_headers?: string[];

  /**
    * Exposed response headers.
    */
  exposed_headers?: string[];

  /**
    * Allow credentials (cookies, Authorization).
    * When true, allowed_origins MUST NOT be ["*"].
    * Default: true
    */
  allow_credentials?: boolean;

  /**
    * Max age for preflight cache (seconds).
    * Default: 600 (10 minutes)
    */
  max_age_seconds?: number;

  /**
    * Vary header value.
    * Default: "Origin"
    */
  vary?: string;

  /**
    * Allowed origins patterns (regex). Useful for subdomain matching.
    * Example: ["^https://[a-z]+\\.aep\\.dev$"]
    */
  allowed_origin_patterns?: string[];
}

export const DEFAULT_CORS_CONFIG: CorsConfig = {
  allowed_origins: [],
  allowed_methods: ["GET", "POST", "OPTIONS"],
  allowed_headers: ["Content-Type", "Authorization", "X-AEP-Trace"],
  exposed_headers: ["X-AEP-Checksum", "X-AEP-Execution-Id"],
  allow_credentials: true,
  max_age_seconds: 600,
  vary: "Origin",
};

export class CorsHandler {
  private config: CorsConfig;
  private originPatterns: RegExp[] = [];

  constructor(config: CorsConfig = DEFAULT_CORS_CONFIG) {
    this.config = config;
    if (config.allow_credentials && config.allowed_origins.includes("*")) {
      throw new Error("CORS misconfiguration: allow_credentials=true with wildcard origin is insecure");
    }
    if (config.allowed_origin_patterns) {
      this.originPatterns = config.allowed_origin_patterns.map((p) => new RegExp(p));
    }
  }

  /**
    * Get CORS headers for a request with the given Origin.
    * Returns empty object if origin is not allowed.
    */
  getHeaders(origin: string | undefined | null): Record<string, string> {
    const headers: Record<string, string> = {};

    if (!origin || this.config.allowed_origins.length === 0) {
      // No CORS — return Vary header only so caches know
      if (this.config.vary) headers["Vary"] = this.config.vary;
      return headers;
    }

    const allowed = this.isOriginAllowed(origin);
    if (allowed) {
      headers["Access-Control-Allow-Origin"] = origin;
      if (this.config.allow_credentials) {
        headers["Access-Control-Allow-Credentials"] = "true";
      }
      if (this.config.exposed_headers && this.config.exposed_headers.length > 0) {
        headers["Access-Control-Expose-Headers"] = this.config.exposed_headers.join(", ");
      }
    }
    if (this.config.vary) {
      headers["Vary"] = this.config.vary;
    }
    return headers;
  }

  /**
    * Get headers for preflight (OPTIONS) request.
    */
  getPreflightHeaders(origin: string | undefined | null, requestedMethod?: string, requestedHeaders?: string): Record<string, string> {
    const headers = this.getHeaders(origin);
    if (!origin || !this.isOriginAllowed(origin)) {
      return headers;
    }
    if (this.config.allowed_methods) {
      headers["Access-Control-Allow-Methods"] = this.config.allowed_methods.join(", ");
    }
    if (this.config.allowed_headers) {
      headers["Access-Control-Allow-Headers"] = this.config.allowed_headers.join(", ");
    }
    if (this.config.max_age_seconds) {
      headers["Access-Control-Max-Age"] = String(this.config.max_age_seconds);
    }
    return headers;
  }

  /**
    * Check if origin is allowed.
    */
  isOriginAllowed(origin: string): boolean {
    if (this.config.allowed_origins.includes("*")) {
      return true;
    }
    if (this.config.allowed_origins.includes(origin)) {
      return true;
    }
    for (const pattern of this.originPatterns) {
      if (pattern.test(origin)) {
        return true;
      }
    }
    return false;
  }
}

// ============================================================================
// Production-safe factory
// ============================================================================

export function createCorsHandler(opts?: {
  allowedOrigins?: string[];
  allowedOriginPatterns?: string[];
  allowCredentials?: boolean;
}): CorsHandler {
  return new CorsHandler({
    allowed_origins: opts?.allowedOrigins || [],
    allowed_origin_patterns: opts?.allowedOriginPatterns,
    allow_credentials: opts?.allowCredentials ?? true,
    allowed_methods: DEFAULT_CORS_CONFIG.allowed_methods,
    allowed_headers: DEFAULT_CORS_CONFIG.allowed_headers,
    exposed_headers: DEFAULT_CORS_CONFIG.exposed_headers,
    max_age_seconds: DEFAULT_CORS_CONFIG.max_age_seconds,
    vary: DEFAULT_CORS_CONFIG.vary,
  });
}
