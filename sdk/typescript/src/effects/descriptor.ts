/**
 * Effects — Side Effect Descriptor
 * Reference: spec/10-10 §10 Effects
 * 
 * Capability MUST side effects.
 * : Policy + Risk + Approval + Simulation + Audit
  */

export type EffectKind =
  | "read"          // قراءة فقط (no side effect)
  | "write"         // كتابة
  | "delete"        // حذف
  | "execute"       // تنفيذ كود/عملية
  | "network"       // اتصال شبكي
  | "financial"     // عملية مالية
  | "identity"      // مساس بالهوية
  | "irreversible"; // لا يمكن التراجع

export interface EffectDescriptor {
  kind: EffectKind;
  resource?: string;       // مورد محدد (e.g. "repo:org/project")
  description?: string;
  reversible?: boolean;
  compensation_capability?: string;  // capability عكسية
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * effect side effect 
  */
export function hasSideEffect(effect: EffectDescriptor): boolean {
  return effect.kind !== "read";
}

/**
 * effect 
  */
export function hasIrreversibleEffect(effects: EffectDescriptor[]): boolean {
  return effects.some((e) => e.kind === "irreversible" || e.kind === "delete" || (e.reversible === false));
}

/**
 * effects 
  */
export function hasFinancialImpact(effects: EffectDescriptor[]): boolean {
  return effects.some((e) => e.kind === "financial");
}

/**
 * approval
  */
export function requiresApproval(effects: EffectDescriptor[]): boolean {
  return effects.some((e) =>
    e.kind === "irreversible" ||
    e.kind === "financial" ||
    e.kind === "delete" ||
    e.kind === "identity"
  );
}

/**
 * Impact summary approver.
  */
export function summarizeEffects(effects: EffectDescriptor[]): {
  has_side_effects: boolean;
  irreversible: boolean;
  financial: boolean;
  affects_identity: boolean;
  network: boolean;
  resources: string[];
} {
  return {
    has_side_effects: effects.some(hasSideEffect),
    irreversible: hasIrreversibleEffect(effects),
    financial: hasFinancialImpact(effects),
    affects_identity: effects.some((e) => e.kind === "identity"),
    network: effects.some((e) => e.kind === "network"),
    resources: Array.from(new Set(effects.map((e) => e.resource).filter((r): r is string => Boolean(r)))),
  };
}
