/**
 * Persistence Interfaces
 * Reference: spec/10-10 §36 Persistence§37 Atomicity
 * 
 * runtime production in-memory Map.
 * 
 * Interfaces:
 * - ExecutionStore        — ExecutionRecords
 * - AuthorityStore        — Authority objects
 * - IdempotencyStore      — idempotency entries (atomic!)
 * - ArtifactStore         — artifact bytes + metadata
 * - EventStore            — event log
 * - AuditStore            — audit chain
 * - BudgetStore           — budget reservations
 * 
 * Atomic operations Required:
 * - compareAndSet
 * - conditionalInsert (insertIfAbsent)
 * - transaction
  */

import type {
  AEPError,
  AEPEvent,
  Artifact,
  Budget,
  ExecutionRecord,
  ExecutionState,
  Principal,
} from "../core/types.js";
import type { Authority } from "../authority/engine.js";
import type { AuditEntry, AuditRecord } from "../events/audit.js";

// ============================================================================
// ExecutionStore
// ============================================================================

export interface ExecutionStore {
  save(record: ExecutionRecord): Promise<void>;
  load(id: string): Promise<ExecutionRecord | null>;
  update(id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord | null>;
  /**
    * Atomic state transition.
    * if current state != expectedFrom.
    */
  transition(
    id: string,
    expectedFrom: ExecutionState,
    to: ExecutionState,
    patch?: Partial<ExecutionRecord>
  ): Promise<{ success: boolean; record: ExecutionRecord | null }>;
  list(filter?: { principal_id?: string; state?: ExecutionState }): Promise<ExecutionRecord[]>;
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// AuthorityStore
// ============================================================================

export interface AuthorityStore {
  save(authority: Authority): Promise<void>;
  load(id: string): Promise<Authority | null>;
  /**
    * Atomic: set status → REVOKED. returns false if not found.
    */
  revoke(id: string, revoker: Principal, cascade: boolean): Promise<boolean>;
  /**
    * authorities parent_id (cascade).
    */
  listChildren(parentId: string): Promise<Authority[]>;
  listBySubject(subjectId: string): Promise<Authority[]>;
  /**
    * authority (cache invalidation).
    */
  isRevoked(id: string): Promise<boolean>;
}

// ============================================================================
// IdempotencyStore — atomic!
// ============================================================================

export interface IdempotencyStore {
  /**
    * Atomic reserve. Creates entry .
    * request "claimed".
    * 
    * @returns { created: true, entry: IdempotencyEntry }  if 
    * @returns { created: false, entry: IdempotencyEntry }  if 
    */
  reserve(
    scope: IdempotencyScope,
    factory: () => IdempotencyEntry,
    ttlMs: number
  ): Promise<{ created: boolean; entry: IdempotencyEntry }>;

  /**
    * after .
    */
  update(scope: IdempotencyScope, patch: Partial<IdempotencyEntry>): Promise<void>;

  /**
    * (without reserve).
    */
  get(scope: IdempotencyScope): Promise<IdempotencyEntry | null>;

  /**
    * .
    */
  gc(): Promise<number>;
}

export interface IdempotencyScope {
  tenant_id?: string;
  principal_id: string;
  capability_id: string;
  resource?: string;
  authority_id?: string;
  idempotency_key: string;
}

export interface IdempotencyEntry {
  scope: IdempotencyScope;
  execution_id: string;
  state: ExecutionState;
  output?: unknown;
  artifacts?: string[];
  error?: AEPError;
  expires_at: number; // epoch ms
}

// ============================================================================
// ArtifactStore
// ============================================================================

export interface ArtifactStore {
  store(data: Buffer, metadata: Omit<Artifact, "id" | "size" | "checksum"> & { id?: string }): Promise<Artifact>;
  retrieve(id: string): Promise<{ artifact: Artifact; data: Buffer } | null>;
  getMetadata(id: string): Promise<Artifact | null>;
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// EventStore — durable event log
// ============================================================================

export interface EventStore {
  append(event: AEPEvent): Promise<void>;
  appendBatch(events: AEPEvent[]): Promise<void>;
  /**
    * sequence with.
    */
  read(fromSequence: number, opts?: { limit?: number; filter?: (e: AEPEvent) => boolean }): Promise<AEPEvent[]>;
  /**
    * sequence .
    */
  lastSequence(): Promise<number>;
}

// ============================================================================
// AuditStore — tamper-evident hash chain
// ============================================================================

export interface AuditStore {
  append(record: AuditRecord): Promise<AuditEntry>;
  verify(): Promise<{ valid: boolean; broken_at?: number }>;
  list(filter?: (e: AuditEntry) => boolean): Promise<AuditEntry[]>;
}

// ============================================================================
// BudgetStore — reserve/consume/settle
// ============================================================================

export interface BudgetStore {
  /**
    * Reserve — .
    * if < requested.
    */
  reserve(
    scope: BudgetScope,
    amount: BudgetReservation
  ): Promise<{ success: boolean; reservation_id: string; remaining: Budget }>;

  /**
    * Consume — ().
    */
  consume(
    reservation_id: string,
    actual: BudgetReservation
  ): Promise<{ remaining: Budget }>;

  /**
    * Settle — .
    */
  settle(reservation_id: string): Promise<void>;

  /**
    * .
    */
  remaining(scope: BudgetScope): Promise<Budget>;
}

export interface BudgetScope {
  tenant_id?: string;
  principal_id: string;
  authority_id?: string;
}

export interface BudgetReservation {
  cost_usd?: number;
  calls?: number;
  duration_ms?: number;
  bytes?: number;
}

// ============================================================================
// InMemory implementations (for dev/testing only — NOT for production)
// ============================================================================

export class InMemoryExecutionStore implements ExecutionStore {
  private map = new Map<string, ExecutionRecord>();

  async save(record: ExecutionRecord): Promise<void> {
    this.map.set(record.id, { ...record });
  }

  async load(id: string): Promise<ExecutionRecord | null> {
    const r = this.map.get(id);
    return r ? { ...r } : null;
  }

  async update(id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord | null> {
    const r = this.map.get(id);
    if (!r) return null;
    Object.assign(r, patch);
    return { ...r };
  }

  async transition(
    id: string,
    expectedFrom: ExecutionState,
    to: ExecutionState,
    patch?: Partial<ExecutionRecord>
  ): Promise<{ success: boolean; record: ExecutionRecord | null }> {
    const r = this.map.get(id);
    if (!r) return { success: false, record: null };
    if (r.state !== expectedFrom) {
      return { success: false, record: { ...r } };
    }
    r.previous_state = r.state;
    r.state = to;
    if (patch) Object.assign(r, patch);
    return { success: true, record: { ...r } };
  }

  async list(filter?: { principal_id?: string; state?: ExecutionState }): Promise<ExecutionRecord[]> {
    let items = Array.from(this.map.values());
    if (filter?.principal_id) {
      items = items.filter((r) => r.principal.id === filter.principal_id);
    }
    if (filter?.state) {
      items = items.filter((r) => r.state === filter.state);
    }
    return items.map((r) => ({ ...r }));
  }

  async delete(id: string): Promise<boolean> {
    return this.map.delete(id);
  }
}

export class InMemoryAuthorityStore implements AuthorityStore {
  private map = new Map<string, Authority>();
  private revoked = new Set<string>();

  async save(authority: Authority): Promise<void> {
    this.map.set(authority.id, { ...authority });
  }

  async load(id: string): Promise<Authority | null> {
    const a = this.map.get(id);
    return a ? { ...a } : null;
  }

  async revoke(id: string, _revoker: Principal, cascade: boolean): Promise<boolean> {
    const a = this.map.get(id);
    if (!a) return false;
    a.state = "revoked";
    this.revoked.add(id);
    if (cascade) {
      for (const child of this.map.values()) {
        if (child.parent_authority_id === id) {
          child.state = "revoked";
          this.revoked.add(child.id);
        }
      }
    }
    return true;
  }

  async listChildren(parentId: string): Promise<Authority[]> {
    return Array.from(this.map.values()).filter((a) => a.parent_authority_id === parentId);
  }

  async listBySubject(subjectId: string): Promise<Authority[]> {
    return Array.from(this.map.values()).filter((a) => a.subject.id === subjectId);
  }

  async isRevoked(id: string): Promise<boolean> {
    return this.revoked.has(id);
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private map = new Map<string, IdempotencyEntry>();

  private scopeKey(scope: IdempotencyScope): string {
    return [
      scope.tenant_id || "",
      scope.principal_id,
      scope.capability_id,
      scope.resource || "",
      scope.authority_id || "",
      scope.idempotency_key,
    ].join("::");
  }

  async reserve(
    scope: IdempotencyScope,
    factory: () => IdempotencyEntry,
    ttlMs: number
  ): Promise<{ created: boolean; entry: IdempotencyEntry }> {
    const key = this.scopeKey(scope);
    const existing = this.map.get(key);
    if (existing && existing.expires_at > Date.now()) {
      return { created: false, entry: existing };
    }
    const entry = factory();
    entry.expires_at = Date.now() + ttlMs;
    this.map.set(key, entry);
    return { created: true, entry };
  }

  async update(scope: IdempotencyScope, patch: Partial<IdempotencyEntry>): Promise<void> {
    const key = this.scopeKey(scope);
    const e = this.map.get(key);
    if (e) Object.assign(e, patch);
  }

  async get(scope: IdempotencyScope): Promise<IdempotencyEntry | null> {
    const key = this.scopeKey(scope);
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires_at <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e;
  }

  async gc(): Promise<number> {
    let removed = 0;
    const now = Date.now();
    for (const [key, e] of this.map) {
      if (e.expires_at <= now) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

export class InMemoryBudgetStore implements BudgetStore {
  private reservations = new Map<string, { scope: BudgetScope; reserved: BudgetReservation; actual?: BudgetReservation }>();
  private consumed = new Map<string, Budget>();
  private nextId = 1;

  async reserve(
    scope: BudgetScope,
    amount: BudgetReservation
  ): Promise<{ success: boolean; reservation_id: string; remaining: Budget }> {
    const id = `res_${this.nextId++}`;
    this.reservations.set(id, { scope, reserved: amount });
    return { success: true, reservation_id: id, remaining: {} };
  }

  async consume(
    reservation_id: string,
    actual: BudgetReservation
  ): Promise<{ remaining: Budget }> {
    const r = this.reservations.get(reservation_id);
    if (!r) return { remaining: {} };
    r.actual = actual;
    return { remaining: {} };
  }

  async settle(reservation_id: string): Promise<void> {
    this.reservations.delete(reservation_id);
  }

  async remaining(_scope: BudgetScope): Promise<Budget> {
    return {};
  }
}

export class InMemoryEventStore implements EventStore {
  private events: AEPEvent[] = [];
  private sequence = 0;

  async append(event: AEPEvent): Promise<void> {
    if (event.sequence === undefined) event.sequence = ++this.sequence;
    this.events.push(event);
  }

  async appendBatch(events: AEPEvent[]): Promise<void> {
    for (const e of events) await this.append(e);
  }

  async read(fromSequence: number, opts?: { limit?: number; filter?: (e: AEPEvent) => boolean }): Promise<AEPEvent[]> {
    let items = this.events.filter((e) => (e.sequence || 0) >= fromSequence);
    if (opts?.filter) items = items.filter(opts.filter);
    if (opts?.limit) items = items.slice(0, opts.limit);
    return items;
  }

  async lastSequence(): Promise<number> {
    return this.sequence;
  }
}
