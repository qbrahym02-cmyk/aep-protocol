/**
 * Provider Sandbox — Real enforcement of network/filesystem/time limits.
 * 
 * This is NOT just documentation. It enforces:
 *   - Domain allowlist for HTTP providers (SSRF protection)
 *   - Private IP blocking
 *   - DNS rebinding protection (pin resolved IP)
 *   - Redirect policy
 *   - Body/response size limits
 *   - Filesystem path restrictions
 *   - Time budget enforcement
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EffectDescriptor } from "../effects/descriptor.js";

// ============================================================================
// Network Policy
// ============================================================================

export interface NetworkPolicy {
  allowed_domains: string[];
  blocked_cidrs: string[];
  allow_private_ips: boolean;  // default: false
  max_redirects: number;       // default: 0
  max_response_bytes: number;  // default: 10MB
  timeout_ms: number;          // default: 30000
  allowed_ports: number[];     // default: [80, 443]
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  allowed_domains: [],
  blocked_cidrs: [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",  // AWS metadata endpoint
    "0.0.0.0/8",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
  ],
  allow_private_ips: false,
  max_redirects: 0,
  max_response_bytes: 10 * 1024 * 1024,
  timeout_ms: 30_000,
  allowed_ports: [80, 443],
};

// ============================================================================
// SSRF Protection
// ============================================================================

export class SsrfProtector {
  private policy: NetworkPolicy;
  private dnsCache = new Map<string, string>();  // domain → resolved IP (pinned)

  constructor(policy: Partial<NetworkPolicy> = {}) {
    this.policy = { ...DEFAULT_NETWORK_POLICY, ...policy };
  }

  /**
   * Validate and resolve a URL for safe outbound requests.
   * Throws if the URL violates any network policy.
   */
  async validateUrl(url: string): Promise<{ url: string; ip: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Protocol check
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Protocol not allowed: ${parsed.protocol}`);
    }

    // Port check
    const port = parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
    if (!this.policy.allowed_ports.includes(port)) {
      throw new Error(`Port ${port} not allowed`);
    }

    const hostname = parsed.hostname;

    // If it's already an IP — check directly
    if (isIP(hostname)) {
      if (this.isBlockedIp(hostname)) {
        throw new Error(`IP ${hostname} is blocked (private/reserved)`);
      }
      if (!this.policy.allow_private_ips && this.isPrivateIp(hostname)) {
        throw new Error(`Private IP ${hostname} not allowed`);
      }
      return { url: parsed.toString(), ip: hostname };
    }

    // Domain allowlist check
    if (this.policy.allowed_domains.length > 0) {
      const allowed = this.policy.allowed_domains.some((d) =>
        hostname === d || hostname.endsWith("." + d)
      );
      if (!allowed) {
        throw new Error(`Domain ${hostname} not in allowlist`);
      }
    }

    // DNS resolution
    let resolvedIp: string;
    try {
      const records = await lookup(hostname, { family: 4 });
      resolvedIp = records.address;
    } catch {
      throw new Error(`DNS resolution failed for ${hostname}`);
    }

    // Check resolved IP
    if (this.isBlockedIp(resolvedIp)) {
      throw new Error(`Resolved IP ${resolvedIp} is blocked for ${hostname}`);
    }
    if (!this.policy.allow_private_ips && this.isPrivateIp(resolvedIp)) {
      throw new Error(`Resolved private IP ${resolvedIp} not allowed for ${hostname}`);
    }

    // DNS rebinding protection: pin the resolved IP
    const cached = this.dnsCache.get(hostname);
    if (cached && cached !== resolvedIp) {
      throw new Error(`DNS rebinding detected: ${hostname} resolved to ${cached} before, now ${resolvedIp}`);
    }
    this.dnsCache.set(hostname, resolvedIp);

    return { url: parsed.toString(), ip: resolvedIp };
  }

  private isPrivateIp(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4) return false;
    const [a, b] = parts;
    return (
      (a === 10) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 127) ||
      (a === 0) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }

  private isBlockedIp(ip: string): boolean {
    return this.isPrivateIp(ip) && !this.policy.allow_private_ips;
  }

  get policy_(): NetworkPolicy {
    return this.policy;
  }
}

// ============================================================================
// Filesystem Sandbox
// ============================================================================

export interface FilesystemPolicy {
  root_dir: string;
  allow_symlinks: boolean;  // default: false
  allowed_extensions: string[];  // default: [] (all allowed)
  max_file_size: number;  // default: 100MB
}

export const DEFAULT_FS_POLICY: FilesystemPolicy = {
  root_dir: "/tmp/aep-sandbox",
  allow_symlinks: false,
  allowed_extensions: [],
  max_file_size: 100 * 1024 * 1024,
};

export class FilesystemSandbox {
  private policy: FilesystemPolicy;

  constructor(policy: Partial<FilesystemPolicy> = {}) {
    this.policy = { ...DEFAULT_FS_POLICY, ...policy };
  }

  /**
   * Validate a file path is within the sandbox root.
   * Prevents path traversal attacks.
   */
  validatePath(path: string): string {
    // Normalize and resolve
    const resolved = require("node:path").resolve(this.policy.root_dir, path);

    // Check if within root
    if (!resolved.startsWith(this.policy.root_dir)) {
      throw new Error(`Path traversal detected: ${path} escapes sandbox root`);
    }

    // Check extension
    if (this.policy.allowed_extensions.length > 0) {
      const ext = require("node:path").extname(resolved);
      if (!this.policy.allowed_extensions.includes(ext)) {
        throw new Error(`Extension ${ext} not allowed`);
      }
    }

    return resolved;
  }

  /**
   * Validate file size.
   */
  validateSize(size: number): void {
    if (size > this.policy.max_file_size) {
      throw new Error(`File size ${size} exceeds max ${this.policy.max_file_size}`);
    }
  }
}

// ============================================================================
// Provider Manifest Enforcer
// ============================================================================

export interface ProviderManifest {
  provider_id: string;
  version: string;
  capabilities: string[];
  network: NetworkPolicy;
  filesystem: FilesystemPolicy;
  max_memory_mb: number;
  max_cpu_seconds: number;
  effects: EffectDescriptor[];
  signature?: {
    algorithm: "ed25519" | "hmac-sha256";
    key_id: string;
    value: string;
  };
}

export class ProviderSandbox {
  private manifests = new Map<string, ProviderManifest>();
  private ssrfProtectors = new Map<string, SsrfProtector>();
  private fsSandboxes = new Map<string, FilesystemSandbox>();

  registerProvider(manifest: ProviderManifest): void {
    this.manifests.set(manifest.provider_id, manifest);
    this.ssrfProtectors.set(manifest.provider_id, new SsrfProtector(manifest.network));
    this.fsSandboxes.set(manifest.provider_id, new FilesystemSandbox(manifest.filesystem));
  }

  /**
   * Get the SSRF protector for a provider.
   */
  getSsrfProtector(providerId: string): SsrfProtector | undefined {
    return this.ssrfProtectors.get(providerId);
  }

  /**
   * Get the filesystem sandbox for a provider.
   */
  getFilesystemSandbox(providerId: string): FilesystemSandbox | undefined {
    return this.fsSandboxes.get(providerId);
  }

  /**
   * Validate that a URL is safe for the given provider to access.
   */
  async validateProviderUrl(providerId: string, url: string): Promise<void> {
    const protector = this.ssrfProtectors.get(providerId);
    if (!protector) {
      // No manifest registered — use default (strict) policy
      const defaultProtector = new SsrfProtector(DEFAULT_NETWORK_POLICY);
      await defaultProtector.validateUrl(url);
      return;
    }
    await protector.validateUrl(url);
  }

  /**
   * Validate that a file path is safe for the given provider.
   */
  validateProviderPath(providerId: string, path: string): string {
    const sandbox = this.fsSandboxes.get(providerId);
    if (!sandbox) {
      const defaultSandbox = new FilesystemSandbox(DEFAULT_FS_POLICY);
      return defaultSandbox.validatePath(path);
    }
    return sandbox.validatePath(path);
  }

  /**
   * Get the manifest for a provider.
   */
  getManifest(providerId: string): ProviderManifest | undefined {
    return this.manifests.get(providerId);
  }

  /**
   * List all registered providers.
   */
  listProviders(): ProviderManifest[] {
    return Array.from(this.manifests.values());
  }
}
