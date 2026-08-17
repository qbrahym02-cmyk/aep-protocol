/**
 * Audit Engine — Tamper-evident log
 * Reference: spec/004-execution.md §Audit
 * 
 * hash_n = SHA256(canonical(record_n) || hash_(n-1))
  */

import { canonicalize } from "../core/canonical.js";
import { sha256 } from "../core/canonical.js";

export interface AuditRecord {
  /** assigned automatically by AuditEngine.record() */
  seq?: number;
  timestamp: string;
  who?: string;
  what?: string;
  when?: string;
  where?: string;
  why?: string;
  capability?: string;
  resource?: string;
  policy?: string;
  decision?: string;
  result?: string;
  details?: Record<string, unknown>;
}

export interface AuditEntry extends AuditRecord {
  hash: string;
  prev_hash: string;
}

export class AuditEngine {
  private records: AuditEntry[] = [];
  private genesisHash = "0".repeat(64);

  /**
    * . Returns hash.
    */
  record(rec: AuditRecord): AuditEntry {
    const seq = this.records.length + 1;
    const prev_hash = this.records.length > 0
      ? this.records[this.records.length - 1].hash
      : this.genesisHash;
    const seqRecord = { ...rec, seq };
    const hash = sha256(canonicalize(seqRecord) + prev_hash);
    const entry: AuditEntry = { ...seqRecord, hash, prev_hash };
    this.records.push(entry);
    return entry;
  }

  /**
    * Verification (tamper-evident).
    * Must after hash prev_hash canonicalize .
    */
  verify(): { valid: boolean; broken_at?: number } {
    let prev = this.genesisHash;
    for (let i = 0; i < this.records.length; i++) {
      const entry = this.records[i];
      // hash prev_hash — 
      const { hash: _h, prev_hash: _p, ...rest } = entry;
      const expected = sha256(canonicalize({ ...rest, seq: entry.seq }) + prev);
      if (expected !== entry.hash) {
        return { valid: false, broken_at: i + 1 };
      }
      prev = entry.hash;
    }
    return { valid: true };
  }

  /**
    * Records.
    */
  list(): AuditEntry[] {
    return [...this.records];
  }

  /**
    * .
    */
  query(filter: (r: AuditEntry) => boolean): AuditEntry[] {
    return this.records.filter(filter);
  }

  stats(): { count: number; last_hash: string } {
    return {
      count: this.records.length,
      last_hash: this.records.length > 0
        ? this.records[this.records.length - 1].hash
        : this.genesisHash,
    };
  }
}
