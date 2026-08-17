/**
 * Built-in capabilities — capabilities 
 * Reference: spec/003-capabilities.md
 * 
 * :
 * - math.add / math.multiply (Tests)
 * - echo.ping ()
 * - text.transform ()
 * - counter.inc (counter stateful demo)
  */

import type { CapabilityDefinition } from "../server.js";
import type { ExecutionResult } from "../core/types.js";

export const mathAdd: CapabilityDefinition = {
  id: "math.add",
  version: "1.0.0",
  kind: "action",
  description: "Add two numbers",
  input: {
    schema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: { type: "number", description: "First operand" },
        b: { type: "number", description: "Second operand" },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["result"],
      properties: { result: { type: "number" } },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  cost: { currency: "USD", estimated: 0 },
  performance: { p50_ms: 1, p95_ms: 5 },
  execute: async ({ input }) => {
    const { a, b } = input as { a: number; b: number };
    return { output: { result: a + b } };
  },
};

export const mathMultiply: CapabilityDefinition = {
  id: "math.multiply",
  version: "1.0.0",
  kind: "action",
  description: "Multiply two numbers",
  input: {
    schema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["result"],
      properties: { result: { type: "number" } },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }) => {
    const { a, b } = input as { a: number; b: number };
    return { output: { result: a * b } };
  },
};

export const echoPing: CapabilityDefinition = {
  id: "echo.ping",
  version: "1.0.0",
  kind: "read",
  description: "Echo back the input — useful for health check",
  input: {
    schema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["pong"],
      properties: {
        pong: { type: "string" },
        timestamp: { type: "string" },
      },
    },
  },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }) => {
    const { message = "ping" } = (input as { message?: string }) || {};
    return { output: { pong: message, timestamp: new Date().toISOString() } };
  },
};

export const textTransform: CapabilityDefinition = {
  id: "text.transform",
  version: "1.0.0",
  kind: "transform",
  description: "Transform text: uppercase, lowercase, reverse, base64",
  input: {
    schema: {
      type: "object",
      required: ["text", "op"],
      properties: {
        text: { type: "string" },
        op: { type: "string", enum: ["uppercase", "lowercase", "reverse", "base64"] },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["result"],
      properties: { result: { type: "string" } },
    },
  },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: true },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input, dry_run }) => {
    const { text, op } = input as { text: string; op: string };
    if (dry_run) return { output: { result: `<dry_run:${op}>`, original: text } };
    let result = text;
    switch (op) {
      case "uppercase": result = text.toUpperCase(); break;
      case "lowercase": result = text.toLowerCase(); break;
      case "reverse": result = text.split("").reverse().join(""); break;
      case "base64": result = Buffer.from(text).toString("base64"); break;
    }
    return { output: { result } };
  },
};

/**
 * Counter with side effect (stateful).
  */
const counters = new Map<string, number>();

export const counterInc: CapabilityDefinition = {
  id: "counter.inc",
  version: "1.0.0",
  kind: "action",
  description: "Increment a named counter (stateful). Supports dry_run to preview without commit.",
  input: {
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Counter identifier" },
        by: { type: "integer", minimum: 1, default: 1 },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "integer" } },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: false, retry: true, idempotent: false, dry_run: true },
  risk: { level: "low", side_effect: true, reversible: true, blast_radius: "single_record" },
  authorization: { scopes: ["counter.write"] },
  compensation: "counter.dec",
  execute: async ({ input, dry_run }) => {
    const { name, by = 1 } = input as { name: string; by?: number };
    const current = counters.get(name) || 0;
    if (dry_run) return { output: { value: current + by, would_change: by } };
    const next = current + by;
    counters.set(name, next);
    return { output: { value: next }, cost_usd: 0.0001 };
  },
};

export const counterGet: CapabilityDefinition = {
  id: "counter.get",
  version: "1.0.0",
  kind: "read",
  description: "Get current counter value",
  input: {
    schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "integer" } },
    },
  },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }) => {
    const { name } = input as { name: string };
    return { output: { value: counters.get(name) || 0 } };
  },
};

/**
 * Build capability with equivalence class — used in conformance tests.
  */
export const githubIssueCreate: CapabilityDefinition = {
  id: "github.issue.create",
  version: "1.0.0",
  kind: "action",
  description: "Create an issue in a GitHub repository (mock)",
  input: {
    schema: {
      type: "object",
      required: ["repository", "title"],
      properties: {
        repository: { type: "string", description: "owner/repo" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["number", "url"],
      properties: {
        number: { type: "integer" },
        url: { type: "string" },
      },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: true, dry_run: true },
  risk: { level: "medium", side_effect: true, reversible: true, impact: "operational", blast_radius: "single_record" },
  authorization: { scopes: ["github.issue.write"] },
  cost: { currency: "USD", estimated: 0.001 },
  performance: { p50_ms: 400, p95_ms: 1500 },
  semantic_class: "issue.creation",
  compensation: "github.issue.close",
  provider: { id: "github" },
  execute: async ({ input, dry_run }) => {
    const { repository, title } = input as { repository: string; title: string };
    const number = Math.floor(Math.random() * 10000) + 1;
    if (dry_run) {
      return { output: { number, url: `https://github.com/${repository}/issues/${number}`, would_change: true } };
    }
    return {
      output: { number, url: `https://github.com/${repository}/issues/${number}` },
      cost_usd: 0.001,
    };
  },
};

export const linearIssueCreate: CapabilityDefinition = {
  id: "linear.issue.create",
  version: "1.0.0",
  kind: "action",
  description: "Create an issue in Linear (mock) — equivalent to github.issue.create",
  input: {
    schema: {
      type: "object",
      required: ["team", "title"],
      properties: {
        team: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["id", "url"],
      properties: {
        id: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: true, dry_run: true },
  risk: { level: "medium", side_effect: true, reversible: true, impact: "operational", blast_radius: "single_record" },
  authorization: { scopes: ["linear.issue.write"] },
  semantic_class: "issue.creation",
  provider: { id: "linear" },
  execute: async ({ input }) => {
    const { team, title } = input as { team: string; title: string };
    const id = `LIN-${Math.floor(Math.random() * 10000)}`;
    return { output: { id, url: `https://linear.app/${team}/issue/${id}` } };
  },
};

/**
 * High-risk capability for testing policy/risk engines.
  */
export const paymentCharge: CapabilityDefinition = {
  id: "payment.charge",
  version: "1.0.0",
  kind: "action",
  description: "Charge a payment method — high risk",
  input: {
    schema: {
      type: "object",
      required: ["amount", "currency"],
      properties: {
        amount: { type: "number", minimum: 0 },
        currency: { type: "string" },
        customer_id: { type: "string" },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["transaction_id"],
      properties: {
        transaction_id: { type: "string" },
        status: { type: "string", enum: ["succeeded", "pending", "failed"] },
      },
    },
  },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: false, idempotent: true, dry_run: true },
  risk: {
    level: "critical",
    side_effect: true,
    reversible: false,
    impact: "financial",
    blast_radius: "account",
    data_sensitivity: "restricted",
  },
  authorization: { scopes: ["payment.write"], require_approval: "on_high_risk", require_strong_auth: true },
  cost: { currency: "USD", estimated: 0.029 },
  semantic_class: "payment.charge",
  provider: { id: "stripe" },
  execute: async ({ input, dry_run }) => {
    const { amount, currency, customer_id } = input as { amount: number; currency: string; customer_id?: string };
    if (dry_run) {
      return { output: { transaction_id: "dry_run", status: "pending", estimated_cost: 0.029 } };
    }
    return {
      output: {
        transaction_id: `txn_${Math.random().toString(36).slice(2, 12)}`,
        status: "succeeded",
        amount,
        currency,
        customer_id,
      },
      cost_usd: 0.029,
    };
  },
};

export const BUILTIN_CAPABILITIES: CapabilityDefinition[] = [
  mathAdd,
  mathMultiply,
  echoPing,
  textTransform,
  counterInc,
  counterGet,
  githubIssueCreate,
  linearIssueCreate,
  paymentCharge,
];
