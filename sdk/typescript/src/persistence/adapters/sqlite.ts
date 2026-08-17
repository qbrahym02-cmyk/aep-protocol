/**
 * SQLite Adapter — Durable persistence via SQLite
 * Reference: spec/10-10 §36 Persistence§37 Atomicity§38 State Persistence
 * 
 * :
 * - dev/local deployments
 * - single-node production (with WAL)
 * - testing
 * 
 * Supports:
 * - atomic transactions (BEGIN/COMMIT)
 * - conditional insert (INSERT OR IGNORE + check changes())
 * - conditional update (UPDATE ... WHERE state = ?)
 * - JSON storage for complex objects
 * 
 * NOT distributed — use PostgreSQL adapter for multi-node.
  */

import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
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
} from "../interfaces.js";
import type { Authority } from "../../authority/engine.js";
import type { AuditEntry, AuditRecord } from "../../events/audit.js";
import { canonicalize, sha256 } from "../../core/canonical.js";
import type { Principal } from "../../core/types.js";

// ============================================================================
// SQLiteAdapter — composite class implementing multiple stores
// ============================================================================

export interface SQLiteStoreOptions {
  dbPath: string;       // file path (":memory:" for in-memory)
  wal?: boolean;        // enable WAL mode (default true for files)
  verbose?: boolean;
}

export class SQLiteStore {
  private db: DatabaseSync;
  private opts: SQLiteStoreOptions;

  constructor(opts: SQLiteStoreOptions) {
    this.opts = opts;
    if (opts.dbPath !== ":memory:") {
      mkdirSync(dirname(opts.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(opts.dbPath);
    if (opts.wal !== false && opts.dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  // Expose typed views (avoids interface conflicts from same method names)
  asExecutionStore(): ExecutionStore {
    return {
      save: (r: ExecutionRecord) => this.saveExecution(r),
      load: (id: string) => this.loadExecution(id),
      update: (id: string, patch: Partial<ExecutionRecord>) => this.updateExecution(id, patch),
      transition: (id: string, from: ExecutionState, to: ExecutionState, patch?: Partial<ExecutionRecord>) =>
        this.transitionExecution(id, from, to, patch),
      list: (filter?: { principal_id?: string; state?: ExecutionState }) => this.listExecutions(filter),
      delete: (id: string) => this.deleteExecution(id),
    };
  }

  asAuthorityStore(): AuthorityStore {
    return {
      save: (a: Authority) => this.saveAuthority(a),
      load: (id: string) => this.loadAuthority(id),
      revoke: (id: string, revoker: Principal, cascade: boolean) => this.revokeAuthority(id, revoker, cascade),
      listChildren: (parentId: string) => this.listAuthorityChildren(parentId),
      listBySubject: (subjectId: string) => this.listAuthoritiesBySubject(subjectId),
      isRevoked: (id: string) => this.isAuthorityRevoked(id),
    };
  }

  asIdempotencyStore(): IdempotencyStore {
    return {
      reserve: (scope: IdempotencyScope, factory: () => IdempotencyEntry, ttlMs: number) =>
        this.reserveIdempotency(scope, factory, ttlMs),
      update: (scope: IdempotencyScope, patch: Partial<IdempotencyEntry>) => this.updateIdempotency(scope, patch),
      get: (scope: IdempotencyScope) => this.getIdempotency(scope),
      gc: () => this.gcIdempotency(),
    };
  }

  asEventStore(): EventStore {
    return {
      append: (e: AEPEvent) => this.appendEvent(e),
      appendBatch: (events: AEPEvent[]) => this.appendEventsBatch(events),
      read: (fromSequence: number, opts?: { limit?: number; filter?: (e: AEPEvent) => boolean }) =>
        this.readEvents(fromSequence, opts),
      lastSequence: () => this.lastEventSequence(),
    };
  }

  asAuditStore(): AuditStore {
    return {
      append: (r: AuditRecord) => this.appendAudit(r),
      verify: () => this.verifyAudit(),
      list: (filter?: (e: AuditEntry) => boolean) => this.listAudit(filter),
    };
  }

  // ========================================================================
  // Migrations
  // ========================================================================

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        state TEXT NOT NULL,
        previous_state TEXT,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_executions_principal ON executions(principal);
      CREATE INDEX IF NOT EXISTS idx_executions_state ON executions(state);
      CREATE INDEX IF NOT EXISTS idx_executions_request ON executions(request_id);

      CREATE TABLE IF NOT EXISTS authorities (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        issuer_id TEXT NOT NULL,
        parent_id TEXT,
        state TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        delegatable INTEGER NOT NULL,
        authority_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_authorities_subject ON authorities(subject_id);
      CREATE INDEX IF NOT EXISTS idx_authorities_parent ON authorities(parent_id);
      CREATE INDEX IF NOT EXISTS idx_authorities_state ON authorities(state);

      CREATE TABLE IF NOT EXISTS idempotency (
        scope_hash TEXT PRIMARY KEY,
        tenant_id TEXT,
        principal_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        resource TEXT,
        authority_id TEXT,
        idempotency_key TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        state TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency(expires_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_principal ON idempotency(principal_id);

      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        execution_id TEXT,
        trace_id TEXT,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_execution ON events(execution_id);

      CREATE TABLE IF NOT EXISTS audit_chain (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revocations (
        authority_id TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL,
        revoked_by TEXT NOT NULL,
        reason TEXT
      );
    `);
  }

  // ========================================================================
  // ExecutionStore
  // ========================================================================

  async saveExecution(record: ExecutionRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO executions
        (id, request_id, principal, capability_id, state, previous_state, record_json, created_at, completed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.request_id,
      record.principal.id,
      record.capability.id,
      record.state,
      record.previous_state || null,
      JSON.stringify(record),
      record.created_at,
      record.completed_at || null,
      record.expires_at || null
    );
  }

  async loadExecution(id: string): Promise<ExecutionRecord | null> {
    const stmt = this.db.prepare("SELECT record_json FROM executions WHERE id = ?");
    const row = stmt.get(id) as { record_json: string } | undefined;
    return row ? JSON.parse(row.record_json) : null;
  }

  async updateExecution(id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord | null> {
    const existing = await this.loadExecution(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await this.saveExecution(updated);
    return updated;
  }

  async transitionExecution(
    id: string,
    expectedFrom: ExecutionState,
    to: ExecutionState,
    patch?: Partial<ExecutionRecord>
  ): Promise<{ success: boolean; record: ExecutionRecord | null }> {
    try { this.db.exec("BEGIN"); } catch { /* already in tx */ }
    try {
      const stmt = this.db.prepare("SELECT record_json FROM executions WHERE id = ?");
      const row = stmt.get(id) as { record_json: string } | undefined;
      if (!row) {
        try { this.db.exec("ROLLBACK"); } catch { /* */ }
        return { success: false, record: null };
      }
      const record = JSON.parse(row.record_json) as ExecutionRecord;
      if (record.state !== expectedFrom) {
        try { this.db.exec("ROLLBACK"); } catch { /* */ }
        return { success: false, record };
      }
      record.previous_state = record.state;
      record.state = to;
      if (patch) Object.assign(record, patch);
      const updateStmt = this.db.prepare(`
        UPDATE executions SET state = ?, previous_state = ?, record_json = ?, completed_at = ?
        WHERE id = ? AND state = ?
      `);
      const result = updateStmt.run(
        record.state,
        record.previous_state,
        JSON.stringify(record),
        record.completed_at || null,
        id,
        expectedFrom
      );
      if (result.changes === 0) {
        try { this.db.exec("ROLLBACK"); } catch { /* */ }
        return { success: false, record };
      }
      this.db.exec("COMMIT");
      return { success: true, record };
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
  }

  async listExecutions(filter?: { principal_id?: string; state?: ExecutionState }): Promise<ExecutionRecord[]> {
    let sql = "SELECT record_json FROM executions";
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.principal_id) {
      conditions.push("principal = ?");
      params.push(filter.principal_id);
    }
    if (filter?.state) {
      conditions.push("state = ?");
      params.push(filter.state);
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC LIMIT 1000";
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { record_json: string }[];
    return rows.map((r) => JSON.parse(r.record_json));
  }

  async deleteExecution(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM executions WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ========================================================================
  // AuthorityStore
  // ========================================================================

  async saveAuthority(authority: Authority): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO authorities
        (id, subject_id, issuer_id, parent_id, state, expires_at, delegatable, authority_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      authority.id,
      authority.subject.id,
      authority.issued_by.id,
      authority.parent_authority_id || null,
      authority.state,
      authority.expires_at,
      authority.delegatable ? 1 : 0,
      JSON.stringify(authority),
      authority.issued_at
    );
  }

  async loadAuthority(id: string): Promise<Authority | null> {
    const stmt = this.db.prepare("SELECT authority_json FROM authorities WHERE id = ?");
    const row = stmt.get(id) as { authority_json: string } | undefined;
    return row ? JSON.parse(row.authority_json) : null;
  }

  async revokeAuthority(id: string, revoker: Principal, cascade: boolean): Promise<boolean> {
    try { this.db.exec("BEGIN"); } catch { /* already in tx */ }
    try {
      const stmt = this.db.prepare("UPDATE authorities SET state = 'revoked' WHERE id = ? AND state = 'active'");
      const result = stmt.run(id);
      if (result.changes === 0) {
        try { this.db.exec("ROLLBACK"); } catch { /**/ }
        return false;
      }
      const revStmt = this.db.prepare(`
        INSERT OR REPLACE INTO revocations (authority_id, revoked_at, revoked_by, reason)
        VALUES (?, ?, ?, ?)
      `);
      revStmt.run(id, new Date().toISOString(), revoker.id, cascade ? "cascade" : "explicit");

      if (cascade) {
        const cascadeStmt = this.db.prepare(`
          WITH RECURSIVE descendants AS (
            SELECT id FROM authorities WHERE parent_id = ?
            UNION ALL
            SELECT a.id FROM authorities a
            JOIN descendants d ON a.parent_id = d.id
          )
          UPDATE authorities SET state = 'revoked'
          WHERE id IN (SELECT id FROM descendants)
        `);
        cascadeStmt.run(id);
        const childrenStmt = this.db.prepare(`
          WITH RECURSIVE descendants AS (
            SELECT id FROM authorities WHERE parent_id = ?
            UNION ALL
            SELECT a.id FROM authorities a
            JOIN descendants d ON a.parent_id = d.id
          )
          SELECT id FROM descendants
        `);
        const children = childrenStmt.all(id) as { id: string }[];
        for (const child of children) {
          revStmt.run(child.id, new Date().toISOString(), revoker.id, "cascade");
        }
      }
      this.db.exec("COMMIT");
      return true;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
  }

  async listAuthorityChildren(parentId: string): Promise<Authority[]> {
    const stmt = this.db.prepare("SELECT authority_json FROM authorities WHERE parent_id = ?");
    const rows = stmt.all(parentId) as { authority_json: string }[];
    return rows.map((r) => JSON.parse(r.authority_json));
  }

  async listAuthoritiesBySubject(subjectId: string): Promise<Authority[]> {
    const stmt = this.db.prepare("SELECT authority_json FROM authorities WHERE subject_id = ?");
    const rows = stmt.all(subjectId) as { authority_json: string }[];
    return rows.map((r) => JSON.parse(r.authority_json));
  }

  async isAuthorityRevoked(id: string): Promise<boolean> {
    const stmt = this.db.prepare("SELECT 1 FROM revocations WHERE authority_id = ?");
    return stmt.get(id) !== undefined;
  }

  // ========================================================================
  // IdempotencyStore — atomic reserve via INSERT OR IGNORE
  // ========================================================================

  private scopeHash(scope: IdempotencyScope): string {
    return sha256(canonicalize(scope));
  }

  async reserveIdempotency(
    scope: IdempotencyScope,
    factory: () => IdempotencyEntry,
    ttlMs: number
  ): Promise<{ created: boolean; entry: IdempotencyEntry }> {
    const hash = this.scopeHash(scope);
    try { this.db.exec("BEGIN"); } catch { /* already in tx */ }
    try {
      const checkStmt = this.db.prepare(`
        SELECT entry_json FROM idempotency
        WHERE scope_hash = ? AND expires_at > ?
      `);
      const existing = checkStmt.get(hash, Date.now()) as { entry_json: string } | undefined;
      if (existing) {
        try { this.db.exec("ROLLBACK"); } catch { /**/ }
        return { created: false, entry: JSON.parse(existing.entry_json) };
      }
      const entry = factory();
      entry.expires_at = Date.now() + ttlMs;
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO idempotency
          (scope_hash, tenant_id, principal_id, capability_id, resource, authority_id, idempotency_key,
           execution_id, state, entry_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertStmt.run(
        hash,
        scope.tenant_id || null,
        scope.principal_id,
        scope.capability_id,
        scope.resource || null,
        scope.authority_id || null,
        scope.idempotency_key,
        entry.execution_id,
        entry.state,
        JSON.stringify(entry),
        entry.expires_at,
        Date.now()
      );
      if (result.changes === 0) {
        const retry = checkStmt.get(hash, Date.now()) as { entry_json: string } | undefined;
        try { this.db.exec("ROLLBACK"); } catch { /**/ }
        if (retry) {
          return { created: false, entry: JSON.parse(retry.entry_json) };
        }
        throw new Error("idempotency reserve failed unexpectedly");
      }
      this.db.exec("COMMIT");
      return { created: true, entry };
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
  }

  async updateIdempotency(scope: IdempotencyScope, patch: Partial<IdempotencyEntry>): Promise<void> {
    const hash = this.scopeHash(scope);
    const stmt = this.db.prepare("SELECT entry_json FROM idempotency WHERE scope_hash = ?");
    const row = stmt.get(hash) as { entry_json: string } | undefined;
    if (!row) return;
    const entry = { ...JSON.parse(row.entry_json), ...patch };
    const updateStmt = this.db.prepare("UPDATE idempotency SET entry_json = ? WHERE scope_hash = ?");
    updateStmt.run(JSON.stringify(entry), hash);
  }

  async getIdempotency(scope: IdempotencyScope): Promise<IdempotencyEntry | null> {
    const hash = this.scopeHash(scope);
    const stmt = this.db.prepare("SELECT entry_json FROM idempotency WHERE scope_hash = ? AND expires_at > ?");
    const row = stmt.get(hash, Date.now()) as { entry_json: string } | undefined;
    return row ? JSON.parse(row.entry_json) : null;
  }

  async gcIdempotency(): Promise<number> {
    const stmt = this.db.prepare("DELETE FROM idempotency WHERE expires_at <= ?");
    const result = stmt.run(Date.now());
    return Number(result.changes);
  }

  // ========================================================================
  // EventStore
  // ========================================================================

  async appendEvent(event: AEPEvent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, type, source, timestamp, execution_id, trace_id, event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.event_id,
      event.type,
      event.source,
      event.timestamp,
      event.execution_id || null,
      event.trace_id || null,
      JSON.stringify(event)
    );
  }

  async appendEventsBatch(events: AEPEvent[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const e of events) await this.appendEvent(e);
      this.db.exec("COMMIT");
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
  }

  async readEvents(fromSequence: number, opts?: { limit?: number; filter?: (e: AEPEvent) => boolean }): Promise<AEPEvent[]> {
    let sql = "SELECT event_json FROM events WHERE sequence >= ?";
    const params: (string | number)[] = [fromSequence];
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { event_json: string }[];
    let events = rows.map((r) => JSON.parse(r.event_json) as AEPEvent);
    if (opts?.filter) events = events.filter(opts.filter);
    return events;
  }

  async lastEventSequence(): Promise<number> {
    const stmt = this.db.prepare("SELECT MAX(sequence) as max FROM events");
    const row = stmt.get() as { max: number | null } | undefined;
    return Number(row?.max || 0);
  }

  // ========================================================================
  // AuditStore
  // ========================================================================

  async appendAudit(record: AuditRecord): Promise<AuditEntry> {
    const seqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), 0) as max FROM audit_chain");
    const seqRow = seqStmt.get() as { max: number };
    const seq = seqRow.max + 1;
    const prevHashStmt = this.db.prepare("SELECT hash FROM audit_chain WHERE seq = ?");
    const prevRow = prevHashStmt.get(seqRow.max) as { hash: string } | undefined;
    const prevHash = prevRow?.hash || "0".repeat(64);
    const hash = sha256(canonicalize({ ...record, seq }) + prevHash);
    const entry: AuditEntry = { ...record, seq, hash, prev_hash: prevHash };
    const stmt = this.db.prepare(`
      INSERT INTO audit_chain (seq, timestamp, entry_json, hash, prev_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(seq, record.timestamp, JSON.stringify(entry), hash, prevHash);
    return entry;
  }

  async verifyAudit(): Promise<{ valid: boolean; broken_at?: number }> {
    const stmt = this.db.prepare("SELECT seq, entry_json, hash, prev_hash FROM audit_chain ORDER BY seq");
    const rows = stmt.all() as { seq: number; entry_json: string; hash: string; prev_hash: string }[];
    let prev = "0".repeat(64);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entry = JSON.parse(row.entry_json) as AuditEntry;
      const { hash: _h, prev_hash: _p, ...rest } = entry;
      const expected = sha256(canonicalize({ ...rest, seq: entry.seq }) + prev);
      if (expected !== row.hash) {
        return { valid: false, broken_at: row.seq };
      }
      prev = row.hash;
    }
    return { valid: true };
  }

  async listAudit(filter?: (e: AuditEntry) => boolean): Promise<AuditEntry[]> {
    const stmt = this.db.prepare("SELECT entry_json FROM audit_chain ORDER BY seq");
    const rows = stmt.all() as { entry_json: string }[];
    const entries = rows.map((r) => JSON.parse(r.entry_json) as AuditEntry);
    return filter ? entries.filter(filter) : entries;
  }
}
