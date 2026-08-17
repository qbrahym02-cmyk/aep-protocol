/**
 * AEPServer — High-level API
 * Reference: AEP_10_10 §3§160-163
 * 
 * §3: "Runtime production ."
 * 
 * AEPServer → ExecutionRuntime → SecureExecutionEngine
 * 
 * The legacy ExecutionEngine is @deprecated (§164).
 * This server NEVER uses it.
  */

import type {
  AEPRequest,
  AEPResponse,
  CapabilityContract,
  PolicyDocument,
} from "./core/types.js";
import { CapabilityRegistry } from "./core/registry.js";
import { EventEmitter } from "./events/emitter.js";
import { ArtifactManager } from "./events/artifacts.js";
import { AuditEngine } from "./events/audit.js";
import { PolicyEngine } from "./policy/engine.js";
import { RiskEngine } from "./policy/risk.js";
import { HTTPGateway } from "./gateway/http.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionRuntime } from "./runtime/types.js";
import { createDevelopmentRuntime, createProductionRuntime } from "./runtime/composition_root.js";
import type { ProductionRuntimeDependencies } from "./runtime/composition_root.js";
import type { Authenticator } from "./principal/authenticator.js";
import { TestAuthenticator } from "./principal/authenticator.js";
import { AuthorityEngine } from "./authority/engine.js";
import { ApprovalService } from "./approval/service.js";
import {
  InMemoryExecutionStore,
  InMemoryAuthorityStore,
  InMemoryIdempotencyStore,
  InMemoryBudgetStore,
  InMemoryEventStore,
} from "./persistence/interfaces.js";

export interface AEPServerOptions {
  artifactsDir?: string;
  defaultTimeoutMs?: number;
  policies?: PolicyDocument[];
  environment?: "test" | "staging" | "production";
  /**
    * @deprecated §184: autoApprove is development-only.
    * In production, use explicit ApprovalService.
    */
  autoApprove?: boolean;
  /**
    * Production composition root dependencies.
    * When provided, the server uses SecureExecutionEngine.
    * When omitted, the server uses development runtime.
    */
  productionDeps?: Partial<ProductionRuntimeDependencies>;
  /**
    * Custom runtime override (for advanced use cases).
    */
  runtime?: ExecutionRuntime;
}

export interface CapabilityDefinition {
  id: string;
  version: string;
  kind: CapabilityContract["kind"];
  description: string;
  input: { schema: object };
  output: { schema: object };
  execution: CapabilityContract["execution"];
  risk: CapabilityContract["risk"];
  authorization?: CapabilityContract["authorization"];
  cost?: CapabilityContract["cost"];
  performance?: CapabilityContract["performance"];
  semantic_class?: string;
  compensation?: string;
  provider?: { id: string; version?: string };
  region?: string;
  examples?: unknown[];
  execute: CapabilityHandler;
}

import type { CapabilityHandler } from "./core/types.js";

export class AEPServer {
  readonly registry = new CapabilityRegistry();
  readonly events = new EventEmitter();
  readonly artifacts: ArtifactManager;
  readonly audit = new AuditEngine();
  readonly policy = new PolicyEngine();
  readonly risk = new RiskEngine();
  readonly authority = new AuthorityEngine();
  readonly approval = new ApprovalService();

  /**
    * §3: The single production runtime.
    * Uses SecureExecutionEngine, NOT the legacy ExecutionEngine.
    */
  private _runtime: ExecutionRuntime | null = null;
  private gateway: HTTPGateway | null = null;
  private opts: AEPServerOptions;
  private _isShuttingDown = false;

  constructor(opts: AEPServerOptions = {}) {
    this.opts = opts;
    this.artifacts = new ArtifactManager({
      rootDir: opts.artifactsDir || join(tmpdir(), "aep-artifacts"),
    });
    if (opts.policies) for (const p of opts.policies) this.policy.loadPolicy(p);

    // §3: Create the runtime via composition root
    if (opts.runtime) {
      this._runtime = opts.runtime;
    } else if (opts.productionDeps) {
      // Production mode — all security deps required
      this._runtime = createProductionRuntime({
        registry: this.registry,
        authenticator: opts.productionDeps.authenticator || new TestAuthenticator(),
        authorityEngine: this.authority,
        policyEngine: this.policy,
        riskEngine: this.risk,
        executionStore: opts.productionDeps.executionStore || new InMemoryExecutionStore(),
        authorityStore: opts.productionDeps.authorityStore || new InMemoryAuthorityStore(),
        idempotencyStore: opts.productionDeps.idempotencyStore || new InMemoryIdempotencyStore(),
        budgetStore: opts.productionDeps.budgetStore || new InMemoryBudgetStore(),
        eventStore: opts.productionDeps.eventStore || new InMemoryEventStore(),
        auditStore: opts.productionDeps.auditStore || {
          append: async (r: any) => this.audit.record(r),
          verify: async () => this.audit.verify(),
          list: async (_filter?: any) => this.audit.list(),
        },
        events: this.events,
        approvalService: opts.productionDeps.approvalService || this.approval,
        productionMode: opts.environment === "production",
        defaultTimeoutMs: opts.defaultTimeoutMs,
      });
    } else {
      // Development mode (default)
      this._runtime = createDevelopmentRuntime(this.registry);
    }
  }

  /**
    * The runtime. This is always SecureExecutionEngine-based.
    */
  get runtime(): ExecutionRuntime {
    if (!this._runtime) {
      throw new Error("Runtime not initialized");
    }
    return this._runtime;
  }

  /**
    * capability.
    */
  capability(def: CapabilityDefinition): this {
    const contract: CapabilityContract = {
      id: def.id,
      version: def.version,
      kind: def.kind,
      description: def.description,
      input: def.input,
      output: def.output,
      execution: def.execution,
      risk: def.risk,
      authorization: def.authorization || { scopes: [] },
      cost: def.cost,
      performance: def.performance,
      semantic_class: def.semantic_class,
      compensation: def.compensation,
      provider: def.provider,
      region: def.region,
      examples: def.examples,
    };
    this.registry.register(contract, { handler: def.execute, provider_id: def.provider?.id || "default" });
    return this;
  }

  /**
    * AEP runtime (SecureExecutionEngine).
    */
  async execute(request: AEPRequest): Promise<AEPResponse> {
    return this.runtime.execute(request);
  }

  /**
    * HTTP gateway.
    */
  async listen(opts: { port?: number; host?: string } = {}): Promise<void> {
    this.gateway = new HTTPGateway({
      executionEngine: this.runtime as any,
      registry: this.registry,
      events: this.events,
      artifacts: this.artifacts,
      audit: this.audit,
      policy: this.policy,
    });
    const port = opts.port || 8080;
    const host = opts.host || "0.0.0.0";
    await this.gateway.listen(port, host);
    console.log(`AEP server listening on http://${host}:${port}`);
    console.log(`  Runtime: ${this.opts.productionDeps ? "production" : "development"} (SecureExecutionEngine)`);
    console.log(`  Discovery: http://${host}:${port}/.well-known/aep`);
    console.log(`  Execute:   POST http://${host}:${port}/aep`);
    console.log(`  Capabilities: ${this.registry.stats().total} registered`);
  }

  /**
    * §90: Graceful shutdown.
    */
  async close(): Promise<void> {
    this._isShuttingDown = true;
    if (this.gateway) await this.gateway.close();
    if (this.runtime?.shutdown) {
      await this.runtime.shutdown();
    }
  }

  /**
    * §142: Health check.
    */
  health(): { live: boolean; ready: boolean } {
    if (this._isShuttingDown) {
      return { live: true, ready: false };
    }
    if (this.runtime?.health) {
      return this.runtime.health();
    }
    return { live: true, ready: true };
  }
}
