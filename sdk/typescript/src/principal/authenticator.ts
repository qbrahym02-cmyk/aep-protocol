/**
 * VerifiedPrincipal + Authenticator
 * Reference: spec/10-10 §5 Principal Model§42 Confused Deputy
 * 
 * Problem : principal { type: "system", id: "anonymous" }
 * request "" — 0.3.
 * 
 * Solution:
 * - request Sends credentials 
 * - Authenticator VerifiedPrincipal
 * - VerifiedPrincipal
  */

import { createHash, randomUUID } from "node:crypto";
import type { Principal, PrincipalType } from "../core/types.js";

// ============================================================================
// VerifiedPrincipal
// ============================================================================

export interface VerifiedPrincipal {
  id: string;
  type: PrincipalType;
  issuer: string;                          // e.g. "oidc:https://idp.acme.com"
  authenticated_at: string;                 // ISO 8601
  authentication_method: AuthenticationMethod;
  claims: Record<string, unknown>;
  assurance_level: AssuranceLevel;
  tenant_id?: string;
  delegation_chain?: string[];
}

export type AuthenticationMethod =
  | "oidc"
  | "oauth2"
  | "mtls"
  | "api_key"
  | "signed_request"
  | "workload_identity"
  | "test_token";

export type AssuranceLevel = "low" | "substantial" | "high";

// ============================================================================
// Credentials (client)
// ============================================================================

export type Credentials =
  | { type: "bearer_token"; token: string }
  | { type: "api_key"; key: string }
  | { type: "mtls"; subject_dn: string; cert_fingerprint: string }
  | { type: "signed_request"; key_id: string; signature: string; timestamp: string; nonce: string }
  | { type: "workload_identity"; spiffe_id: string }
  | { type: "test_token"; principal_id: string; principal_type?: PrincipalType; tenant_id?: string };

// ============================================================================
// Authenticator
// ============================================================================

export interface Authenticator {
  authenticate(credentials: Credentials): Promise<VerifiedPrincipal>;
}

// ============================================================================
// Errors
// ============================================================================

export type AuthenticationErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "EXPIRED_TOKEN"
  | "REVOKED_TOKEN"
  | "UNAUTHORIZED";

export class AuthenticationError extends Error {
  constructor(
    public code: AuthenticationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

// ============================================================================
// TestAuthenticator — for testing 
// ============================================================================

export class TestAuthenticator implements Authenticator {
  private knownTokens = new Map<string, { principal: VerifiedPrincipal }>();

  /**
    * test token . for testing .
    */
  register(token: string, principal: Partial<VerifiedPrincipal> & { id: string }): void {
    const full: VerifiedPrincipal = {
      id: principal.id,
      type: principal.type || "user",
      issuer: principal.issuer || "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token",
      claims: principal.claims || {},
      assurance_level: principal.assurance_level || "substantial",
      tenant_id: principal.tenant_id,
      delegation_chain: principal.delegation_chain,
    };
    this.knownTokens.set(token, { principal: full });
  }

  async authenticate(credentials: Credentials): Promise<VerifiedPrincipal> {
    // Accept bearer_token: look up the token directly
    if (credentials.type === "bearer_token") {
      const entry = this.knownTokens.get(credentials.token);
      if (!entry) {
        throw new AuthenticationError("INVALID_CREDENTIALS", "Unknown token");
      }
      return entry.principal;
    }
    if (credentials.type !== "test_token") {
      throw new AuthenticationError("INVALID_CREDENTIALS", "TestAuthenticator only accepts test_token or bearer_token");
    }
    const entry = this.knownTokens.get(credentials.principal_id);
    if (!entry) {
      // test modetoken VerifiedPrincipal 
      return {
        id: credentials.principal_id,
        type: credentials.principal_type || "agent",
        issuer: "test",
        authenticated_at: new Date().toISOString(),
        authentication_method: "test_token",
        claims: {},
        assurance_level: "substantial",
        tenant_id: credentials.tenant_id,
      };
    }
    return entry.principal;
  }
}

// ============================================================================
// BearerTokenAuthenticator — OIDC JWT 
// ============================================================================

export interface BearerTokenAuthenticatorOptions {
  /**
    * decode JWT (header.payload.signature) claims.
    * : OIDC with signature verification.
    */
  decode?: (token: string) => {
    sub: string;
    iss: string;
    exp?: number;
    iat?: number;
    claims?: Record<string, unknown>;
    tenant_id?: string;
  };
  /**
    * .
    */
  enforceExpiry?: boolean;
  /**
    * Allowed clock skew ().
    */
  clockSkewSeconds?: number;
}

export class BearerTokenAuthenticator implements Authenticator {
  private opts: BearerTokenAuthenticatorOptions;

  constructor(opts: BearerTokenAuthenticatorOptions = {}) {
    this.opts = {
      enforceExpiry: true,
      clockSkewSeconds: 30,
      ...opts,
    };
  }

  async authenticate(credentials: Credentials): Promise<VerifiedPrincipal> {
    if (credentials.type !== "bearer_token") {
      throw new AuthenticationError("INVALID_CREDENTIALS", "BearerTokenAuthenticator only accepts bearer_token");
    }

    if (!this.opts.decode) {
      // without decoder: — Must decoder 
      throw new AuthenticationError("INVALID_CREDENTIALS", "No JWT decoder configured");
    }

    let decoded;
    try {
      decoded = this.opts.decode(credentials.token);
    } catch (err) {
      throw new AuthenticationError("INVALID_CREDENTIALS", `JWT decode failed: ${(err as Error).message}`);
    }

    if (this.opts.enforceExpiry && decoded.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp + (this.opts.clockSkewSeconds || 0) < now) {
        throw new AuthenticationError("EXPIRED_TOKEN", "Token expired");
      }
    }

    return {
      id: decoded.sub,
      type: "user",
      issuer: decoded.iss,
      authenticated_at: new Date().toISOString(),
      authentication_method: "oauth2",
      claims: decoded.claims || {},
      assurance_level: "substantial",
      tenant_id: decoded.tenant_id,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Principal (claimed) "unverified" — Must authenticator.
  */
export function asUnverifiedPrincipal(p: Principal): { unverified: true; claimed: Principal } {
  return { unverified: true, claimed: p };
}

/**
 * principal Required
  */
export function hasSufficientAssurance(
  principal: VerifiedPrincipal,
  required: AssuranceLevel
): boolean {
  const order: AssuranceLevel[] = ["low", "substantial", "high"];
  return order.indexOf(principal.assurance_level) >= order.indexOf(required);
}

/**
 * hash principal audit (Exposes claims).
  */
export function principalFingerprint(p: VerifiedPrincipal): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: p.id, type: p.type, issuer: p.issuer }))
    .digest("hex")
    .slice(0, 16);
}

// Re-export UUID helper for backward compat
export { randomUUID };
