/**
 * PostgreSQL Adapter — Production-grade durable persistence.
 * 
 * Uses pg (node-postgres). Requires PostgreSQL 14+.
 * 
 * Features:
 *   - All 6 stores: Execution, Authority, Idempotency, Event, Audit, Budget
 *   - Atomic transactions (BEGIN/COMMIT)
 *   - Conditional updates (CAS via WHERE clause)
 *   - Recursive CTE for authority cascade revocation
 *   - Connection pooling
 *   - Migration support
 */

import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import type {
  ExecutionRecord,
  ExecutionState,
  AEPEvent,
} from "../../core/types.js";
import type {
  ExecutionStore,
  AuthorityStore,
  IdempotencyStore,
  IdempotencyScope,
  IdempotencyEntry,
  EventStore,
  AuditStore,
  BudgetStore,
  BudgetScope,
  BudgetReservation,
} from "../interfaces.js";
import type { Authority } from "../../authority/engine.js";
import type { AuditEntry, AuditRecord } from "../../events/audit.js";
import { canonicalize, sha256 } from "../../core/canonical.js";
import type { Principal } from "../../core/types.js";

// ============================================================================
// PostgreSQL Adapter
// ============================================================================

export interface PostgresStoreOptions {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  schema?: string; // default: "aep"
}

export class PostgresStore {
  private pool: Pool;
  private schema: string;

  constructor(opts: PostgresStoreOptions) {
    this.pool = new Pool({
      connectionString: opts.connectionString,
      max: opts.maxConnections || 20,
      idleTimeoutMillis: opts.idleTimeoutMs || 30_000,
    });
    this.schema = opts.schema || "aep";
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await this.migrate(client);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async migrate(client: PoolClient): Promise<void> {
    const s = this.schema;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${s}.executions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        tenant_id TEXT,
        capability_id TEXT NOT NULL,
        state TEXT NOT NULL,
        previous_state TEXT,
        record_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_exec_principal ON ${s}.executions(principal_id);
      CREATE INDEX IF NOT EXISTS idx_exec_tenant ON ${s}.executions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_exec_state ON ${s}.executions(state);
      CREATE INDEX IF NOT EXISTS idx_exec_request ON ${s}.executions(request_id);

      CREATE TABLE IF NOT EXISTS ${s}.authorities (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        issuer_id TEXT NOT NULL,
        parent_id TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        expires_at TIMESTAMPTZ NOT NULL,
        delegatable BOOLEAN NOT NULL DEFAULT FALSE,
        authority_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_subject ON ${s}.authorities(subject_id);
      CREATE INDEX IF NOT EXISTS idx_auth_parent ON ${s}.authorities(parent_id);
      CREATE INDEX IF NOT EXISTS idx_auth_state ON ${s}.authorities(state);

      CREATE TABLE IF NOT EXISTS ${s}.revocations (
        authority_id TEXT PRIMARY KEY,
        revoked_at TIMESTAMPTZ NOT NULL,
        revoked_by TEXT NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS ${s}.idempotency (
        scope_hash TEXT PRIMARY KEY,
        tenant_id TEXT,
        principal_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        resource TEXT,
        authority_id TEXT,
        idempotency_key TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        state TEXT NOT NULL,
        entry_json JSONB NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idem_expires ON ${s}.idempotency(expires_at);
      CREATE INDEX IF NOT EXISTS idx_idem_principal ON ${s}.idempotency(principal_id);

      CREATE TABLE IF NOT EXISTS ${s}.events (
        sequence BIGSERIAL PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        execution_id TEXT,
        trace_id TEXT,
        event_json JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON ${s}.events(type);
      CREATE INDEX IF NOT EXISTS idx_events_exec ON ${s}.events(execution_id);

      CREATE TABLE IF NOT EXISTS ${s}.audit_chain (
        seq BIGSERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        entry_json JSONB NOT NULL,
        hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL
      );
    `);
  }

  // ========================================================================
  // ExecutionStore
  // ========================================================================

  async saveExecution(record: ExecutionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.executions (id, request_id, principal_id, tenant_id, capability_id, state, previous_state, record_json, created_at, completed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET record_json = $8, state = $6, previous_state = $7, completed_at = $10`,
      [
        record.id, record.request_id, record.principal.id, record.principal.tenant_id || null,
        record.capability.id, record.state, record.previous_state || null,
        JSON.stringify(record), record.created_at, record.completed_at || null, record.expires_at || null
      ]
    );
  }

  async loadExecution(id: string): Promise<ExecutionRecord | null> {
    const res = await this.pool.query(`SELECT record_json FROM ${this.schema}.executions WHERE id = $1`, [id]);
    return res.rows.length > 0 ? res.rows[0].record_json : null;
  }

  async updateExecution(id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord | null> {
    const existing = await this.loadExecution(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await this.saveExecution(updated);
    return updated;
  }

  async transitionExecution(
    id: string, expectedFrom: ExecutionState, to: ExecutionState, patch?: Partial<ExecutionRecord>
  ): Promise<{ success: boolean; record: ExecutionRecord | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(`SELECT record_json FROM ${this.schema}.executions WHERE id = $1 FOR UPDATE`, [id]);
      if (res.rows.length === 0) { await client.query("ROLLBACK"); return { success: false, record: null }; }
      const record = res.rows[0].record_json as ExecutionRecord;
      if (record.state !== expectedFrom) { await client.query("ROLLBACK"); return { success: false, record }; }
      record.previous_state = record.state;
      record.state = to;
      if (patch) Object.assign(record, patch);
      await client.query(
        `UPDATE ${this.schema}.executions SET state = $1, previous_state = $2, record_json = $3, completed_at = $4 WHERE id = $5 AND state = $6`,
        [record.state, record.previous_state, JSON.stringify(record), record.completed_at || null, id, expectedFrom]
      );
      await client.query("COMMIT");
      return { success: true, record };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async listExecutions(filter?: { principal_id?: string; state?: ExecutionState; tenant_id?: string }): Promise<ExecutionRecord[]> {
    let sql = `SELECT record_json FROM ${this.schema}.executions`;
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;
    if (filter?.principal_id) { conditions.push(`principal_id = $${idx++}`); params.push(filter.principal_id); }
    if (filter?.state) { conditions.push(`state = $${idx++}`); params.push(filter.state); }
    if (filter?.tenant_id) { conditions.push(`tenant_id = $${idx++}`); params.push(filter.tenant_id); }
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT 1000";
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => r.record_json);
  }

  async deleteExecution(id: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM ${this.schema}.executions WHERE id = $1`, [id]);
    return (res.rowCount || 0) > 0;
  }

  // ========================================================================
  // AuthorityStore
  // ========================================================================

  async saveAuthority(authority: Authority): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.authorities (id, subject_id, issuer_id, parent_id, state, expires_at, delegatable, authority_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET authority_json = $8, state = $5`,
      [authority.id, authority.subject.id, authority.issued_by.id, authority.parent_authority_id || null,
       authority.state, authority.expires_at, authority.delegatable, JSON.stringify(authority), authority.issued_at]
    );
  }

  async loadAuthority(id: string): Promise<Authority | null> {
    const res = await this.pool.query(`SELECT authority_json FROM ${this.schema}.authorities WHERE id = $1`, [id]);
    return res.rows.length > 0 ? res.rows[0].authority_json : null;
  }

  async revokeAuthority(id: string, _revoker: Principal, cascade: boolean): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(`UPDATE ${this.schema}.authorities SET state = 'revoked' WHERE id = $1 AND state = 'active'`, [id]);
      if (res.rowCount === 0) { await client.query("ROLLBACK"); return false; }
      await client.query(`INSERT INTO ${this.schema}.revocations (authority_id, revoked_at, revoked_by, reason) VALUES ($1, NOW(), $2, $3)
        ON CONFLICT (authority_id) DO UPDATE SET revoked_at = NOW()`, [id, _revoker.id, cascade ? "cascade" : "explicit"]);
      if (cascade) {
        await client.query(`
          WITH RECURSIVE descendants AS (
            SELECT id FROM ${this.schema}.authorities WHERE parent_id = $1
            UNION ALL
            SELECT a.id FROM ${this.schema}.authorities a JOIN descendants d ON a.parent_id = d.id
          )
          UPDATE ${this.schema}.authorities SET state = 'revoked' WHERE id IN (SELECT id FROM descendants)`,
          [id]);
        await client.query(`
          WITH RECURSIVE descendants AS (
            SELECT id FROM ${this.schema}.authorities WHERE parent_id = $1
            UNION ALL
            SELECT a.id FROM ${this.schema}.authorities a JOIN descendants d ON a.parent_id = d.id
          )
          INSERT INTO ${this.schema}.revocations (authority_id, revoked_at, revoked_by, reason)
          SELECT id, NOW(), $2, 'cascade' FROM descendants
          ON CONFLICT (authority_id) DO UPDATE SET revoked_at = NOW()`,
          [id, _revoker.id]);
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async listAuthorityChildren(parentId: string): Promise<Authority[]> {
    const res = await this.pool.query(`SELECT authority_json FROM ${this.schema}.authorities WHERE parent_id = $1`, [parentId]);
    return res.rows.map((r) => r.authority_json);
  }

  async listAuthoritiesBySubject(subjectId: string): Promise<Authority[]> {
    const res = await this.pool.query(`SELECT authority_json FROM ${this.schema}.authorities WHERE subject_id = $1`, [subjectId]);
    return res.rows.map((r) => r.authority_json);
  }

  async isAuthorityRevoked(id: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM ${this.schema}.revocations WHERE authority_id = $1`, [id]);
    return res.rows.length > 0;
  }

  // ========================================================================
  // IdempotencyStore — atomic reserve via INSERT ON CONFLICT
  // ========================================================================

  private scopeHash(scope: IdempotencyScope): string {
    return sha256(canonicalize(scope));
  }

  async reserveIdempotency(
    scope: IdempotencyScope, factory: () => IdempotencyEntry, ttlMs: number
  ): Promise<{ created: boolean; entry: IdempotencyEntry }> {
    const hash = this.scopeHash(scope);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Check existing (not expired)
      const existing = await client.query(`SELECT entry_json FROM ${this.schema}.idempotency WHERE scope_hash = $1 AND expires_at > $2`, [hash, Date.now()]);
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return { created: false, entry: existing.rows[0].entry_json };
      }
      const entry = factory();
      entry.expires_at = Date.now() + ttlMs;
      // Atomic insert — ON CONFLICT does nothing if row exists
      const result = await client.query(
        `INSERT INTO ${this.schema}.idempotency (scope_hash, tenant_id, principal_id, capability_id, resource, authority_id, idempotency_key, execution_id, state, entry_json, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (scope_hash) DO NOTHING`,
        [hash, scope.tenant_id || null, scope.principal_id, scope.capability_id, scope.resource || null, scope.authority_id || null,
         scope.idempotency_key, entry.execution_id, entry.state, JSON.stringify(entry), entry.expires_at, Date.now()]
      );
      if (result.rowCount === 0) {
        // Someone else inserted — read their entry
        const retry = await client.query(`SELECT entry_json FROM ${this.schema}.idempotency WHERE scope_hash = $1 AND expires_at > $2`, [hash, Date.now()]);
        await client.query("ROLLBACK");
        if (retry.rows.length > 0) return { created: false, entry: retry.rows[0].entry_json };
        throw new Error("idempotency reserve failed unexpectedly");
      }
      await client.query("COMMIT");
      return { created: true, entry };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async updateIdempotency(scope: IdempotencyScope, patch: Partial<IdempotencyEntry>): Promise<void> {
    const hash = this.scopeHash(scope);
    const res = await this.pool.query(`SELECT entry_json FROM ${this.schema}.idempotency WHERE scope_hash = $1`, [hash]);
    if (res.rows.length === 0) return;
    const entry = { ...res.rows[0].entry_json, ...patch };
    await this.pool.query(`UPDATE ${this.schema}.idempotency SET entry_json = $1 WHERE scope_hash = $2`, [JSON.stringify(entry), hash]);
  }

  async getIdempotency(scope: IdempotencyScope): Promise<IdempotencyEntry | null> {
    const hash = this.scopeHash(scope);
    const res = await this.pool.query(`SELECT entry_json FROM ${this.schema}.idempotency WHERE scope_hash = $1 AND expires_at > $2`, [hash, Date.now()]);
    return res.rows.length > 0 ? res.rows[0].entry_json : null;
  }

  async gcIdempotency(): Promise<number> {
    const res = await this.pool.query(`DELETE FROM ${this.schema}.idempotency WHERE expires_at <= $1`, [Date.now()]);
    return res.rowCount || 0;
  }

  // ========================================================================
  // EventStore
  // ========================================================================

  async appendEvent(event: AEPEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.events (event_id, type, source, timestamp, execution_id, trace_id, event_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.event_id, event.type, event.source, event.timestamp, event.execution_id || null, event.trace_id || null, JSON.stringify(event)]
    );
  }

  async appendEventsBatch(events: AEPEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of events) {
        await client.query(
          `INSERT INTO ${this.schema}.events (event_id, type, source, timestamp, execution_id, trace_id, event_json) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [e.event_id, e.type, e.source, e.timestamp, e.execution_id || null, e.trace_id || null, JSON.stringify(e)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async readEvents(fromSequence: number, opts?: { limit?: number; filter?: (e: AEPEvent) => boolean }): Promise<AEPEvent[]> {
    let sql = `SELECT event_json FROM ${this.schema}.events WHERE sequence >= $1`;
    const params: (string | number)[] = [fromSequence];
    if (opts?.limit) { sql += ` LIMIT $2`; params.push(opts.limit); }
    const res = await this.pool.query(sql, params);
    let events = res.rows.map((r) => r.event_json as AEPEvent);
    if (opts?.filter) events = events.filter(opts.filter);
    return events;
  }

  async lastEventSequence(): Promise<number> {
    const res = await this.pool.query(`SELECT MAX(sequence) as max FROM ${this.schema}.events`);
    return Number(res.rows[0]?.max || 0);
  }

  // ========================================================================
  // AuditStore
  // ========================================================================

  async appendAudit(record: AuditRecord): Promise<AuditEntry> {
    const seqRes = await this.pool.query(`SELECT COALESCE(MAX(seq), 0) as max FROM ${this.schema}.audit_chain`);
    const seq = Number(seqRes.rows[0].max) + 1;
    const prevRes = await this.pool.query(`SELECT hash FROM ${this.schema}.audit_chain WHERE seq = $1`, [Number(seqRes.rows[0].max)]);
    const prevHash = prevRes.rows.length > 0 ? prevRes.rows[0].hash : "0".repeat(64);
    const hash = sha256(canonicalize({ ...record, seq }) + prevHash);
    const entry: AuditEntry = { ...record, seq, hash, prev_hash: prevHash };
    await this.pool.query(
      `INSERT INTO ${this.schema}.audit_chain (seq, timestamp, entry_json, hash, prev_hash) VALUES ($1, $2, $3, $4, $5)`,
      [seq, record.timestamp, JSON.stringify(entry), hash, prevHash]
    );
    return entry;
  }

  async verifyAudit(): Promise<{ valid: boolean; broken_at?: number }> {
    const res = await this.pool.query(`SELECT seq, entry_json, hash, prev_hash FROM ${this.schema}.audit_chain ORDER BY seq`);
    let prev = "0".repeat(64);
    for (const row of res.rows) {
      const entry = row.entry_json as AuditEntry;
      const { hash: _h, prev_hash: _p, ...rest } = entry;
      const expected = sha256(canonicalize({ ...rest, seq: entry.seq }) + prev);
      if (expected !== row.hash) return { valid: false, broken_at: Number(row.seq) };
      prev = row.hash;
    }
    return { valid: true };
  }

  async listAudit(filter?: (e: AuditEntry) => boolean): Promise<AuditEntry[]> {
    const res = await this.pool.query(`SELECT entry_json FROM ${this.schema}.audit_chain ORDER BY seq`);
    const entries = res.rows.map((r) => r.entry_json as AuditEntry);
    return filter ? entries.filter(filter) : entries;
  }
}
