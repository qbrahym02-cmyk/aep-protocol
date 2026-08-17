/**
 * Provider SDK — Build AEP providers easily.
 */

import type { CapabilityRegistry } from "../../core/registry.js";

export interface AEPProviderDefinition {
  id: string;
  name: string;
  capabilities: Array<{
    id: string; version: string; kind: string; description: string;
    input_schema: object; output_schema: object;
    risk_level: "low" | "medium" | "high" | "critical";
    side_effect: boolean;
    handler: (input: unknown) => Promise<unknown>;
  }>;
}

export function registerProvider(registry: CapabilityRegistry, provider: AEPProviderDefinition): void {
  for (const cap of provider.capabilities) {
    registry.register({
      id: cap.id, version: cap.version, kind: cap.kind as any, description: cap.description,
      input: { schema: cap.input_schema }, output: { schema: cap.output_schema },
      execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: cap.risk_level !== "critical", dry_run: true },
      risk: { level: cap.risk_level, side_effect: cap.side_effect, reversible: cap.risk_level !== "critical" },
      authorization: { scopes: [`${cap.id}.execute`] },
      provider: { id: provider.id },
    } as any, { handler: async ({ input }: { input: unknown }) => ({ output: await cap.handler(input) }), provider_id: provider.id });
  }
}

// ============================================================================
// Built-in provider definitions
// ============================================================================

export const GITHUB_PROVIDER: AEPProviderDefinition = {
  id: "github", name: "GitHub Provider",
  capabilities: [
    {
      id: "github.repo.list", version: "1.0.0", kind: "read", description: "List repositories for a user/org",
      input_schema: { type: "object", properties: { org: { type: "string" } } },
      output_schema: { type: "object", properties: { repos: { type: "array" } } },
      risk_level: "low", side_effect: false,
      handler: async (input) => ({ repos: [] }),
    },
    {
      id: "github.issue.create", version: "1.0.0", kind: "action", description: "Create a GitHub issue",
      input_schema: { type: "object", required: ["repo", "title"], properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } } },
      output_schema: { type: "object", properties: { number: { type: "integer" }, url: { type: "string" } } },
      risk_level: "medium", side_effect: true,
      handler: async (input) => ({ number: 1, url: "https://github.com/test/test/issues/1" }),
    },
  ],
};

export const STRIPE_PROVIDER: AEPProviderDefinition = {
  id: "stripe", name: "Stripe Provider",
  capabilities: [
    {
      id: "stripe.payment.charge", version: "1.0.0", kind: "action", description: "Charge a payment method",
      input_schema: { type: "object", required: ["amount", "currency"], properties: { amount: { type: "number" }, currency: { type: "string" }, customer: { type: "string" } } },
      output_schema: { type: "object", properties: { transaction_id: { type: "string" }, status: { type: "string" } } },
      risk_level: "critical", side_effect: true,
      handler: async (input) => ({ transaction_id: "txn_test", status: "succeeded" }),
    },
  ],
};

export const SLACK_PROVIDER: AEPProviderDefinition = {
  id: "slack", name: "Slack Provider",
  capabilities: [
    {
      id: "slack.message.send", version: "1.0.0", kind: "action", description: "Send a Slack message",
      input_schema: { type: "object", required: ["channel", "text"], properties: { channel: { type: "string" }, text: { type: "string" } } },
      output_schema: { type: "object", properties: { ok: { type: "boolean" }, ts: { type: "string" } } },
      risk_level: "medium", side_effect: true,
      handler: async (input) => ({ ok: true, ts: "1234567890.123" }),
    },
  ],
};

export const POSTGRES_PROVIDER: AEPProviderDefinition = {
  id: "postgres", name: "PostgreSQL Provider",
  capabilities: [
    {
      id: "postgres.query", version: "1.0.0", kind: "query", description: "Execute a SQL query (read-only)",
      input_schema: { type: "object", required: ["sql"], properties: { sql: { type: "string" }, params: { type: "array" } } },
      output_schema: { type: "object", properties: { rows: { type: "array" }, rowCount: { type: "integer" } } },
      risk_level: "medium", side_effect: false,
      handler: async (input) => ({ rows: [], rowCount: 0 }),
    },
  ],
};
