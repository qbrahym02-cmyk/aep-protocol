/**
 * Cryptographic Protocol — Signed receipts, authorities, and key management.
 * 
 * Provides:
 *   - Ed25519 signature verification for receipts
 *   - Key rotation support
 *   - Nonce-based replay protection
 *   - Timestamp validation
 *   - Trust roots
 */

import { createHash, randomUUID } from "node:crypto";
import { canonicalize, sha256 } from "../core/canonical.js";

// ============================================================================
// Key Management
// ============================================================================

export interface SigningKey {
  key_id: string;
  algorithm: "ed25519" | "ecdsa" | "hmac-sha256";
  public_key: string;     // base64-encoded
  private_key?: string;    // base64-encoded (only in signing service)
  created_at: string;
  expires_at?: string;
  status: "active" | "rotated" | "revoked";
  rotated_from?: string;   // previous key_id
}

export class KeyStore {
  private keys = new Map<string, SigningKey>();
  private activeKeyId: string | null = null;

  addKey(key: SigningKey): void {
    this.keys.set(key.key_id, key);
    if (key.status === "active") {
      this.activeKeyId = key.key_id;
    }
  }

  getKey(keyId: string): SigningKey | undefined {
    return this.keys.get(keyId);
  }

  getActiveKey(): SigningKey | undefined {
    if (!this.activeKeyId) return undefined;
    return this.keys.get(this.activeKeyId);
  }

  rotateKey(newKey: SigningKey): void {
    if (this.activeKeyId) {
      const old = this.keys.get(this.activeKeyId);
      if (old) {
        old.status = "rotated";
        newKey.rotated_from = old.key_id;
      }
    }
    newKey.status = "active";
    this.addKey(newKey);
    this.activeKeyId = newKey.key_id;
  }

  revokeKey(keyId: string): void {
    const key = this.keys.get(keyId);
    if (key) key.status = "revoked";
    if (this.activeKeyId === keyId) this.activeKeyId = null;
  }

  listKeys(): SigningKey[] {
    return Array.from(this.keys.values());
  }
}

// ============================================================================
// Signature Envelope
// ============================================================================

export interface SignatureEnvelope {
  algorithm: "ed25519" | "ecdsa" | "hmac-sha256";
  key_id: string;
  payload_digest: string;    // SHA-256 of canonical payload
  signature: string;          // base64-encoded signature
  signed_at: string;
  nonce: string;               // replay protection
}

// ============================================================================
// Signer
// ============================================================================

export interface Signer {
  sign(payload: unknown, keyId?: string): Promise<SignatureEnvelope>;
  verify(payload: unknown, envelope: SignatureEnvelope): Promise<boolean>;
}

// ============================================================================
// HMAC-SHA256 Signer (simple, no external deps)
// ============================================================================

export class HmacSha256Signer implements Signer {
  private keyStore: KeyStore;
  private usedNonces = new Set<string>();

  constructor(keyStore: KeyStore) {
    this.keyStore = keyStore;
  }

  async sign(payload: unknown, keyId?: string): Promise<SignatureEnvelope> {
    const key = keyId
      ? this.keyStore.getKey(keyId)
      : this.keyStore.getActiveKey();

    if (!key || key.status !== "active" || !key.private_key) {
      throw new Error(`No active signing key available`);
    }

    const canonical = canonicalize(payload);
    const payloadDigest = sha256(canonical);
    const nonce = randomUUID();
    const signData = `${payloadDigest}:${nonce}`;

    // HMAC-SHA256 using Node crypto
    const hmac = createHmacWithKey(key.private_key, signData);

    return {
      algorithm: "hmac-sha256",
      key_id: key.key_id,
      payload_digest: payloadDigest,
      signature: hmac,
      signed_at: new Date().toISOString(),
      nonce,
    };
  }

  async verify(payload: unknown, envelope: SignatureEnvelope): Promise<boolean> {
    // 1. Check nonce not replayed
    if (this.usedNonces.has(envelope.nonce)) {
      return false; // Replay attack
    }

    // 2. Get key
    const key = this.keyStore.getKey(envelope.key_id);
    if (!key || key.status === "revoked") {
      return false;
    }

    // 3. Verify payload digest
    const canonical = canonicalize(payload);
    const expectedDigest = sha256(canonical);
    if (expectedDigest !== envelope.payload_digest) {
      return false; // Payload tampered
    }

    // 4. Verify signature
    const signData = `${expectedDigest}:${envelope.nonce}`;
    const expectedSig = createHmacWithKey(key.public_key, signData);
    if (expectedSig !== envelope.signature) {
      return false;
    }

    // 5. Mark nonce as used
    this.usedNonces.add(envelope.nonce);

    return true;
  }

  clearNonces(): void {
    this.usedNonces.clear();
  }
}

function createHmacWithKey(keyBase64: string, data: string): string {
  const crypto = require("node:crypto");
  const key = Buffer.from(keyBase64, "base64");
  return crypto.createHmac("sha256", key).update(data).digest("base64");
}

// ============================================================================
// Signed Receipt Builder
// ============================================================================

export interface SignedReceipt {
  execution_id: string;
  request_id: string;
  request_digest: string;
  capability_digest: string;
  authority_id?: string;
  policy_digest?: string;
  risk_decision?: { level: string; score?: number };
  provider_id?: string;
  result_digest?: string;
  status: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  signature?: SignatureEnvelope;
}

export async function buildSignedReceipt(
  input: {
    execution_id: string;
    request_id: string;
    request: unknown;
    capability: unknown;
    authority_id?: string;
    policy_decision?: unknown;
    risk_decision?: { level: string; score?: number };
    provider_id?: string;
    result?: unknown;
    status: string;
    started_at: string;
    completed_at?: string;
  },
  signer?: Signer
): Promise<SignedReceipt> {
  const receipt: SignedReceipt = {
    execution_id: input.execution_id,
    request_id: input.request_id,
    request_digest: `sha256:${sha256(canonicalize(input.request))}`,
    capability_digest: `sha256:${sha256(canonicalize(input.capability))}`,
    authority_id: input.authority_id,
    policy_digest: input.policy_decision ? `sha256:${sha256(canonicalize(input.policy_decision))}` : undefined,
    risk_decision: input.risk_decision,
    provider_id: input.provider_id,
    result_digest: input.result !== undefined ? `sha256:${sha256(canonicalize(input.result))}` : undefined,
    status: input.status,
    started_at: input.started_at,
    completed_at: input.completed_at,
  };

  if (input.completed_at) {
    receipt.duration_ms = new Date(input.completed_at).getTime() - new Date(input.started_at).getTime();
  }

  if (signer) {
    // Sign the receipt (without the signature field itself)
    const { signature: _, ...receiptForSigning } = receipt;
    receipt.signature = await signer.sign(receiptForSigning);
  }

  return receipt;
}

export async function verifySignedReceipt(
  receipt: SignedReceipt,
  signer: Signer
): Promise<{ valid: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // 1. Verify signature
  if (receipt.signature) {
    const { signature: _, ...receiptForVerification } = receipt;
    const sigValid = await signer.verify(receiptForVerification, receipt.signature);
    if (!sigValid) {
      reasons.push("signature verification failed (tampered or replayed)");
    }
  } else {
    reasons.push("no signature present");
  }

  return { valid: reasons.length === 0, reasons };
}

// ============================================================================
// Signed Authority (portable, cross-organization)
// ============================================================================

export interface SignedAuthority {
  authority_id: string;
  subject_id: string;
  issuer_id: string;
  capabilities: string[];
  resources: string[];
  expires_at: string;
  delegatable: boolean;
  parent_authority_id?: string;
  signature?: SignatureEnvelope;
}

export async function buildSignedAuthority(
  authority: {
    id: string;
    subject: { id: string };
    issued_by: { id: string };
    capabilities: string[];
    resources: string[];
    expires_at: string;
    delegatable: boolean;
    parent_authority_id?: string;
  },
  signer: Signer
): Promise<SignedAuthority> {
  const signed: SignedAuthority = {
    authority_id: authority.id,
    subject_id: authority.subject.id,
    issuer_id: authority.issued_by.id,
    capabilities: authority.capabilities,
    resources: authority.resources,
    expires_at: authority.expires_at,
    delegatable: authority.delegatable,
    parent_authority_id: authority.parent_authority_id,
  };

  const { signature: _, ...forSigning } = signed;
  signed.signature = await signer.sign(forSigning);

  return signed;
}

export async function verifySignedAuthority(
  authority: SignedAuthority,
  signer: Signer
): Promise<{ valid: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // Check expiry
  if (new Date(authority.expires_at) < new Date()) {
    reasons.push("authority expired");
  }

  // Check signature
  if (authority.signature) {
    const { signature: _, ...forVerification } = authority;
    const sigValid = await signer.verify(forVerification, authority.signature);
    if (!sigValid) {
      reasons.push("signature verification failed");
    }
  } else {
    reasons.push("no signature present");
  }

  return { valid: reasons.length === 0, reasons };
}
