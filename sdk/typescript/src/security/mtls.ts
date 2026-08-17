/**
 * mTLS Profile — Mutual TLS authentication
 * Reference: spec/profiles/security.md §AuthenticationP1-01
 * 
 * Production-grade mTLS for service-to-service authentication.
 * NO `as any` in this file.
  */

import type { TLSSocket, PeerCertificate } from "node:tls";
import type { VerifiedPrincipal, Authenticator, AuthenticationMethod, AssuranceLevel } from "../principal/authenticator.js";
import { AuthenticationError } from "../principal/authenticator.js";

// ============================================================================
// mTLS Configuration
// ============================================================================

export interface MtlsConfig {
  allowed_subject_patterns: string[];
  required_issuer_dns: string[];
  pinned_client_ca_fingerprints?: string[];
  check_revocation?: boolean;
  subject_to_tenant?: (subject_dn: string) => string | undefined;
  subject_to_assurance?: (subject_dn: string) => AssuranceLevel;
  default_assurance_level?: AssuranceLevel;
}

// ============================================================================
// mTLS Authenticator
// ============================================================================

export class MtlsAuthenticator implements Authenticator {
  private config: MtlsConfig;

  constructor(config: MtlsConfig) {
    this.config = config;
  }

  /**
    * Authenticate via TLS socket.
    */
  async authenticateFromSocket(socket: TLSSocket): Promise<VerifiedPrincipal> {
    const cert = socket.getPeerCertificate();
    if (!cert || Object.keys(cert).length === 0) {
      throw new AuthenticationError("UNAUTHENTICATED", "No client certificate provided");
    }

    // Verify issuer — PeerCertificate.issuer is a string in Node.js
    const issuer: string = typeof cert.issuer === "string"
      ? cert.issuer
      : String(cert.issuer || "");
    if (this.config.required_issuer_dns.length > 0) {
      const issuerMatch = this.config.required_issuer_dns.some((pat) =>
        this.globMatch(pat, issuer)
      );
      if (!issuerMatch) {
        throw new AuthenticationError("INVALID_CREDENTIALS", `Issuer not allowed: ${issuer}`);
      }
    }

    // Verify subject — PeerCertificate.subject is a string in Node.js
    const subject: string = typeof cert.subject === "string"
      ? cert.subject
      : String(cert.subject || "");
    if (this.config.allowed_subject_patterns.length > 0) {
      const subjectMatch = this.config.allowed_subject_patterns.some((pat) =>
        this.globMatch(pat, subject)
      );
      if (!subjectMatch) {
        throw new AuthenticationError("UNAUTHORIZED", `Subject not allowed: ${subject}`);
      }
    }

    // Verify validity
    const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;  // PeerCertificate uses valid_from
    const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
    const now = new Date();
    if (validFrom && now < validFrom) {
      throw new AuthenticationError("INVALID_CREDENTIALS", "Certificate not yet valid");
    }
    if (validTo && now > validTo) {
      throw new AuthenticationError("EXPIRED_TOKEN", "Certificate expired");
    }

    // Build VerifiedPrincipal
    const subjectId = this.extractIdFromDn(subject);
    const tenant_id = this.config.subject_to_tenant?.(subject);
    const assurance_level =
      this.config.subject_to_assurance?.(subject) ||
      this.config.default_assurance_level ||
      "high";

    return {
      id: subjectId,
      type: "service",
      issuer: `mtls:${issuer}`,
      authenticated_at: new Date().toISOString(),
      authentication_method: "mtls" as AuthenticationMethod,
      claims: {
        subject_dn: subject,
        issuer_dn: issuer,
        cert_fingerprint: cert.fingerprint256 || cert.fingerprint || "",
        serial_number: cert.serialNumber,
        valid_from: cert.valid_from,
        valid_to: cert.valid_to,
      },
      assurance_level,
      tenant_id,
    };
  }

  /**
    * Authenticator interface — accepts mtls credentials.
    */
  async authenticate(credentials: {
    type: "mtls";
    subject_dn: string;
    cert_fingerprint: string;
    issuer_dn?: string;
    valid_to?: string;
  }): Promise<VerifiedPrincipal> {
    if (credentials.type !== "mtls") {
      throw new AuthenticationError("INVALID_CREDENTIALS", "MtlsAuthenticator only accepts mtls credentials");
    }

    if (this.config.allowed_subject_patterns.length > 0) {
      const match = this.config.allowed_subject_patterns.some((pat) =>
        this.globMatch(pat, credentials.subject_dn)
      );
      if (!match) {
        throw new AuthenticationError("UNAUTHORIZED", `Subject not allowed: ${credentials.subject_dn}`);
      }
    }

    if (credentials.issuer_dn && this.config.required_issuer_dns.length > 0) {
      const issuerDn = credentials.issuer_dn;
      const issuerMatch = this.config.required_issuer_dns.some((pat) =>
        this.globMatch(pat, issuerDn)
      );
      if (!issuerMatch) {
        throw new AuthenticationError("INVALID_CREDENTIALS", `Issuer not allowed: ${credentials.issuer_dn}`);
      }
    }

    if (credentials.valid_to) {
      const expiry = new Date(credentials.valid_to);
      if (expiry < new Date()) {
        throw new AuthenticationError("EXPIRED_TOKEN", "Certificate expired");
      }
    }

    const subjectId = this.extractIdFromDn(credentials.subject_dn);
    const tenant_id = this.config.subject_to_tenant?.(credentials.subject_dn);
    const assurance_level =
      this.config.subject_to_assurance?.(credentials.subject_dn) ||
      this.config.default_assurance_level ||
      "high";

    return {
      id: subjectId,
      type: "service",
      issuer: `mtls:${credentials.issuer_dn || "unknown"}`,
      authenticated_at: new Date().toISOString(),
      authentication_method: "mtls" as AuthenticationMethod,
      claims: {
        subject_dn: credentials.subject_dn,
        cert_fingerprint: credentials.cert_fingerprint,
      },
      assurance_level,
      tenant_id,
    };
  }

  private extractIdFromDn(dn: string): string {
    const m = dn.match(/CN=([^,]+)/);
    return m ? m[1] : dn;
  }

  private globMatch(pattern: string, value: string): boolean {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp("^" + regexStr + "$").test(value);
  }
}
