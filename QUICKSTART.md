# AEP Quickstart

## Prerequisites

- Node.js 22+ (for TypeScript SDK)
- Python 3.10+ (for Python SDK, optional)
- Docker (for containerized deployment)

## Option 1: Docker (Recommended)

```bash
git clone https://github.com/qbrahym02-cmyk/aep-protocol.git
cd aep-protocol

# Start AEP server
docker compose up -d

# Verify it's running
curl http://localhost:8080/.well-known/aep
```

## Option 2: Local Development

```bash
git clone https://github.com/qbrahym02-cmyk/aep-protocol.git
cd aep-protocol/sdk/typescript

npm install
npm run build

# Run conformance tests
npx tsx src/cli.ts conformance

# Start the server
npx tsx src/cli.ts serve --port 8080
```

## Your First Execution

```bash
# Discover capabilities
curl http://localhost:8080/aep/capabilities | jq

# Execute a capability
npx tsx src/cli.ts execute math.add '{"a":2,"b":3}'
```

## The Hero Demo: Governed Production Deployment

This demo shows why AEP exists — an AI agent proposes a deployment, AEP enforces governance.

```bash
cd sdk/typescript

# Run the demo
npx tsx examples/governed-deployment-demo.ts
```

The demo walks through:
1. AI proposes "Deploy version 2.4 to production"
2. AEP authenticates the agent
3. AEP verifies authority
4. Policy engine evaluates
5. Risk = HIGH
6. Human approval required
7. Approval granted
8. Budget reserved
9. Execution (mock deployment)
10. Cryptographic receipt generated
11. Audit chain updated

## Define Your Own Capability

```typescript
import { AEPServer } from "@aep/sdk";

const server = new AEPServer();

server.capability({
  id: "my.capability",
  version: "1.0.0",
  kind: "action",
  description: "My custom capability",
  input: { schema: { type: "object", properties: { message: { type: "string" } } } },
  output: { schema: { type: "object", properties: { result: { type: "string" } } } },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }) => ({ output: { result: `Hello ${(input as any).message}!` } }),
});

await server.listen({ port: 8080 });
```

## Verify a Receipt

```bash
aep receipt verify receipt.json
```

## Verify Audit Chain

```bash
aep audit verify
```
