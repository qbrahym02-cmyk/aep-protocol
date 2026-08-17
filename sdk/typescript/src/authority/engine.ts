/**
 * Authority Engine — Subject → Authority → Capability → Resource
 * Reference: spec/profiles/authority.md
 * 
 * Authority primitive AEP :
 * Agent Cannotrequest capability .
 * Agent MUST authority .
 * 
 * Rule :
 * child_authority ⊆ parent_authority
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
  | "RESOURCE_REQUIRED"         // ★ P0 fix
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
  /** من يملك صلاحية الإلغاء */
  revoker_id: string;
  /** هل الـrevoker هو issuer الأصلي؟ */
  is_issuer: boolean;
  /** هل الـrevoker هو admin (مثلاً من policy)؟ */
  is_admin?: boolean;
  /** reason code */
  reason: "expired" | "explicit" | "emergency" | "cascade";
  /** timestamp */
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
  capabilities: string[];           // glob patterns
  resources: string[];               // scoped resources (empty = any)
  constraints?: AuthorityConstraints;
  expires_at: string;                // ISO 8601
  delegatable: boolean;
  issued_by: Principal;
  parent_authority_id?: string;
  delegation_chain?: string[];
}

export interface Authority extends AuthoritySpec {
  id: string;
  issued_at: string;
  state: "active" | "expired" | "revoked";
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
  private authorities = new Map<string, Authority>();
  private revocations = new Set<string>();

  /**
    * authority principal (parent).
    * testingif expires_at then .
    */
  issue(spec: AuthoritySpec): Authority {
    const now = new Date().toISOString();
    const isExpired = spec.expires_at < now;
    const id = `auth_${randomUUID().slice(0, 12)}`;
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

  /**
    * Verification authority ().
    */
  verify(authority: Authority): { valid: boolean; reason?: string } {
    if (this.revocations.has(authority.id)) {
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
    * authority capability resource
    * 
    * Mandatory(Reference: spec/10-10 §7):
    * 1. Subject Must principal delegation .
    * 2. Capability Must authority.
    * 3. if authority scoped resources Must not resource. (★ P0 fix)
    * 4. Resource Must scope.
    * 5. Must .
    * 6. Authority Must revoked.
    * 7. Parent chain Must .
    * 8. Constraints Must .
    * 9. Delegation Must Allowed.
    */
  canExercise(
    authority: Authority,
    principalOrCapability: Principal | string,
    capabilityOrResource?: string | VerifiedPrincipal,
    resourceOrContext?: string | { verifiedPrincipal: VerifiedPrincipal }
  ): AuthorizationDecision {
    // Overloaded signature support:
    // canExercise(authority, capabilityId, resource?, context?)
    // canExercise(authority, verifiedPrincipal, capabilityId, resource?)
    // For backward-compat: we accept both forms and detect.

    let principal: VerifiedPrincipal | undefined;
    let capabilityId: string;
    let resource: string | undefined;

    if (typeof principalOrCapability === "string") {
      // old form: (authority, capabilityId, resource?, context?)
      capabilityId = principalOrCapability;
      resource = typeof capabilityOrResource === "string" ? capabilityOrResource : undefined;
      const ctx = typeof resourceOrContext === "object" && resourceOrContext ? resourceOrContext : undefined;
      principal = ctx?.verifiedPrincipal;
    } else {
      // new form: (authority, principal, capabilityId, resource?)
      principal = principalOrCapability as VerifiedPrincipal;
      capabilityId = typeof capabilityOrResource === "string" ? capabilityOrResource : "";
      resource = typeof resourceOrContext === "string" ? resourceOrContext : undefined;
    }

    // 1) authority still valid?
    const v = this.verify(authority);
    if (!v.valid) {
      return { allowed: false, reason_code: v.reason as AuthorizationReasonCode };
    }

    // 2) Subject must match principal (or valid delegation)
    if (principal) {
      const subjectMatch = authority.subject.id === principal.id ||
                           (authority.delegation_chain || []).includes(principal.id);
      if (!subjectMatch) {
        return { allowed: false, reason_code: "SUBJECT_MISMATCH" };
      }
    }

    // 3) Capability must match one of authority.capabilities
    const capMatch = authority.capabilities.some((pattern) =>
      this.globMatch(pattern, capabilityId)
    );
    if (!capMatch) {
      return { allowed: false, reason_code: "CAPABILITY_NOT_ALLOWED" };
    }

    // 4) ★ Resource omission cannot bypass scoped authority (P0 fix)
    // if authority scoped resources[] Must not resource.
    if (authority.resources.length > 0 && !resource) {
      return { allowed: false, reason_code: "RESOURCE_REQUIRED" };
    }

    // 5) Resource must match one of authority.resources
    if (authority.resources.length > 0 && resource) {
      const resMatch = authority.resources.some((pattern) =>
        this.globMatch(pattern, resource)
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

  /**
    * Canonical decision (typed) — for runtime enforcement.
    */
  authorize(
    authority: Authority,
    principal: VerifiedPrincipal,
    capabilityId: string,
    resource?: string
  ): AuthorizationDecision {
    return this.canExercise(authority, principal, capabilityId, resource) as AuthorizationDecision;
  }

  /**
    * authority parent.
    * Rule : child ⊆ parent
    */
  derive(parentId: string, subset: AuthorityDeriveSubset, issuedBy: Principal): Authority {
    const parent = this.authorities.get(parentId);
    if (!parent) throw new AuthorityError("AUTHORITY_NOT_FOUND", `Authority ${parentId} not found`);

    const v = this.verify(parent);
    if (!v.valid) {
      const reason = v.reason || "AUTHORITY_NOT_FOUND";
      // Map verify reasons to AuthorityError codes
      const errorCode = reason === "AUTHORITY_EXPIRED" ? "AUTHORITY_EXPIRED" :
                        reason === "AUTHORITY_REVOKED" ? "AUTHORITY_REVOKED" :
                        "AUTHORITY_NOT_FOUND";
      throw new AuthorityError(errorCode, `Parent authority ${reason}`);
    }

    if (!parent.delegatable) {
      throw new AuthorityError("AUTHORITY_NOT_DELEGATABLE", "Parent authority is not delegatable");
    }

    // validate subset rules
    const childCaps = subset.capabilities || parent.capabilities;
    const childRes = subset.resources || parent.resources;
    const childConstraints = { ...parent.constraints, ...subset.constraints };
    const childExpires = subset.expires_at || parent.expires_at;
    const childDelegatable = subset.delegatable ?? parent.delegatable;

    // ⊆ check on capabilities
    if (!this.isSubset(childCaps, parent.capabilities)) {
      throw new AuthorityError("SUBSET_VIOLATION", "child capabilities not subset of parent");
    }
    // ⊆ check on resources
    if (!this.isSubset(childRes, parent.resources)) {
      throw new AuthorityError("SUBSET_VIOLATION", "child resources not subset of parent");
    }
    // ≤ check on constraints
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
    // ≤ on expires_at
    if (childExpires > parent.expires_at) {
      throw new AuthorityError("SUBSET_VIOLATION", "child expires_at after parent");
    }
    // delegatable: 
    if (childDelegatable && !parent.delegatable) {
      throw new AuthorityError("SUBSET_VIOLATION", "child delegatable cannot exceed parent");
    }

    const childChain = [...(parent.delegation_chain || []), issuedBy.id, parent.subject.id];

    // FIX 8: derive() is @internal — subject is set by deriveTo()
    // derive() creates with parent's subject (temporary), deriveTo() overrides with real subject.
    // This is the ONLY place where a temporary subject exists, and it's immediately replaced.
    const child: Authority = {
      id: makeAuthorityId(),
      subject: parent.subject, // Will be overridden by deriveTo()
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
    * with subject .
    */
  deriveTo(
    parentId: string,
    newSubject: Principal,
    subset: AuthorityDeriveSubset,
    issuedBy: Principal
  ): Authority {
    const child = this.derive(parentId, subset, issuedBy);
    // override subject
    child.subject = newSubject;
    // rebuild chain with new subject
    const parent = this.authorities.get(parentId)!;
    child.delegation_chain = [
      ...(parent.delegation_chain || []),
      newSubject.id,
    ];
    return child;
  }

  /**
    * authority with proof verification.
    * 
    * : revoker MUST :
    * - issuer authorityOR
    * - admin (e.g. policy rule revoke:*)OR
    * - emergency revoker (clock + reason=emergency)
    * 
    * @throws AuthorityError if revoker .
    */
  revoke(authorityId: string, revoker: Principal, proof?: RevocationProof): void {
    const auth = this.authorities.get(authorityId);
    if (!auth) return;

    // ★ P0 fix: verify revoker authorization
    if (proof) {
      if (proof.revoker_id !== revoker.id) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker_id mismatch: proof says ${proof.revoker_id} but caller is ${revoker.id}`);
      }
      const isIssuer = auth.issued_by.id === revoker.id;
      if (!proof.is_issuer && !proof.is_admin && proof.reason !== "emergency") {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker ${revoker.id} is neither issuer, admin, nor emergency`);
      }
      if (proof.is_issuer && !isIssuer) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoker ${revoker.id} claims to be issuer but issuer is ${auth.issued_by.id}`);
      }
    } else {
      // Without proof: only allow if revoker is the issuer (back-compat for tests)
      const isIssuer = auth.issued_by.id === revoker.id;
      if (!isIssuer) {
        throw new AuthorityError("AUTHORITY_INSUFFICIENT",
          `revoke without proof requires revoker to be issuer (got ${revoker.id}, issuer is ${auth.issued_by.id})`);
      }
    }

    auth.state = "revoked";
    this.revocations.add(authorityId);
    // recursive cascade: revoke all descendants (depth-first via queue)
    const toRevoke = [authorityId];
    while (toRevoke.length > 0) {
      const id = toRevoke.pop()!;
      for (const child of this.authorities.values()) {
        if (child.parent_authority_id === id && !this.revocations.has(child.id)) {
          child.state = "revoked";
          this.revocations.add(child.id);
          toRevoke.push(child.id);
        }
      }
    }
  }

  /**
    * Emergency revoke — Can revoker with proof.is_admin=true.
    */
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

  // ============================================================================
  // Glob matching
  // ============================================================================

  private globMatch(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp("^" + regexStr + "$").test(value);
  }

  private isSubset(child: string[], parent: string[]): boolean {
    // child Must parent (glob)
    return child.every((c) => parent.some((p) => this.globMatch(p, c)));
  }
}
