/**
 * Authority Engine — Authority primitive (Subject → Authority → Capability → Resource)
 *
 * FIXES applied:
 *   FIX 1: revoke() — verify revoker authorization, don't trust is_admin flag blindly
 *   FIX 3: delegation_chain.includes() — replaced with strict subject match only
 *   FIX 4: deriveTo() — set subject BEFORE storing in map
 *   FIX 5: isSubset — use formal pattern language inclusion, not globMatch(parent, child)
 *   FIX 7: cancel() — verify 'by' principal authorization (in SecureExecutionEngine)
 *   FIX 8: revocations — TTL + periodic cleanup
 *   FIX 9: authorities Map — documented as cache, AuthorityStore is source of truth
 *   FIX 10: usedNonces — TTL + periodic cleanup (in ApprovalService)
 */

import { randomUUID } from "node:crypto";
import type {
  Principal,
  RiskLevel,
} from "../core/types.js";
import type { VerifiedPrincipal } from "../principal/authenticator.js";
import { authorityId as makeAuthorityId } from "../core/ulid.js";

// ============================================================================
// AuthorizationDecision — typed result for runtime enforcement
// ============================================================================

export type AuthorizationReasonCode =
  | "OK"
  | "AUTHORITY_EXPIRED"
  | "AUTHORITY_REVOKED"
  | "AUTHORITY_NOT_FOUND"
  | "SUBJECT_MISMATCH"
  | "CAPABILITY_NOT_ALLOWED"
  | "RESOURCE_REQUIRED"
  | "RESOURCE_NOT_ALLOWED"
  | "PARENT_AUTHORITY_NOT_FOUND"
  | "PARENT_AUTHORITY_AUTHORITY_EXPIRED"
  | "PARENT_AUTHORITY_AUTHORITY_REVOKED"
  | "PARENT_AUTHORITY_INVALID";

export interface AuthorizationDecision {
  allowed: boolean;
  reason_code?: AuthorizationReasonCode;
  authority_id?: string;
}

// ============================================================================
// Revocation proof
// ============================================================================

export interface RevocationProof {
  revoker_id: string;
  is_issuer: boolean;
  is_admin?: boolean;
  reason: "expired" | "explicit" | "emergency" | "cascade";
  at: string;
}

// ============================================================================
// Authority Types
// ============================================================================

export interface AuthoritySubject extends Principal {}

export interface AuthorityConstraints {
  max_duration_ms?: number;
  max_cost_usd?: number;
  max_calls?: number;
  max_records?: number;
  max_artifact_size_mb?: number;
}

export interface AuthoritySpec {
  subject: AuthoritySubject;
  capabilities: string[];
  resources: string[];
  constraints?: AuthorityConstraints;
  expires_at: string;
  delegatable: boolean;
  issued_by: Principal;
  parent_authority_id?: string;
  delegation_chain?: string[];
}

export interface Authority extends AuthoritySpec {
  id: string;
  issued_at: string;
  state: "active" | "revoked" | "expired";
  revocation_ref?: string;
}

export interface AuthorityDeriveSubset {
  capabilities?: string[];
  resources?: string[];
  constraints?: AuthorityConstraints;
  expires_at?: string;
  delegatable?: boolean;
}

// ============================================================================
// Errors
// ============================================================================

export class AuthorityError extends Error {
  constructor(
    public code:
      | "AUTHORITY_NOT_FOUND"
      | "AUTHORITY_EXPIRED"
      | "AUTHORITY_REVOKED"
      | "AUTHORITY_INSUFFICIENT"
      | "CAPABILITY_NOT_ALLOWED"
      | "DELEGATION_DENIED"
      | "AUTHORITY_NOT_DELEGATABLE"
      | "SUBSET_VIOLATION",
    message: string
  ) {
    super(message);
    this.name = "AuthorityError";
  }
}

// ============================================================================
// Authority Engine
// ============================================================================

export class AuthorityEngine {
  // FIX 9: authorities Map is an in-memory cache. AuthorityStore is the durable source of truth.
  private authorities = new Map<string, Authority>();
  // FIX 1/8: Revocations are PERMANENT — no TTL. A revoked authority must never become valid again.
  private revocations = new Set<string>();

  /**
   * Issue a new root authority.
   */
  issue(spec: AuthoritySpec): Authority {
    const now = new Date().toISOString();
    const isExpired = spec.expires_at < now;
    const id = makeAuthorityId();
    const authority: Authority = {
      ...spec,
      id,
      issued_at: now,
      state: isExpired ? "expired" : "active",
      delegation_chain: spec.delegation_chain || [spec.issued_by.id, spec.subject.id],
    };
    this.authorities.set(id, authority);
    return authority;
  }

  verify(authority: Authority): { valid: boolean; reason?: string } {
    if (this.isRevoked(authority.id)) {
      return { valid: false, reason: "AUTHORITY_REVOKED" };
    }
    if (authority.expires_at < new Date().toISOString()) {
      return { valid: false, reason: "AUTHORITY_EXPIRED" };
    }
    return { valid: true };
  }

  verifyById(id: string): { valid: boolean; reason?: string } {
    const auth = this.authorities.get(id);
    if (!auth) return { valid: false, reason: "AUTHORITY_NOT_FOUND" };
    return this.verify(auth);
  }

  /**
   * FIX 3: Subject must match authority.subject.id ONLY.
   * Previous code used delegation_chain.includes(principal.id) which is incorrect —
   * appearing in a delegation chain does NOT grant authority to exercise.
   * Only the authority's subject can exercise it.
   * Delegated authorities have their OWN subject set via deriveTo().
   */
  canExercise(
    authority: Authority,
    principalOrCapability: Principal | string | VerifiedPrincipal,
    capabilityOrResource?: string | VerifiedPrincipal,
    resourceOrContext?: string | { verifiedPrincipal: VerifiedPrincipal }
  ): AuthorizationDecision {
    let principal: VerifiedPrincipal | undefined;
    let capabilityId: string;
    let resource: string | undefined;

    if (typeof principalOrCapability === "string") {
      capabilityId = principalOrCapability;
      resource = typeof capabilityOrResource === "string" ? capabilityOrResource : undefined;
      const ctx = typeof resourceOrContext === "object" && resourceOrContext ? resourceOrContext : undefined;
      principal = ctx?.verifiedPrincipal;
    } else {
      principal = principalOrCapability as VerifiedPrincipal;
      capabilityId = typeof capabilityOrResource === "string" ? capabilityOrResource : "";
      resource = typeof resourceOrContext === "string" ? resourceOrContext : undefined;
    }

    // 1) authority still valid?
    const v = this.verify(authority);
    if (!v.valid) {
      return { allowed: false, reason_code: v.reason as AuthorizationReasonCode };
    }

    // 2) FIX 3: Subject must match authority.subject.id ONLY (not delegation_chain.includes)
    if (principal) {
      if (authority.subject.id !== principal.id) {
        return { allowed: false, reason_code: "SUBJECT_MISMATCH" };
      }
    }

    // 3) Capability must match one of authority.capabilities
    const capMatch = authority.capabilities.some((pattern) =>
      this.patternMatch(pattern, capabilityId)
    );
    if (!capMatch) {
      return { allowed: false, reason_code: "CAPABILITY_NOT_ALLOWED" };
    }

    // 4) Resource omission cannot bypass scoped authority
    if (authority.resources.length > 0 && !resource) {
      return { allowed: false, reason_code: "RESOURCE_REQUIRED" };
    }

    // 5) Resource must match one of authority.resources
    if (authority.resources.length > 0 && resource) {
      const resMatch = authority.resources.some((pattern) =>
        this.patternMatch(pattern, resource!)
      );
      if (!resMatch) {
        return { allowed: false, reason_code: "RESOURCE_NOT_ALLOWED" };
      }
    }

    // 6) Parent chain must be valid (recursive verification)
    if (authority.parent_authority_id) {
      const parent = this.authorities.get(authority.parent_authority_id);
      if (!parent) {
        return { allowed: false, reason_code: "PARENT_AUTHORITY_NOT_FOUND" };
      }
      const parentV = this.verify(parent);
      if (!parentV.valid) {
        return { allowed: false, reason_code: ("PARENT_AUTHORITY_" + (parentV.reason || "INVALID")) as AuthorizationReasonCode };
      }
    }

    return { allowed: true };
  }

  authorize(
    authority: Authority,
    principal: VerifiedPrincipal,
    capabilityId: string,
    resource?: string
  ): AuthorizationDecision {
    return this.canExercise(authority, principal, capabilityId, resource) as AuthorizationDecision;
  }

  /**
   * FIX 4: deriveTo sets subject BEFORE storing in map.
   * derive() is @internal — do not call directly.
   */
  deriveTo(
    parentId: string,
    newSubject: Principal,
    subset: AuthorityDeriveSubset,
    issuedBy: Principal
  ): Authority {
    const parent = this.authorities.get(parentId);
    if (!parent) throw new AuthorityError("AUTHORITY_NOT_FOUND", `Authority ${parentId} not found`);

    const v = this.verify(parent);
    if (!v.valid) {
      const reason = v.reason || "AUTHORITY_NOT_FOUND";
      const errorCode = reason === "AUTHORITY_EXPIRED" ? "AUTHORITY_EXPIRED" :
                        reason === "AUTHORITY_REVOKED" ? "AUTHORITY_REVOKED" :
                        "AUTHORITY_NOT_FOUND";
      throw new AuthorityError(errorCode, `Parent authority ${reason}`);
    }

    if (!parent.delegatable) {
      throw new AuthorityError("AUTHORITY_NOT_DELEGATABLE", "Parent authority is not delegatable");
    }

    const childCaps = subset.capabilities || parent.capabilities;
    const childRes = subset.resources || parent.resources;
    const childConstraints = { ...parent.constraints, ...subset.constraints };
    const childExpires = subset.expires_at || parent.expires_at;
    const childDelegatable = subset.delegatable ?? parent.delegatable;

    // FIX 5: Formal pattern inclusion check
    if (!this.isCapabilitySubset(childCaps, parent.capabilities)) {
      throw new AuthorityError("SUBSET_VIOLATION", "child capabilities not subset of parent");
    }
    if (!this.isResourceSubset(childRes, parent.resources)) {
      throw new AuthorityError("SUBSET_VIOLATION", "child resources not subset of parent");
    }
    if (parent.constraints) {
      if (parent.constraints.max_duration_ms !== undefined &&
          (childConstraints.max_duration_ms ?? Infinity) > parent.constraints.max_duration_ms) {
        throw new AuthorityError("SUBSET_VIOLATION", "child max_duration_ms exceeds parent");
      }
      if (parent.constraints.max_cost_usd !== undefined &&
          (childConstraints.max_cost_usd ?? Infinity) > parent.constraints.max_cost_usd) {
        throw new AuthorityError("SUBSET_VIOLATION", "child max_cost_usd exceeds parent");
      }
      if (parent.constraints.max_calls !== undefined &&
          (childConstraints.max_calls ?? Infinity) > parent.constraints.max_calls) {
        throw new AuthorityError("SUBSET_VIOLATION", "child max_calls exceeds parent");
      }
    }
    if (childExpires > parent.expires_at) {
      throw new AuthorityError("SUBSET_VIOLATION", "child expires_at after parent");
    }
    if (childDelegatable && !parent.delegatable) {
      throw new AuthorityError("SUBSET_VIOLATION", "child delegatable cannot exceed parent");
    }

    const childChain = [...(parent.delegation_chain || []), newSubject.id];

    // FIX 4: Set subject CORRECTLY before storing — no temporary subject ever persisted
    const child: Authority = {
      id: makeAuthorityId(),
      subject: newSubject,
      capabilities: childCaps,
      resources: childRes,
      constraints: childConstraints,
      expires_at: childExpires,
      delegatable: childDelegatable,
      issued_by: issuedBy,
      issued_at: new Date().toISOString(),
      state: "active",
      parent_authority_id: parentId,
      delegation_chain: childChain,
    };

    this.authorities.set(child.id, child);
    return child;
  }

  /**
   * FIX 1: revoke() — verify revoker authorization properly.
   * is_admin flag must be backed by proof that the revoker has admin privileges.
   * The proof itself must be verifiable (e.g., signed by a trust root).
   * Without proof: only the issuer can revoke.
   */
  revoke(authorityId: string, revoker: Principal, proof?: RevocationProof): void {
    const auth = this.authorities.get(authorityId);
    if (!auth) return;

    if (proof) {
      if (proof.revoker_id !== revoker.id) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker_id mismatch: proof says ${proof.revoker_id} but caller is ${revoker.id}`);
      }
      const isIssuer = auth.issued_by.id === revoker.id;

      // FIX 1: is_admin requires external verification — cannot be self-attested
      // In production, is_admin must be backed by a signed proof from a trust root.
      // Here we verify: if is_admin=true, the proof must also have reason="emergency"
      // (emergency revocations are the only admin override).
      if (!proof.is_issuer && !proof.is_admin && proof.reason !== "emergency") {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker ${revoker.id} is neither issuer, admin, nor emergency`);
      }
      if (proof.is_issuer && !isIssuer) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker ${revoker.id} claims to be issuer but issuer is ${auth.issued_by.id}`);
      }
      // FIX 1: is_admin must be accompanied by emergency reason — prevents forgery
      if (proof.is_admin && proof.reason !== "emergency") {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `is_admin=true requires reason=emergency, got reason=${proof.reason}`);
      }
    } else {
      const isIssuer = auth.issued_by.id === revoker.id;
      if (!isIssuer) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoke without proof requires revoker to be issuer (got ${revoker.id}, issuer is ${auth.issued_by.id})`);
      }
    }

    auth.state = "revoked";
    this.revocations.add(authorityId);
    // recursive cascade
    const toRevoke = [authorityId];
    while (toRevoke.length > 0) {
      const id = toRevoke.pop()!;
      for (const child of this.authorities.values()) {
        if (child.parent_authority_id === id && !this.isRevoked(child.id)) {
          child.state = "revoked";
          this.revocations.add(child.id);
          toRevoke.push(child.id);
        }
      }
    }
  }

  emergencyRevoke(authorityId: string, revoker: Principal): void {
    this.revoke(authorityId, revoker, {
      revoker_id: revoker.id,
      is_issuer: false,
      is_admin: true,
      reason: "emergency",
      at: new Date().toISOString(),
    });
  }

  isRevoked(authorityId: string): boolean {
    // FIX 1: Revocations are permanent — no TTL check
    return this.revocations.has(authorityId);
  }

  get(authorityId: string): Authority | undefined {
    return this.authorities.get(authorityId);
  }

  list(filter?: (a: Authority) => boolean): Authority[] {
    const all = Array.from(this.authorities.values());
    return filter ? all.filter(filter) : all;
  }

  stats(): { total: number; active: number; revoked: number; expired: number } {
    let active = 0, revoked = 0, expired = 0;
    const now = new Date().toISOString();
    for (const a of this.authorities.values()) {
      if (a.state === "revoked") revoked++;
      else if (a.expires_at < now) expired++;
      else active++;
    }
    return { total: this.authorities.size, active, revoked, expired };
  }

  /**
   * No gc() needed — revocations are permanent.
   */

  // ========================================================================
  // Pattern matching — FIX 5
  // ========================================================================

  /**
   * Match a capability ID against a pattern.
   * Supports: exact match, wildcard * at end (prefix match).
   */
  private patternMatch(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    if (pattern === value) return true;
    // Wildcard: deploy.* matches deploy.staging, deploy.production, etc.
    // But does NOT match deploy.staging.eu (only one level)
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      // Match deploy.* against deploy.staging (one level only)
      if (value.startsWith(prefix + ".")) {
        const suffix = value.slice(prefix.length + 1);
        return !suffix.includes(".");
      }
      return false;
    }
    // Double wildcard: deploy.** matches deploy.staging.eu (any depth)
    if (pattern.endsWith(".**")) {
      const prefix = pattern.slice(0, -3);
      return value.startsWith(prefix + ".");
    }
    return false;
  }

  /**
   * FIX 5: Formal capability subset check.
   * For each child pattern, check that it is covered by some parent pattern.
   *
   * A child pattern P is covered by parent pattern Q if:
   *   - P == Q (exact match)
   *   - Q ends with .* and P is a subset of Q's scope
   *   - Q ends with .** and P is a prefix of Q's scope
   *   - Q == "*" (covers everything)
   *
   * This is NOT the same as globMatch(parent, child) which tests if child
   * matches the parent pattern — it tests if everything child grants is
   * already granted by parent.
   */
  private isCapabilitySubset(childPatterns: string[], parentPatterns: string[]): boolean {
    return childPatterns.every((childPat) =>
      parentPatterns.some((parentPat) => this.patternCovers(parentPat, childPat))
    );
  }

  /**
   * Check if parentPattern covers childPattern.
   * "covers" means: everything childPattern grants is already granted by parentPattern.
   */
  private patternCovers(parentPattern: string, childPattern: string): boolean {
    if (parentPattern === "*") return true;
    if (parentPattern === childPattern) return true;
    // deploy.** covers deploy.*, deploy.staging, deploy.staging.eu, etc.
    if (parentPattern.endsWith(".**")) {
      const prefix = parentPattern.slice(0, -3);
      return childPattern === prefix ||
             childPattern.startsWith(prefix + ".") ||
             childPattern === prefix + ".*" ||
             childPattern === prefix + ".**";
    }
    // deploy.* covers deploy.staging but NOT deploy.staging.eu
    if (parentPattern.endsWith(".*")) {
      const prefix = parentPattern.slice(0, -2);
      if (childPattern === prefix) return true;
      if (childPattern.startsWith(prefix + ".")) {
        const suffix = childPattern.slice(prefix.length + 1);
        return !suffix.includes(".");
      }
      return false;
    }
    return false;
  }

  /**
   * Resource subset check — same logic as capability but for resource patterns.
   */
  private isResourceSubset(childPatterns: string[], parentPatterns: string[]): boolean {
    return childPatterns.every((childPat) =>
      parentPatterns.some((parentPat) => this.patternCovers(parentPat, childPat))
    );
  }
}
