/**
 * AEP SDK — Public API entry point
 */

export * from "./core/types.js";
export * from "./core/canonical.js";
export * from "./core/semver.js";
export * from "./core/validator.js";
export * from "./core/registry.js";
export * from "./core/ulid.js";

export * from "./execution/state-machine.js";
export { IdempotencyCache } from "./execution/idempotency.js";
export type { IdempotencyEntry as IdempotencyCacheEntry } from "./execution/idempotency.js";
// Legacy engine — deprecated (§164). Not used in production path.
// export * from "./execution/engine.js";
export * from "./execution/signal.js";
export * from "./execution/retry.js";

export * from "./policy/engine.js";
export * from "./policy/risk.js";

export * from "./workflow/engine.js";
export {
  WorkflowArtifactEngine,
  type WorkflowArtifact,
  type WorkflowArtifactNode,
  type ValidationIssue as WorkflowValidationIssue,
  type ValidationResult as WorkflowValidationResult,
  type ExecutionPlan,
  type SimulationResult,
  type ReplayResult,
  type ReplayEvent,
} from "./workflow-artifact/engine.js";

export * from "./events/emitter.js";
export * from "./events/artifacts.js";
export * from "./events/audit.js";
export * from "./events/redaction.js";

export * from "./authority/engine.js";
export * from "./discovery/resolver.js";

export * from "./principal/authenticator.js";
export type {
  IdempotencyStore,
  IdempotencyScope as IdempotencyStoreScope,
  IdempotencyEntry as IdempotencyStoreEntry,
  ExecutionStore,
  AuthorityStore,
  ArtifactStore,
  EventStore,
  AuditStore,
  BudgetStore,
  BudgetScope,
  BudgetReservation,
} from "./persistence/interfaces.js";
export {
  InMemoryExecutionStore,
  InMemoryAuthorityStore,
  InMemoryIdempotencyStore,
  InMemoryBudgetStore,
  InMemoryEventStore,
} from "./persistence/interfaces.js";
export { SQLiteStore, type SQLiteStoreOptions } from "./persistence/adapters/sqlite.js";
export { PostgresStore, type PostgresStoreOptions } from "./persistence/adapters/postgres.js";
export { ProviderSandbox, SsrfProtector, FilesystemSandbox, type ProviderManifest, type NetworkPolicy, DEFAULT_NETWORK_POLICY, DEFAULT_FS_POLICY } from "./security/provider_sandbox.js";
export { RecoveryEngine, type RecoveryReport, type RecoveryOptions } from "./recovery/engine.js";
export {
  runAllVectors,
  exportVectorsAsJSON,
  CANONICAL_VECTORS,
  FINGERPRINT_VECTORS,
  SEMVER_VECTORS,
  TRANSITION_VECTORS,
  AUDIT_CHAIN_VECTORS,
  AUTHORITY_DERIVATION_VECTORS,
} from "./conformance/vectors/vectors.js";
export * from "./receipt/builder.js";
export * from "./effects/descriptor.js";
export { AEPError, isAEPError, asAEPError, invalidRequest, unauthorized, timeout, rateLimited, budgetExceeded, policyDenied, authorityInsufficient, internalError, type AEPErrorCode, type RecoveryAction } from "./errors/aep-error.js";

export * from "./gateway/http.js";
export * from "./gateway/client.js";

// 0.4 additions: production hardening
export * from "./security/mtls.js";
export * from "./security/rate_limiter.js";
export * from "./security/cors.js";
export * from "./security/body_limit.js";
export * from "./security/production.js";
export * from "./observability/metrics.js";
export * from "./approval/service.js";
export { SecureExecutionEngine, type SecureExecutionEngineOptions } from "./execution/secure_engine.js";

export * from "./server.js";
export * from "./providers/builtin.js";
export { REFERENCE_PROVIDERS, resetSideEffects, getSideEffectCount } from "./providers/reference/index.js";
export type { ExecutionRuntime } from "./runtime/types.js";
export { createProductionRuntime, createDevelopmentRuntime, type ProductionRuntimeDependencies } from "./runtime/composition_root.js";
export { SystemClock, FakeClock, type Clock } from "./runtime/clock.js";
export { resourceRef, resourceToString, resourcesEqual, resourceBelongsToTenant, type ResourceRef } from "./runtime/resource.js";
export { DefaultProviderResolver, type ProviderResolver, type ProviderSelection, type ProviderCandidate, type ResolutionContext } from "./runtime/provider_resolver.js";
export { buildPlan, verifyPlanDigest, buildProof, verifyProofDigest, verifyProofForExecution, type Plan, type PlanNode, type Proof } from "./plan/artifact.js";

// MCP Adapter + Provider SDK
export { wrapMCPToolAsCapability, exposeAEPAsMCPTools, createMCPServerAdapter } from "./adapters/mcp/adapter.js";
export { registerProvider, GITHUB_PROVIDER, STRIPE_PROVIDER, SLACK_PROVIDER, POSTGRES_PROVIDER, type AEPProviderDefinition } from "./providers/sdk/index.js";

// Cryptographic protocol
export { HmacSha256Signer, KeyStore, buildSignedReceipt, verifySignedReceipt, buildSignedAuthority, verifySignedAuthority, type Signer, type SigningKey, type SignatureEnvelope, type SignedReceipt, type SignedAuthority } from "./security/crypto.js";

export { runConformance, type ConformanceResult } from "./conformance/runner.js";

// AEP Kit — Simple agent interface
export { AEP, AEPApprovalRequiredError, toOpenAIFunctions, aepToLangChain } from "./kit.js";
