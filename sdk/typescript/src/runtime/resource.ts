/**
 * ResourceRef — Tenant-bound resource identity.
 * Reference: AEP_10_10 §130 Resource Model§15 Resource Authorization
 * 
 * Every resource is tenant-bound. Authorization checks:
 * resource type + resource id + tenant
  */

export interface ResourceRef {
  type: string;       // e.g. "environment", "repo", "database", "file"
  id: string;         // e.g. "staging", "org/project", "db://orders"
  tenant_id: string;  // e.g. "tenant_acme" — REQUIRED, never empty
}

export function resourceRef(type: string, id: string, tenantId: string): ResourceRef {
  if (!tenantId) {
    throw new Error("ResourceRef requires non-empty tenant_id");
  }
  return { type, id, tenant_id: tenantId };
}

export function resourceToString(r: ResourceRef): string {
  return `${r.type}:${r.id}@${r.tenant_id}`;
}

export function resourcesEqual(a: ResourceRef, b: ResourceRef): boolean {
  return a.type === b.type && a.id === b.id && a.tenant_id === b.tenant_id;
}

/**
 * Check if a resource belongs to a tenant.
  */
export function resourceBelongsToTenant(r: ResourceRef, tenantId: string): boolean {
  return r.tenant_id === tenantId;
}
