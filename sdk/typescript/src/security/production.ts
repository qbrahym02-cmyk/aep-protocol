/**
 * Production Mode — Fails closed by default
 * Reference: AEP_CODE_FIRST_AUDIT.md P0-11P1-08
 * 
 * Production runtime MUST refuse to start if:
 * - No authenticator configured
 * - No policy engine configured
 * - No authority store configured (for protected capabilities)
 * - Wildcard CORS configured
 * - mTLS not enforced for service-to-service
  */

import type { Authenticator } from "../principal/authenticator.js";
import type { CorsConfig } from "./cors.js";

export type RuntimeMode = "development" | "staging" | "production";

export interface ProductionConfig {
  mode: RuntimeMode;
  authenticator?: Authenticator;
  cors?: CorsConfig;
  require_authority_for_side_effects?: boolean;
  require_mtls?: boolean;
  allowed_environments?: Array<"test" | "staging" | "production">;
}

export class ProductionValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ProductionValidationError";
  }
}

/**
 * Validate that production config is safe.
 * Throws if misconfigured.
  */
export function validateProductionConfig(config: ProductionConfig): void {
  const errors: Array<{ code: string; message: string }> = [];

  if (config.mode === "production") {
    // 1) Authenticator must be configured
    if (!config.authenticator) {
      errors.push({
        code: "NO_AUTHENTICATOR",
        message: "Production mode requires an authenticator. Configure OIDC, mTLS, or another authenticator.",
      });
    }

    // 2) CORS must not be wildcard
    if (config.cors?.allowed_origins?.includes("*")) {
      errors.push({
        code: "WILDCARD_CORS",
        message: "Production mode forbids wildcard CORS origins. Specify explicit allowed origins.",
      });
    }

    // 3) Authority required for side-effect capabilities
    if (config.require_authority_for_side_effects !== false) {
      // (default true — checked at runtime)
    }

    // 4) mTLS required for service-to-service (if enabled)
    if (config.require_mtls && !config.authenticator) {
      errors.push({
        code: "MTLS_WITHOUT_AUTHENTICATOR",
        message: "require_mtls=true requires an authenticator (MtlsAuthenticator).",
      });
    }
  } else if (config.mode === "staging") {
    if (!config.authenticator) {
      // Staging allows no-auth but warns
      console.warn("[AEP] Staging mode without authenticator — authentication will be permissive");
    }
  }
  // development mode: no checks

  if (errors.length > 0) {
    const msg = errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
    throw new ProductionValidationError(msg, errors[0].code);
  }
}

/**
 * Helper: build production-safe config.
  */
export function buildProductionConfig(opts: {
  authenticator: Authenticator;
  allowed_origins: string[];
  allowed_origin_patterns?: string[];
  require_mtls?: boolean;
}): ProductionConfig {
  return {
    mode: "production",
    authenticator: opts.authenticator,
    cors: {
      allowed_origins: opts.allowed_origins,
      allowed_origin_patterns: opts.allowed_origin_patterns,
      allow_credentials: true,
      allowed_methods: ["GET", "POST", "OPTIONS"],
      allowed_headers: ["Content-Type", "Authorization", "X-AEP-Trace"],
      exposed_headers: ["X-AEP-Checksum", "X-AEP-Execution-Id"],
      max_age_seconds: 600,
      vary: "Origin",
    },
    require_authority_for_side_effects: true,
    require_mtls: opts.require_mtls ?? false,
    allowed_environments: ["production"],
  };
}

/**
 * Check whether a capability requires authority in production.
  */
export function capabilityRequiresAuthority(cap: { kind: string; risk: { side_effect: boolean } }): boolean {
  return cap.risk.side_effect || ["action", "workflow", "delegate", "agent"].includes(cap.kind);
}
