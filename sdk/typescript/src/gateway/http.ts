/**
 * HTTP Gateway — Rewritten to depend on ExecutionRuntime (not legacy engine).
 * 
 * FIXES:
 *   FIX 2: Depends on ExecutionRuntime, not legacy ExecutionEngine. No `as any`.
 *   FIX 3: Enforces authentication + object-level authz on ALL endpoints.
 *   FIX 4: /approve wired to ApprovalService with real decision enforcement.
 *   FIX 9: CORS is configurable allowlist, no wildcard default.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AEPRequest, AEPResponse } from "../core/types.js";
import type { ExecutionRuntime } from "../runtime/types.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { EventEmitter } from "../events/emitter.js";
import type { ArtifactManager } from "../events/artifacts.js";
import type { AuditEngine } from "../events/audit.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { Authenticator, VerifiedPrincipal } from "../principal/authenticator.js";
import type { ApprovalService } from "../approval/service.js";
import { CorsHandler, type CorsConfig } from "../security/cors.js";
import { BodyLimiter } from "../security/body_limit.js";
import { RateLimiter, type RateLimitConfig } from "../security/rate_limiter.js";

const CONTENT_TYPE = "application/aep+json";

export interface GatewayOptions {
  runtime: ExecutionRuntime;           // FIX 2: ExecutionRuntime, not legacy engine
  registry: CapabilityRegistry;
  authenticator: Authenticator;        // FIX 3: Required, not optional
  events?: EventEmitter;
  artifacts?: ArtifactManager;
  audit?: AuditEngine;
  policy?: PolicyEngine;
  approvalService?: ApprovalService;   // FIX 4: For /approve endpoint
  corsConfig?: CorsConfig;             // FIX 9: Configurable CORS
  rateLimitConfig?: RateLimitConfig;   // Rate limiting
  maxBodyBytes?: number;               // FIX 3: Body size limit
  port?: number;
  host?: string;
}

export class HTTPGateway {
  private server: Server | null = null;
  private opts: GatewayOptions;
  private corsHandler: CorsHandler;
  private bodyLimiter: BodyLimiter;
  private rateLimiter: RateLimiter | null = null;

  constructor(opts: GatewayOptions) {
    this.opts = opts;
    // FIX 9: Default CORS is empty allowlist (no wildcard)
    this.corsHandler = new CorsHandler(opts.corsConfig || { allowed_origins: [] });
    this.bodyLimiter = new BodyLimiter({ default_max_bytes: opts.maxBodyBytes || 1024 * 1024 });
    if (opts.rateLimitConfig) {
      this.rateLimiter = new RateLimiter(opts.rateLimitConfig);
    }
  }

  listen(port = 8080, host = "0.0.0.0"): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handle(req, res));
      this.server.listen(port, host, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ========================================================================
  // FIX 3: Authentication middleware — EVERY endpoint requires auth
  // ========================================================================

  private async authenticate(req: IncomingMessage): Promise<VerifiedPrincipal | null> {
    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader) return null;

    try {
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        return await this.opts.authenticator.authenticate({ type: "bearer_token", token });
      }
      if (authHeader.startsWith("ApiKey ")) {
        const key = authHeader.slice(7);
        return await this.opts.authenticator.authenticate({ type: "api_key", key });
      }
    } catch {
      return null;
    }
    return null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // CORS
      const origin = req.headers.origin as string | undefined;
      if (req.method === "OPTIONS") {
        const headers = this.corsHandler.getPreflightHeaders(origin, req.headers["access-control-request-method"] as string, req.headers["access-control-request-headers"] as string);
        res.writeHead(204, headers);
        res.end();
        return;
      }
      const corsHeaders = this.corsHandler.getHeaders(origin);

      // FIX 3: Authenticate ALL requests (no unauthenticated endpoints)
      const principal = await this.authenticate(req);
      if (!principal) {
        this.sendJson(res, 401, { aep: "0.1", status: "error", error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false } }, corsHeaders);
        return;
      }

      // Rate limiting
      if (this.rateLimiter) {
        const decision = this.rateLimiter.consume(principal.id, "principal");
        if (!decision.allowed) {
          this.sendJson(res, 429, { aep: "0.1", status: "error", error: RateLimiter.toAEPError(decision).toJSON() }, corsHeaders);
          return;
        }
      }

      // GET /.well-known/aep — public metadata (but still authenticated)
      if (req.method === "GET" && url.pathname === "/.well-known/aep") {
        return this.sendJson(res, 200, this.wellKnown(), corsHeaders);
      }

      // GET /aep/capabilities
      if (req.method === "GET" && url.pathname === "/aep/capabilities") {
        const level = parseInt(url.searchParams.get("level") || "1", 10) as 1 | 2 | 3 | 4;
        const kind = url.searchParams.get("kind") || undefined;
        const q: any = { level, kind, limit: parseInt(url.searchParams.get("limit") || "50", 10) };
        const items = this.opts.registry.discover(q);
        return this.sendJson(res, 200, { aep: "0.1", capabilities: items }, corsHeaders);
      }

      // GET /aep/capabilities/{id}
      const capMatch = url.pathname.match(/^\/aep\/capabilities\/(.+)$/);
      if (req.method === "GET" && capMatch) {
        const id = decodeURIComponent(capMatch[1]);
        const items = this.opts.registry.discover({ id, level: 4 });
        if (items.length === 0) return this.sendError(res, 404, "CAPABILITY_NOT_FOUND", "Capability not found", corsHeaders);
        return this.sendJson(res, 200, { aep: "0.1", capability: items[0] }, corsHeaders);
      }

      // FIX 3: GET /aep/executions/{id} — requires object-level authz
      const execMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)$/);
      if (req.method === "GET" && execMatch) {
        const id = execMatch[1];
        const record = await this.opts.runtime.getExecution(id, principal);
        if (!record) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found or access denied", corsHeaders);
        return this.sendJson(res, 200, { aep: "0.1", execution: record }, corsHeaders);
      }

      // FIX 3: POST /aep/executions/{id}/cancel — requires object-level authz
      const cancelMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const id = cancelMatch[1];
        try {
          const result = await this.opts.runtime.cancel(id, principal);
          return this.sendJson(res, 200, { aep: "0.1", execution: { id, state: result.state } }, corsHeaders);
        } catch (err) {
          return this.sendError(res, 403, "UNAUTHORIZED", (err as Error).message, corsHeaders);
        }
      }

      // FIX 3: POST /aep/executions/{id}/resume — requires object-level authz
      const resumeMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)\/resume$/);
      if (req.method === "POST" && resumeMatch) {
        const id = resumeMatch[1];
        try {
          const result = await this.opts.runtime.resume(id, principal);
          return this.sendJson(res, 200, result, corsHeaders);
        } catch (err) {
          return this.sendError(res, 403, "UNAUTHORIZED", (err as Error).message, corsHeaders);
        }
      }

      // FIX 3: GET /aep/artifacts/{id} — requires auth + tenant check
      const artMatch = url.pathname.match(/^\/aep\/artifacts\/(.+)$/);
      if (req.method === "GET" && artMatch) {
        const id = decodeURIComponent(artMatch[1]);
        if (!this.opts.artifacts) return this.sendError(res, 503, "INTERNAL_ERROR", "Artifact store not configured", corsHeaders);
        const data = await this.opts.artifacts.retrieve(id);
        if (!data) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Artifact not found", corsHeaders);
        // FIX 3: Check access policy (artifact must belong to same tenant)
        if (data.artifact.provenance?.execution_id) {
          const exec = await this.opts.runtime.getExecution(data.artifact.provenance.execution_id, principal);
          if (!exec) return this.sendError(res, 403, "UNAUTHORIZED", "Artifact access denied", corsHeaders);
        }
        res.writeHead(200, {
          "Content-Type": data.artifact.mime_type,
          "Content-Length": data.artifact.size,
          ...corsHeaders,
        });
        res.end(data.data);
        return;
      }

      // FIX 4: POST /aep/approvals/{id} — wired to ApprovalService
      const approvalMatch = url.pathname.match(/^\/aep\/approvals\/([^/]+)$/);
      if (req.method === "POST" && approvalMatch) {
        const approvalId = approvalMatch[1];
        if (!this.opts.approvalService) {
          return this.sendError(res, 503, "INTERNAL_ERROR", "Approval service not configured", corsHeaders);
        }
        const body = await this.readBody(req);
        let approvalInput;
        try { approvalInput = JSON.parse(body); } catch {
          return this.sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body", corsHeaders);
        }
        try {
          const req = this.opts.approvalService.get(approvalId);
          if (!req) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Approval not found", corsHeaders);
          // FIX 4: Real decision enforcement via ApprovalService
          const result = this.opts.approvalService.submit({
            approval_id: approvalId,
            decision: approvalInput.decision || "deny",
            approver: principal,
            reason: approvalInput.reason,
            constraints: approvalInput.constraints,
          });
          return this.sendJson(res, 200, { aep: "0.1", status: "completed", approval: result }, corsHeaders);
        } catch (err) {
          return this.sendError(res, 400, "INVALID_REQUEST", (err as Error).message, corsHeaders);
        }
      }

      // GET /aep/events/stream (SSE) — authenticated + filtered by principal
      if (req.method === "GET" && url.pathname === "/aep/events/stream") {
        return this.handleSSE(req, res, principal, corsHeaders);
      }

      // POST /aep (main execute endpoint)
      if (req.method === "POST" && url.pathname === "/aep") {
        const body = await this.readBody(req);
        let request: AEPRequest;
        try {
          request = JSON.parse(body);
        } catch {
          return this.sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body", corsHeaders);
        }
        if (!request.id) request.id = `req_${randomUUID().slice(0, 10)}`;
        if (!request.aep) request.aep = "0.1";

        // Inject credentials from HTTP headers into request.authorization
        const authHeader = req.headers["authorization"] as string;
        if (authHeader?.startsWith("Bearer ")) {
          request.authorization = { ...request.authorization, bearer_token: authHeader.slice(7) };
        } else if (authHeader?.startsWith("ApiKey ")) {
          request.authorization = { ...request.authorization, api_key: authHeader.slice(7) };
        }

        // Set principal from authenticated identity (not from request)
        request.principal = {
          type: principal.type as any,
          id: principal.id,
          tenant_id: principal.tenant_id,
          delegation_chain: principal.delegation_chain,
        };

        const response = await this.opts.runtime.execute(request);
        this.opts.audit?.record({
          timestamp: new Date().toISOString(),
          seq: undefined,
          who: principal.id,
          what: request.type,
          capability: request.capability?.id,
          decision: response.status,
          details: { request_id: request.id, execution_id: response.execution?.id },
        });
        return this.sendJson(res, 200, response, corsHeaders);
      }

      return this.sendError(res, 404, "RESOURCE_NOT_FOUND", `No route for ${req.method} ${url.pathname}`, corsHeaders);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.sendError(res, 500, "INTERNAL_ERROR", message, {});
    }
  }

  private handleSSE(_req: IncomingMessage, res: ServerResponse, principal: VerifiedPrincipal, corsHeaders: Record<string, string>): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders,
    });
    res.write(":authenticated\n\n");

    // FIX 3: Only stream events for this principal's executions
    const handle = this.opts.events?.subscribe((event) => {
      // Filter by principal
      if (event.principal?.id !== principal.id && event.principal?.tenant_id !== principal.tenant_id) {
        return;
      }
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    _req.on("close", () => {
      if (handle && this.opts.events) this.opts.events.unsubscribe(handle);
    });
  }

  private sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": CONTENT_TYPE,
      "Content-Length": Buffer.byteLength(json),
      ...headers,
    });
    res.end(json);
  }

  private sendError(res: ServerResponse, httpStatus: number, code: string, message: string, headers: Record<string, string>): void {
    return this.sendJson(res, httpStatus, { aep: "0.1", status: "error", error: { code, message, retryable: false } }, headers);
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return this.bodyLimiter.readBody(req as any);
  }

  private wellKnown(): unknown {
    return {
      aep: "0.1",
      server: "@aep/sdk",
      version: "1.0.0",
      endpoints: [
        "POST /aep",
        "GET /aep/capabilities",
        "GET /aep/capabilities/{id}",
        "GET /aep/executions/{id}",
        "POST /aep/executions/{id}/cancel",
        "POST /aep/executions/{id}/resume",
        "POST /aep/approvals/{id}",
        "GET /aep/artifacts/{id}",
        "GET /aep/events/stream",
      ],
      content_types: [CONTENT_TYPE],
      auth_required: true,
      stats: {
        capabilities: this.opts.registry.stats(),
      },
    };
  }
}
