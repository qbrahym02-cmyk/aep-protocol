/**
 * MCP Adapter — Bidirectional bridge between MCP and AEP.
 * 
 * Direction 1: MCP tools → AEP capabilities (gives MCP tools governance)
 * Direction 2: AEP capabilities → MCP server (exposes AEP to MCP clients)
 */

import type { CapabilityRegistry } from "../../core/registry.js";
import type { ExecutionRuntime } from "../../runtime/types.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

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
  } as any, { handler: async ({ input }: { input: unknown }) => ({ output: await tool.handler(input as Record<string, unknown>) }), provider_id: "mcp-adapter" });
}

export function exposeAEPAsMCPTools(registry: CapabilityRegistry): MCPTool[] {
  return registry.discover({ level: 2 }).map((cap) => ({
    name: cap.id, description: cap.description,
    inputSchema: cap.contract?.input.schema as { type: "object"; properties: Record<string, unknown> },
    handler: async () => ({ aep_governed: true, capability: cap.id, risk_level: cap.risk_level }),
  }));
}

export function createMCPServerAdapter(opts: { runtime: ExecutionRuntime; registry: CapabilityRegistry }) {
  const tools = exposeAEPAsMCPTools(opts.registry);
  return {
    name: "aep-mcp-adapter", version: "1.0.0", tools,
    async callTool(name: string, args: Record<string, unknown>, principal?: { type: string; id: string }) {
      const response = await opts.runtime.execute({ aep: "0.1", id: `mcp_${Date.now()}`, type: "execute", principal: principal as any, capability: { id: name }, input: args } as any);
      if (response.status === "error") throw new Error(response.error?.message || "AEP failed");
      return response.output;
    },
    listTools() { return tools.map((t) => ({ name: t.name, description: t.description })); },
  };
}
