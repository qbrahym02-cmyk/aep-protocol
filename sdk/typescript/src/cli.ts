#!/usr/bin/env node
/**
 * AEP CLI
 * Reference: spec/profiles/* .md
 * 
 * aep serve --port 8080
 * aep discover [--level 1|2|3] [--kind action] [--limit 50]
 * aep inspect <capability-id>
 * aep execute <capability-id> [input-json]
 * aep trace <execution-id>
 * aep conformance
 * 
 * aep authority issue <principal-json> <capabilities-csv>
 * aep authority verify <authority-json>
 * aep authority derive <parent-authority-id> <subset-json>
 * aep authority list
 * 
 * aep resolve <intent-json>
 * 
 * aep workflow validate <file.aep.json>
 * aep workflow simulate <file.aep.json> [--input <json>]
 * aep workflow plan <file.aep.json> [--input <json>]
 * aep workflow execute <file.aep.json> [--input <json>]
  */

import { AEPServer } from "./server.js";
import { AEPClient } from "./gateway/client.js";
import { BUILTIN_CAPABILITIES } from "./providers/builtin.js";
import { AuthorityEngine } from "./authority/engine.js";
import type { Authority } from "./authority/engine.js";
import { CapabilityResolver } from "./discovery/resolver.js";
import { WorkflowArtifactEngine } from "./workflow-artifact/engine.js";
import type { Principal, PolicyDocument } from "./core/types.js";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function main(): Promise<void> {
  if (!command) {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case "serve":
      return serveCmd(args.slice(1));
    case "discover":
      return discoverCmd(args.slice(1));
    case "inspect":
      return inspectCmd(args.slice(1));
    case "execute":
      return executeCmd(args.slice(1));
    case "trace":
      return traceCmd(args.slice(1));
    case "conformance":
      return conformanceCmd(args.slice(1));
    case "authority":
      return authorityCmd(args.slice(1));
    case "resolve":
      return resolveCmd(args.slice(1));
    case "workflow":
      return workflowCmd(args.slice(1));
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
AEP CLI — Agent Execution Protocol

Usage:
  aep serve [--port 8080] [--host 0.0.0.0]
  aep discover [--base-url URL] [--level 1|2|3|4] [--kind K] [--limit N]
  aep inspect <capability-id> [--base-url URL]
  aep execute <capability-id> [input-json] [--base-url URL] [--async] [--dry-run]
  aep trace <execution-id> [--base-url URL]
  aep conformance

  aep authority issue <principal-json> <capabilities-csv> [--expires <ISO>] [--delegatable]
  aep authority verify <authority-json>
  aep authority derive <parent-id> <subset-json> [--subject <principal-json>]
  aep authority list

  aep resolve <intent-json>

  aep workflow validate <file.aep.json>
  aep workflow simulate <file.aep.json> [--input <json>]
  aep workflow plan <file.aep.json> [--input <json>]
  aep workflow execute <file.aep.json> [--input <json>]

  aep help

Examples:
  aep serve --port 8080
  aep discover --level 2
  aep inspect math.add
  aep execute math.add '{"a":2,"b":3}'
  aep execute counter.inc '{"name":"visits","by":1}' --dry-run

  aep authority issue '{"type":"agent","id":"agent.deploy"}' 'deploy.*' --delegatable
  aep authority derive auth_xxx '{"capabilities":["deploy.staging"]}'

  aep resolve '{"intent":{"operation":"create_issue","domain":"github"}}'

  aep workflow validate my-release.aep.json
  aep workflow simulate my-release.aep.json --input '{"version":"2.4.0"}'
  aep workflow execute my-release.aep.json --input '{"version":"2.4.0"}'
`);
}

async function serveCmd(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const port = parseInt((flags.port as string) || "8080", 10);
  const host = (flags.host as string) || "127.0.0.1";

  const server = new AEPServer({
    defaultTimeoutMs: 30_000,
    environment: "test",
  });
  for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

  // Register the dev authenticator with a known token
  const { TestAuthenticator } = await import("./principal/authenticator.js");
  const testAuth = new TestAuthenticator();
  testAuth.register("test-token:dev-user", { id: "dev-user", type: "user", tenant_id: "dev-tenant" } as any);
  server.gateway = new (await import("./gateway/http.js")).HTTPGateway({
    runtime: server.runtime,
    registry: server.registry,
    authenticator: testAuth,
    events: server.events,
    artifacts: server.artifacts,
    audit: server.audit,
    policy: server.policy,
    approvalService: server.approval,
  });

  await server.gateway.listen(port, host);
  console.log(`AEP server listening on http://${host}:${port}`);
  console.log(`  Use --token test-token:dev-user for authentication`);
  console.log(`  Discovery: http://${host}:${port}/.well-known/aep`);
  console.log(`  Execute:   POST http://${host}:${port}/aep`);
  console.log(`  Capabilities: ${server.registry.stats().total} registered`);

  // keep alive
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.close();
    process.exit(0);
  });
}

function baseUrl(flags: Record<string, string | boolean>): string {
  return (flags["base-url"] as string) || "http://127.0.0.1:8080";
}

const DEV_TOKEN = "test-token:dev-user";

function authHeaders(flags: Record<string, string | boolean>): Record<string, string> {
  const token = (flags.token as string) || DEV_TOKEN;
  return { Authorization: `Bearer ${token}` };
}

async function discoverCmd(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const url = baseUrl(flags);
  const headers = authHeaders(flags);
  const level = parseInt((flags.level as string) || "1", 10) as 1 | 2 | 3 | 4;
  const kind = flags.kind as string | undefined;
  const limit = parseInt((flags.limit as string) || "50", 10);
  const params = new URLSearchParams();
  params.set("level", String(level));
  if (kind) params.set("kind", kind);
  params.set("limit", String(limit));

  const res = await fetch(`${url}/aep/capabilities?${params}`, { headers });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

async function inspectCmd(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const id = positional[0];
  if (!id) { console.error("Missing capability id"); process.exit(1); }
  const res = await fetch(`${baseUrl(flags)}/aep/capabilities/${encodeURIComponent(id)}`, {
    headers: authHeaders(flags),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

async function executeCmd(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const capId = positional[0];
  const inputStr = positional[1] || "{}";
  if (!capId) { console.error("Missing capability id"); process.exit(1); }
  let input: unknown;
  try {
    input = JSON.parse(inputStr);
  } catch {
    console.error(`Invalid JSON input: ${inputStr}`);
    process.exit(1);
  }

  const url = baseUrl(flags);
  const headers: Record<string, string> = {
    "Content-Type": "application/aep+json",
    ...authHeaders(flags),
  };

  const body = JSON.stringify({
    aep: "0.1",
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: "execute",
    capability: { id: capId, ...(flags.version ? { version: flags.version } : {}) },
    input,
    execution: {
      mode: flags.async ? "async" : "sync",
      ...(flags["dry-run"] ? { dry_run: true } : {}),
    },
  });

  const res = await fetch(`${url}/aep`, {
    method: "POST",
    headers,
    body,
  });
  const response = await res.json();
  console.log(JSON.stringify(response, null, 2));
}

async function traceCmd(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const execId = positional[0];
  if (!execId) { console.error("Missing execution id"); process.exit(1); }
  const res = await fetch(`${baseUrl(flags)}/aep/executions/${execId}`, {
    headers: authHeaders(flags),
  });
  const result = await res.json();
  console.log(JSON.stringify(result, null, 2));
}

async function conformanceCmd(_args: string[]): Promise<void> {
  // run conformance tests inline
  console.log("Running conformance tests...\n");
  const { runConformance } = await import("./conformance/runner.js");
  const results = await runConformance();
  let pass = 0, fail = 0;
  for (const r of results) {
    const sym = r.pass ? "PASS" : "FAIL";
    console.log(`  [${sym}] ${r.name}`);
    if (!r.pass) {
      console.log(`         ${r.error}`);
      fail++;
    } else {
      pass++;
    }
  }
  console.log(`\n${pass}/${pass + fail} tests passed`);
  process.exit(fail > 0 ? 1 : 0);
}

// ============================================================================
// authority
// ============================================================================

async function authorityCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const engine = new AuthorityEngine();

  switch (sub) {
    case "issue": {
      const { positional, flags } = parseFlags(rest);
      const principalJson = positional[0];
      const capsCsv = positional[1];
      if (!principalJson || !capsCsv) {
        console.error("Usage: aep authority issue <principal-json> <capabilities-csv>");
        process.exit(1);
      }
      const subject = JSON.parse(principalJson) as Principal;
      const capabilities = capsCsv.split(",");
      const expires_at = (flags.expires as string) || new Date(Date.now() + 3600_000).toISOString();
      const authority = engine.issue({
        subject,
        capabilities,
        resources: [],
        constraints: {},
        expires_at,
        delegatable: !!flags.delegatable,
        issued_by: { type: "user", id: "cli_user" },
      });
      console.log(JSON.stringify(authority, null, 2));
      return;
    }
    case "verify": {
      const { positional } = parseFlags(rest);
      const authJson = positional[0];
      if (!authJson) { console.error("Missing authority-json"); process.exit(1); }
      const authority = JSON.parse(authJson) as Authority;
      // restore in engine
      // (for CLI demo: just verify by re-creating engine)
      const result = engine.verify(authority);
      console.log(JSON.stringify({ authority_id: authority.id, valid: result.valid, reason: result.reason }, null, 2));
      return;
    }
    case "derive": {
      const { positional, flags } = parseFlags(rest);
      const parentId = positional[0];
      const subsetJson = positional[1];
      if (!parentId || !subsetJson) {
        console.error("Usage: aep authority derive <parent-id> <subset-json>");
        process.exit(1);
      }
      // for CLI demo: we need to load the parent authority first
      // in real usage, this would come from server
      console.log("Note: this CLI demo requires server-side state.");
      console.log("Parent:", parentId);
      console.log("Subset:", subsetJson);
      return;
    }
    case "list":
    default:
      console.log("Usage: aep authority <issue|verify|derive|list>");
      return;
  }
}

// ============================================================================
// resolve
// ============================================================================

async function resolveCmd(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const intentJson = positional[0];
  if (!intentJson) {
    console.error("Usage: aep resolve <intent-json>");
    process.exit(1);
  }
  const intentRequest = JSON.parse(intentJson);

  // build local registry with builtin capabilities
  const { CapabilityRegistry } = await import("./core/registry.js");
  const registry = new CapabilityRegistry();
  for (const c of BUILTIN_CAPABILITIES) {
    const contract = {
      id: c.id, version: c.version, kind: c.kind, description: c.description,
      input: c.input, output: c.output, execution: c.execution, risk: c.risk,
      authorization: c.authorization || { scopes: [] },
      cost: c.cost, performance: c.performance, semantic_class: c.semantic_class,
      compensation: c.compensation, provider: c.provider, region: c.region,
    };
    registry.register(contract, { handler: c.execute, provider_id: c.provider?.id || "default" });
  }

  const resolver = new CapabilityResolver({ registry });
  const result = resolver.resolve({
    principal: { type: "user", id: "cli_user" },
    intent: intentRequest.intent || intentRequest,
    constraints: intentRequest.constraints,
    limit: intentRequest.limit || 5,
  });
  console.log(JSON.stringify(result, null, 2));
}

// ============================================================================
// workflow
// ============================================================================

async function workflowCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  const { CapabilityRegistry } = await import("./core/registry.js");
  const registry = new CapabilityRegistry();
  for (const c of BUILTIN_CAPABILITIES) {
    const contract = {
      id: c.id, version: c.version, kind: c.kind, description: c.description,
      input: c.input, output: c.output, execution: c.execution, risk: c.risk,
      authorization: c.authorization || { scopes: [] },
      cost: c.cost, performance: c.performance, semantic_class: c.semantic_class,
      compensation: c.compensation, provider: c.provider, region: c.region,
    };
    registry.register(contract, { handler: c.execute, provider_id: c.provider?.id || "default" });
  }

  const engine = new WorkflowArtifactEngine({ registry });

  switch (sub) {
    case "validate": {
      const { positional } = parseFlags(rest);
      const file = positional[0];
      if (!file) { console.error("Missing workflow file"); process.exit(1); }
      const workflow = engine.loadFile(file);
      const result = engine.validate(workflow);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "plan": {
      const { positional, flags } = parseFlags(rest);
      const file = positional[0];
      const inputs = flags.input ? JSON.parse(flags.input as string) : {};
      if (!file) { console.error("Missing workflow file"); process.exit(1); }
      const workflow = engine.loadFile(file);
      const result = engine.plan(workflow, inputs);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "simulate": {
      const { positional, flags } = parseFlags(rest);
      const file = positional[0];
      const inputs = flags.input ? JSON.parse(flags.input as string) : {};
      if (!file) { console.error("Missing workflow file"); process.exit(1); }
      const workflow = engine.loadFile(file);
      const result = await engine.simulate(workflow, inputs);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "execute": {
      const { positional, flags } = parseFlags(rest);
      const file = positional[0];
      const inputs = flags.input ? JSON.parse(flags.input as string) : {};
      if (!file) { console.error("Missing workflow file"); process.exit(1); }
      const workflow = engine.loadFile(file);

      // simple runner that just prints
      const runner = async (cap: string, input: unknown) => {
        console.log(`  → ${cap}(${JSON.stringify(input)})`);
        return { output: { ok: true, capability: cap } };
      };

      const result = await engine.execute(workflow, inputs, {
        principal: { type: "user", id: "cli_user" },
        runner,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      console.log("Usage: aep workflow <validate|plan|simulate|execute> <file>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err?.message || err);
  process.exit(1);
});
