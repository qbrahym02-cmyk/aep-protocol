/**
 * MCP Adapter — Bidirectional bridge between MCP and AEP.
 *
 * FIXES:
 *   FIX 2: callTool() extracts credentials, doesn't accept principal from caller
 *   FIX 11: Use ULID for execution IDs instead of Date.now()
 *   FIX 12: exposeAEPAsMCPTools returns real execution handlers
 *   FIX 13: No `as any` in security boundaries
 */

import type { CapabilityRegistry } from "../../core/registry.js";
import type { ExecutionRuntime } from "../../runtime/types.js";
import { executionId as makeExecutionId } from "../../core/ulid.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Wrap an MCP tool as an AEP capability.
 * The tool gets full AEP governance: authority, policy, risk, approval, etc.
 */
export function wrapMCPToolAsCapability(
  registry: CapabilityRegistry,
  tool: MCPTool,
  opts?: { risk_level?: "low" | "medium" | "high" | "critical"; side_effect?: boolean; scopes?: string[] }
): void {
  registry.register({
    id: `mcp.${tool.name}`,
    version: "1.0.0", kind: "action", description: tool.description,
    input: { schema: tool.inputSchema }, output: { schema: { type: "object" } },
    execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: false, dry_run: false },
    risk: { level: opts?.risk_level || "medium", side_effect: opts?.side_effect ?? true, reversible: opts?.risk_level !== "critical" },
    authorization: { scopes: opts?.scopes || [] },
    provider: { id: "mcp-adapter" },
  }, {
    handler: async ({ input }: { input: unknown }) => ({
      output: await tool.handler(input as Record<string, unknown>)
    }),
    provider_id: "mcp-adapter",
  });
}

/**
 * FIX 12: Expose AEP capabilities as MCP tools with REAL execution handlers.
 * Each tool handler routes through the AEP runtime — not just metadata.
 */
export function exposeAEPAsMCPTools(
  registry: CapabilityRegistry,
  runtime: ExecutionRuntime,
  credentials: { bearer_token?: string; api_key?: string }
): MCPTool[] {
  return registry.discover({ level: 2 }).map((cap) => ({
    name: cap.id,
    description: cap.description,
    inputSchema: cap.contract?.input.schema as { type: "object"; properties: Record<string, unknown> },
    // FIX 12: Real handler that routes through AEP runtime
    handler: async (args: Record<string, unknown>) => {
      const response = await runtime.execute({
        aep: "0.1",
        // FIX 11: Use ULID instead of Date.now() for uniqueness
        id: makeExecutionId(),
        type: "execute",
        capability: { id: cap.id },
        input: args,
        // FIX 2: Credentials come from configuration, not from caller
        authorization: credentials,
      });
      if (response.status === "error") {
        throw new Error(response.error?.message || "AEP execution failed");
      }
      return response.output;
    },
  }));
}

/**
 * FIX 2: MCP Server adapter — credentials are configured, not accepted from caller.
 * The `callTool` method does NOT accept a `principal` parameter.
 * Identity comes from the configured credentials → Authenticator → VerifiedPrincipal.
 */
export function createMCPServerAdapter(opts: {
  runtime: ExecutionRuntime;
  registry: CapabilityRegistry;
  credentials: { bearer_token?: string; api_key?: string };
}) {
  const tools = exposeAEPAsMCPTools(opts.registry, opts.runtime, opts.credentials);

  return {
    name: "aep-mcp-adapter",
    version: "1.0.0",
    tools,

    /**
     * FIX 2: callTool does NOT accept principal from caller.
     * Credentials are configured at adapter creation time.
     */
    async callTool(name: string, args: Record<string, unknown>) {
      // FIX 11: Use ULID for request ID
      const response = await opts.runtime.execute({
        aep: "0.1",
        id: makeExecutionId(),
        type: "execute",
        capability: { id: name },
        input: args,
        authorization: opts.credentials,
      });
      if (response.status === "error") {
        throw new Error(response.error?.message || "AEP execution failed");
      }
      return response.output;
    },

    listTools() {
      return tools.map((t) => ({ name: t.name, description: t.description }));
    },
  };
}
