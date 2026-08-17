/**
 * HTTP Profile Gateway
 * Reference: spec/002-envelope.md §HTTP Profile
 * 
 * GET  /.well-known/aep                  — discovery metadata
 * POST /aep                              — execute / discover / cancel / resume / subscribe / approve
 * GET  /aep/executions/{id}              — get execution state
 * POST /aep/executions/{id}/cancel       — cancel execution
 * POST /aep/executions/{id}/resume       — resume paused execution
 * POST /aep/approvals/{id}               — submit approval decision
 * GET  /aep/capabilities                  — list capabilities (Level 1)
 * GET  /aep/capabilities/{id}             — get capability contract (Level 2+)
 * GET  /aep/artifacts/{id}                — download artifact
 * POST /aep/events/subscribe             — open SSE stream
 * GET  /aep/events/stream                — SSE event stream
  */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AEPRequest, AEPResponse, DiscoveryQuery } from "../core/types.js";
import type { ExecutionEngine } from "../execution/legacy_engine.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { EventEmitter } from "../events/emitter.js";
import type { ArtifactManager } from "../events/artifacts.js";
import type { AuditEngine } from "../events/audit.js";
import type { PolicyEngine } from "../policy/engine.js";

export interface GatewayOptions {
  executionEngine: ExecutionEngine;
  registry: CapabilityRegistry;
  events?: EventEmitter;
  artifacts?: ArtifactManager;
  audit?: AuditEngine;
  policy?: PolicyEngine;
  port?: number;
  host?: string;
  auth?: (req: IncomingMessage) => { principal: AEPRequest["principal"]; authorized: boolean } | null;
}

const CONTENT_TYPE = "application/aep+json";
const EVENT_CONTENT_TYPE = "application/aep-event+json";

export class HTTPGateway {
  private server: Server | null = null;
  private opts: GatewayOptions;
  private sseClients = new Set<ServerResponse>();

  constructor(opts: GatewayOptions) {
    this.opts = opts;
  }

  listen(port = 8080, host = "0.0.0.0"): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handle(req, res));
      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // CORS
      this.setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET /.well-known/aep
      if (req.method === "GET" && url.pathname === "/.well-known/aep") {
        return this.sendJson(res, 200, this.wellKnown());
      }

      // GET /aep/capabilities
      if (req.method === "GET" && url.pathname === "/aep/capabilities") {
        const level = parseInt(url.searchParams.get("level") || "1", 10) as 1 | 2 | 3 | 4;
        const kind = url.searchParams.get("kind") || undefined;
        const q: DiscoveryQuery = {
          level,
          kind: kind as never,
          limit: parseInt(url.searchParams.get("limit") || "50", 10),
        };
        const items = this.opts.registry.discover(q);
        return this.sendJson(res, 200, { aep: "0.1", capabilities: items });
      }

      // GET /aep/capabilities/{id}
      const capMatch = url.pathname.match(/^\/aep\/capabilities\/(.+)$/);
      if (req.method === "GET" && capMatch) {
        const id = decodeURIComponent(capMatch[1]);
        const items = this.opts.registry.discover({ id, level: 4 });
        if (items.length === 0) return this.sendError(res, 404, "CAPABILITY_NOT_FOUND", "Capability not found");
        return this.sendJson(res, 200, { aep: "0.1", capability: items[0] });
      }

      // GET /aep/executions/{id}
      const execMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)$/);
      if (req.method === "GET" && execMatch) {
        const id = execMatch[1];
        const record = this.opts.executionEngine.get(id);
        if (!record) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found");
        return this.sendJson(res, 200, { aep: "0.1", execution: record });
      }

      // POST /aep/executions/{id}/cancel
      const cancelMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const id = cancelMatch[1];
        const result = await this.opts.executionEngine.cancel(id);
        if (!result) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found");
        return this.sendJson(res, 200, { aep: "0.1", execution: { id, state: result.state } });
      }

      // POST /aep/executions/{id}/resume
      const resumeMatch = url.pathname.match(/^\/aep\/executions\/([^/]+)\/resume$/);
      if (req.method === "POST" && resumeMatch) {
        const id = resumeMatch[1];
        const result = await this.opts.executionEngine.resume(id);
        if (!result) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found");
        return this.sendJson(res, 200, { aep: "0.1", execution: { id, state: result.state } });
      }

      // GET /aep/artifacts/{id}
      const artMatch = url.pathname.match(/^\/aep\/artifacts\/(.+)$/);
      if (req.method === "GET" && artMatch) {
        const id = decodeURIComponent(artMatch[1]);
        if (!this.opts.artifacts) return this.sendError(res, 503, "INTERNAL_ERROR", "Artifact store not configured");
        const data = await this.opts.artifacts.retrieve(id);
        if (!data) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Artifact not found");
        res.writeHead(200, {
          "Content-Type": data.artifact.mime_type,
          "Content-Length": data.artifact.size,
          "X-AEP-Checksum": data.artifact.checksum.value,
        });
        res.end(data.data);
        return;
      }

      // GET /aep/events/stream (SSE)
      if (req.method === "GET" && url.pathname === "/aep/events/stream") {
        return this.handleSSE(req, res);
      }

      // POST /aep (main entry point)
      if (req.method === "POST" && url.pathname === "/aep") {
        const body = await this.readBody(req);
        let request: AEPRequest;
        try {
          request = JSON.parse(body);
        } catch {
          return this.sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body");
        }

        // auth
        if (this.opts.auth) {
          const auth = this.opts.auth(req);
          if (!auth || !auth.authorized) {
            return this.sendError(res, 401, "UNAUTHORIZED", "Authentication failed");
          }
          if (!request.principal && auth.principal) request.principal = auth.principal;
        }

        if (!request.id) request.id = `req_${randomUUID().slice(0, 10)}`;
        if (!request.aep) request.aep = "0.1";

        // route by type
        if (request.type === "execute" || request.type === "discover") {
          const response = await this.opts.executionEngine.execute(request);
          this.opts.audit?.record({
            timestamp: new Date().toISOString(),
            who: request.principal?.id,
            what: request.type,
            capability: request.capability?.id,
            decision: response.status,
            details: { request_id: request.id, execution_id: response.execution?.id },
          });
          return this.sendJson(res, 200, response);
        }

        if (request.type === "cancel") {
          const execId = (request.input as { execution_id?: string })?.execution_id;
          if (!execId) return this.sendError(res, 400, "INVALID_REQUEST", "Missing execution_id in input");
          const result = await this.opts.executionEngine.cancel(execId);
          if (!result) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found");
          return this.sendJson(res, 200, { aep: "0.1", id: request.id, status: "completed", execution: { id: execId, state: result.state } });
        }

        if (request.type === "resume") {
          const execId = (request.input as { execution_id?: string })?.execution_id;
          if (!execId) return this.sendError(res, 400, "INVALID_REQUEST", "Missing execution_id in input");
          const result = await this.opts.executionEngine.resume(execId);
          if (!result) return this.sendError(res, 404, "RESOURCE_NOT_FOUND", "Execution not found");
          return this.sendJson(res, 200, { aep: "0.1", id: request.id, status: "completed", execution: { id: execId, state: result.state } });
        }

        if (request.type === "approve") {
          if (!request.approval) return this.sendError(res, 400, "INVALID_REQUEST", "Missing approval object");
          // TODO: integrate with approval workflow
          return this.sendJson(res, 200, { aep: "0.1", id: request.id, status: "completed", approval: { ...request.approval, decided_by: request.principal?.id, decided_at: new Date().toISOString() } });
        }

        return this.sendError(res, 400, "INVALID_REQUEST", `Unsupported request type: ${request.type}`);
      }

      // 404
      return this.sendError(res, 404, "RESOURCE_NOT_FOUND", `No route for ${req.method} ${url.pathname}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.sendError(res, 500, "INTERNAL_ERROR", message);
    }
  }

  private handleSSE(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(":connected\n\n");

    this.sseClients.add(res);

    const handle = this.opts.events?.subscribe((event) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    _req.on("close", () => {
      this.sseClients.delete(res);
      if (handle && this.opts.events) this.opts.events.unsubscribe(handle);
    });
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AEP-Trace");
    res.setHeader("Access-Control-Expose-Headers", "X-AEP-Checksum");
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": CONTENT_TYPE,
      "Content-Length": Buffer.byteLength(json),
    });
    res.end(json);
  }

  private sendError(res: ServerResponse, httpStatus: number, code: string, message: string): void {
    return this.sendJson(res, httpStatus, {
      aep: "0.1",
      status: "error",
      error: { code, message, retryable: false },
    });
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf-8");
  }

  private wellKnown(): unknown {
    return {
      aep: "0.1",
      server: "@aep/sdk",
      version: "0.1.0",
      endpoints: [
        "POST /aep",
        "GET /aep/capabilities",
        "GET /aep/capabilities/{id}",
        "GET /aep/executions/{id}",
        "POST /aep/executions/{id}/cancel",
        "POST /aep/executions/{id}/resume",
        "GET /aep/artifacts/{id}",
        "GET /aep/events/stream",
      ],
      content_types: [CONTENT_TYPE, EVENT_CONTENT_TYPE],
      stats: {
        capabilities: this.opts.registry.stats(),
        audit: this.opts.audit?.stats(),
        events: this.opts.events?.stats(),
      },
    };
  }
}
