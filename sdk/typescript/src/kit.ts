/**
 * AEP Kit — The simplest way to connect any AI agent to AEP.
 *
 * Usage (3 lines):
 *   import { AEP } from "@aep/kit";
 *   const aep = AEP.quickstart(); // starts a local dev server
 *   const result = await aep.run("math.add", { a: 2, b: 3 });
 *
 * Or with an existing LLM:
 *   const aep = AEP.quickstart();
 *   aep.tool("github.issue.create", { repo: "acme/x", title: "Bug" });
 *   // The agent can call this tool — AEP handles auth, policy, risk, audit automatically.
 *
 * Or in production:
 *   const aep = AEP.production({
 *     server: "https://aep.mycompany.com",
 *     token: process.env.AEP_TOKEN,
 *   });
 *   await aep.run("deploy.production", { version: "2.4" });
 */

import { AEPServer } from "./server.js";
import { AEPClient } from "./gateway/client.js";
import { BUILTIN_CAPABILITIES } from "./providers/builtin.js";
import type { AEPResponse } from "./core/types.js";

// ============================================================================
// AEP Kit — Simple agent interface
// ============================================================================

export class AEP {
  private server: AEPServer | null = null;
  private client: AEPClient | null = null;
  private started = false;

  private constructor() {}

  /**
   * Quickstart — starts a local dev server with built-in capabilities.
   * Zero config. Perfect for development and testing.
   *
   * ```ts
   * const aep = AEP.quickstart();
   * const result = await aep.run("math.add", { a: 2, b: 3 });
   * console.log(result); // { result: 5 }
   * ```
   */
  static quickstart(): AEP {
    const aep = new AEP();
    aep.server = new AEPServer({ environment: "test" });
    for (const cap of BUILTIN_CAPABILITIES) aep.server.capability(cap);
    aep.started = true;
    return aep;
  }

  /**
   * Connect to a remote AEP server (production).
   *
   * ```ts
   * const aep = AEP.production({
   *   server: "https://aep.mycompany.com",
   *   token: process.env.AEP_TOKEN,
   * });
   * ```
   */
  static production(opts: { server: string; token: string }): AEP {
    const aep = new AEP();
    aep.client = new AEPClient({
      baseUrl: opts.server,
      token: opts.token,
      defaultTimeoutMs: 30_000,
    });
    aep.started = true;
    return aep;
  }

  /**
   * Start the HTTP server (for quickstart mode).
   * Optional — you can use `aep.run()` without starting the server.
   */
  async start(port = 8080): Promise<void> {
    if (this.server) {
      await this.server.listen({ port, host: "127.0.0.1" });
      this.client = new AEPClient({ baseUrl: `http://127.0.0.1:${port}` });
    }
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    if (this.server) await this.server.close();
  }

  /**
   * Run a capability. This is the main method agents use.
   *
   * ```ts
   * const result = await aep.run("math.add", { a: 2, b: 3 });
   * ```
   *
   * @param capability The capability ID (e.g. "math.add")
   * @param input The input arguments
   * @returns The output of the capability
   */
  async run(capability: string, input: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.started) throw new Error("AEP not started. Use AEP.quickstart() or AEP.production().");

    let response: AEPResponse;

    if (this.client) {
      // Remote server
      response = await this.client.execute(capability, input, { mode: "sync" });
    } else if (this.server) {
      // Local server (no HTTP)
      response = await this.server.execute({
        aep: "0.1",
        id: `kit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "execute",
        principal: { type: "user", id: "kit-user" },
        authorization: { bearer_token: "test-token:kit-user" },
        capability: { id: capability },
        input,
        execution: { mode: "sync" },
      });
    } else {
      throw new Error("No server or client configured.");
    }

    if (response.status === "error") {
      throw new Error(`AEP Error: ${response.error?.code} — ${response.error?.message}`);
    }
    if (response.status === "approval_required") {
      throw new AEPApprovalRequiredError(response.approval?.approval_id || "", response.approval?.reason || "");
    }

    return response.output;
  }

  /**
   * Try to run a capability (dry run / simulation).
   * Returns what WOULD happen without actually doing it.
   *
   * ```ts
   * const preview = await aep.try("deploy.production", { version: "2.4" });
   * console.log(preview); // { would_change: true, estimated_cost: 0.05 }
   * ```
   */
  async try(capability: string, input: Record<string, unknown> = {}): Promise<unknown> {
    if (this.server) {
      const response = await this.server.execute({
        aep: "0.1",
        id: `kit_try_${Date.now()}`,
        type: "execute",
        principal: { type: "user", id: "kit-user" },
        authorization: { bearer_token: "test-token:kit-user" },
        capability: { id: capability },
        input,
        execution: { mode: "sync", dry_run: true },
      });
      return response.output;
    }
    if (this.client) {
      const response = await this.client.execute(capability, input, { dry_run: true });
      return response.output;
    }
    throw new Error("No server or client configured.");
  }

  /**
   * Register a custom capability (tool) that your agent can call.
   *
   * ```ts
   * aep.tool("my.sendEmail", {
   *   description: "Send an email",
   *   input: { to: "string", subject: "string", body: "string" },
   * }, async ({ to, subject, body }: Record<string, unknown>) => {
   *   // Your email sending logic here
   *   return { sent: true, to };
   * });
   *
   * // Now the agent can call it:
   * const result = await aep.run("my.sendEmail", { to: "bob@x.com", subject: "Hi", body: "Hello" });
   * ```
   */
  tool(
    id: string,
    opts: {
      description: string;
      input: Record<string, string>;
      side_effect?: boolean;
      risk?: "low" | "medium" | "high" | "critical";
    },
    handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  ): void {
    if (!this.server) throw new Error("tool() is only available in quickstart mode. Use AEP.production() to connect to a remote server.");

    // Build JSON Schema from simple type map
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, type] of Object.entries(opts.input)) {
      properties[key] = { type };
      required.push(key);
    }

    this.server.capability({
      id,
      version: "1.0.0",
      kind: opts.side_effect ? "action" : "read",
      description: opts.description,
      input: { schema: { type: "object", required, properties } },
      output: { schema: { type: "object" } },
      execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: false, dry_run: !!opts.side_effect },
      risk: {
        level: opts.risk || (opts.side_effect ? "medium" : "low"),
        side_effect: opts.side_effect ?? false,
        reversible: opts.risk !== "critical",
      },
      authorization: { scopes: [] },
      execute: async ({ input }) => {
        const result = await handler(input as Record<string, unknown>);
        return { output: result };
      },
    });
  }

  /**
   * List all available capabilities.
   *
   * ```ts
   * const tools = await aep.tools();
   * console.log(tools); // ["math.add", "echo.ping", "my.sendEmail", ...]
   * ```
   */
  async tools(): Promise<string[]> {
    if (this.server) {
      return this.server.registry.discover({ level: 1 }).map((c: { id: string }) => c.id);
    }
    if (this.client) {
      const result = await this.client.discover({ level: 1, limit: 100 }) as { capabilities?: Array<{ id: string }> };
      return (result.capabilities || []).map((c: { id: string }) => c.id);
    }
    return [];
  }

  /**
   * Get info about a capability.
   *
   * ```ts
   * const info = await aep.info("math.add");
   * console.log(info);
   * // { id: "math.add", description: "Add two numbers", kind: "action", ... }
   * ```
   */
  async info(capability: string): Promise<unknown> {
    if (this.server) {
      const items = this.server.registry.discover({ id: capability, level: 4 });
      return items[0] || null;
    }
    if (this.client) {
      const response = await fetch(`${this.client["opts"].baseUrl}/aep/capabilities/${capability}`);
      return response.json();
    }
    return null;
  }
}

// ============================================================================
// Custom error for approval flow
// ============================================================================

export class AEPApprovalRequiredError extends Error {
  constructor(public approvalId: string, public reason: string) {
    super(`Approval required: ${reason} (ID: ${approvalId})`);
    this.name = "AEPApprovalRequiredError";
  }
}

// ============================================================================
// LLM Integration Helpers
// ============================================================================

/**
 * Convert AEP capabilities to OpenAI function-calling format.
 *
 * ```ts
 * const aep = AEP.quickstart();
 * aep.tool("sendEmail", { ... }, async (input) => { ... });
 *
 * const functions = aep.toOpenAIFunctions();
 * // Pass to OpenAI:
 * // const response = await openai.chat.completions.create({
 * //   model: "gpt-4",
 * //   messages: [...],
 * //   functions,
 * // });
 * ```
 */
export function toOpenAIFunctions(aep: AEP): unknown[] {
  // This would need to be called after server is set up
  // For now, return a placeholder that agents can use
  return [];
}

/**
 * Create a LangChain-compatible tool wrapper.
 *
 * ```ts * const aep = AEP.quickstart();
 * aep.tool("search", { ... }, async (input) => { ... });
 *
 * const langchainTool = aepToLangChain(aep, "search");
 * // Use with LangChain agent
 * ```
 */
export function aepToLangChain(aep: AEP, capability: string): unknown {
  return {
    name: capability,
    description: `AEP-governed capability: ${capability}`,
    _call: async (input: Record<string, unknown>) => {
      return JSON.stringify(await aep.run(capability, input));
    },
  };
}
