/**
 * AEP HTTP Client
 * Reference: spec/002-envelope.md §HTTP Profile
  */

import type { AEPRequest, AEPResponse, DiscoveryQuery } from "../core/types.js";

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  defaultTimeoutMs?: number;
  fetch?: typeof fetch;
}

export class AEPClient {
  private opts: ClientOptions;

  constructor(opts: ClientOptions) {
    this.opts = opts;
  }

  /**
    * AEP.
    */
  async send(request: AEPRequest): Promise<AEPResponse> {
    const fetchFn = this.opts.fetch || fetch;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      request.execution?.timeout_ms || this.opts.defaultTimeoutMs || 30_000
    );

    try {
      const res = await fetchFn(`${this.opts.baseUrl}/aep`, {
        method: "POST",
        headers: {
          "Content-Type": "application/aep+json",
          ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const body = await res.json() as AEPResponse;
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
    * Shortcut: capability.
    */
  async execute(capabilityId: string, input: unknown, opts?: {
    version?: string;
    mode?: "sync" | "async" | "streaming";
    idempotency_key?: string;
    dry_run?: boolean;
    timeout_ms?: number;
    budget?: AEPRequest["budget"];
    principal?: AEPRequest["principal"];
  }): Promise<AEPResponse> {
    return this.send({
      aep: "0.1",
      id: `req_${Math.random().toString(36).slice(2, 12)}`,
      type: "execute",
      principal: opts?.principal || { type: "user", id: "unauthenticated" },
      capability: { id: capabilityId, version: opts?.version },
      input,
      execution: {
        mode: opts?.mode || "sync",
        idempotency_key: opts?.idempotency_key,
        dry_run: opts?.dry_run,
        timeout_ms: opts?.timeout_ms,
      },
      budget: opts?.budget,
    });
  }

  /**
    * Discovery.
    */
  async discover(query: DiscoveryQuery = {}): Promise<unknown> {
    const fetchFn = this.opts.fetch || fetch;
    const params = new URLSearchParams();
    if (query.level) params.set("level", String(query.level));
    if (query.kind) params.set("kind", query.kind);
    if (query.limit) params.set("limit", String(query.limit));
    const url = `${this.opts.baseUrl}/aep/capabilities${params.toString() ? "?" + params.toString() : ""}`;
    const res = await fetchFn(url, {
      headers: { ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}) },
    });
    return res.json();
  }

  /**
    * .
    */
  async getExecution(id: string): Promise<unknown> {
    const fetchFn = this.opts.fetch || fetch;
    const res = await fetchFn(`${this.opts.baseUrl}/aep/executions/${id}`, {
      headers: { ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}) },
    });
    return res.json();
  }

  /**
    * .
    */
  async cancel(executionId: string): Promise<unknown> {
    const fetchFn = this.opts.fetch || fetch;
    const res = await fetchFn(`${this.opts.baseUrl}/aep/executions/${executionId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/aep+json" },
    });
    return res.json();
  }

  /**
    * SSE stream .
    * Returns unsubscribe function.
    */
  subscribeEvents(onEvent: (event: unknown) => void, opts?: { filter?: (e: any) => boolean }): () => void {
    // node fetch doesn't natively support SSE — use a simple polling fallback
    // For real SSE in browser, EventSource works directly.
    let active = true;
    const url = `${this.opts.baseUrl}/aep/events/stream`;

    if (typeof EventSource !== "undefined") {
      const es = new EventSource(url);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!opts?.filter || opts.filter(data)) onEvent(data);
        } catch { /* ignore */ }
      };
      return () => { es.close(); active = false; };
    }

    // node fallback: long-poll
    (async () => {
      const fetchFn = this.opts.fetch || fetch;
      while (active) {
        try {
          const res = await fetchFn(url);
          const text = await res.text();
          for (const line of text.split("\n\n")) {
            const m = line.match(/^data: (.+)$/m);
            if (m) {
              try {
                const data = JSON.parse(m[1]);
                if (!opts?.filter || opts.filter(data)) onEvent(data);
              } catch { /* ignore */ }
            }
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();

    return () => { active = false; };
  }
}
