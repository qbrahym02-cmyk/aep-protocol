/**
 * SemVer range matcher.
 * Reference: spec/002-envelope.md §Capability Referencespec/003-capabilities.md §Capability Versioning
 * 
 * Supports:
 * exact   "1.2.3"
 * caret   "^1.2"     ≥1.2.0 <2.0.0   ( ≥0.2.0 <0.3.0 0.x)
 * tilde   "~1.2.3"   ≥1.2.3 <1.3.0
 * range   ">=1.0.0 <2.0.0"
 * star    "*"         
 * or      "1.2.3 || 1.5.0"
  */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const PRERELEASE_IDENT = /^[0-9A-Za-z-]+$/;

/**
 * .
 * "1"     → "1.0.0"
 * "1.2"   → "1.2.0"
 * "1.2.3" → "1.2.3"
 * "1.2.3-alpha" → "1.2.3-alpha"
  */
function normalizeVersion(version: string): string {
  // split off prerelease/build
  const mainMatch = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/);
  if (!mainMatch) return version;
  const major = mainMatch[1];
  const minor = mainMatch[2] || "0";
  const patch = mainMatch[3] || "0";
  const rest = mainMatch[4] || "";
  return `${major}.${minor}.${patch}${rest}`;
}

export function parseSemVer(version: string): SemVer | null {
  const normalized = normalizeVersion(version);
  const m = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+)?$/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // prerelease has prerelease
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const diff = parseInt(ai, 10) - parseInt(bi, 10);
      if (diff !== 0) return diff;
    } else if (an) {
      return -1;
    } else if (bn) {
      return 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return 0;
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

interface Comparator {
  op: ">=" | ">" | "<=" | "<" | "=";
  version: SemVer;
}

function parseComparator(s: string): Comparator | null {
  // Supports: 1, 1.2, 1.2.3, 1.2.3-alpha
  const m = s.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?)$/);
  if (!m) return null;
  const v = parseSemVer(m[2]); // parseSemVer will normalize
  if (!v) return null;
  return { op: (m[1] || "=") as Comparator["op"], version: v };
}

function matchesComparator(v: SemVer, c: Comparator): boolean {
  const cmp = compareSemVer(v, c.version);
  switch (c.op) {
    case "=": return cmp === 0;
    case ">": return cmp > 0;
    case ">=": return cmp >= 0;
    case "<": return cmp < 0;
    case "<=": return cmp <= 0;
  }
}

function caretRange(version: SemVer): Comparator[] {
  // ^1.2.3     ≥1.2.3 <2.0.0
  // ^0.2.3     ≥0.2.3 <0.3.0
  // ^0.0.3     ≥0.0.3 <0.0.4
  if (version.major > 0) {
    return [
      { op: ">=", version },
      { op: "<", version: { ...version, major: version.major + 1, minor: 0, patch: 0, prerelease: [] } },
    ];
  }
  if (version.minor > 0) {
    return [
      { op: ">=", version },
      { op: "<", version: { ...version, minor: version.minor + 1, patch: 0, prerelease: [] } },
    ];
  }
  return [
    { op: ">=", version },
    { op: "<", version: { ...version, patch: version.patch + 1, prerelease: [] } },
  ];
}

function tildeRange(version: SemVer): Comparator[] {
  // ~1.2.3     ≥1.2.3 <1.3.0
  return [
    { op: ">=", version },
    { op: "<", version: { ...version, minor: version.minor + 1, patch: 0, prerelease: [] } },
  ];
}

function parseRange(range: string): Comparator[][] {
  // "1.2.3 || 1.5.0" -> OR
  return range.split("||").map((part) => {
    const trimmed = part.trim();
    if (trimmed === "*" || trimmed === "") return [];

    // caret
    if (trimmed.startsWith("^")) {
      const v = parseSemVer(trimmed.slice(1).trim());
      if (!v) return [];
      return caretRange(v);
    }
    // tilde
    if (trimmed.startsWith("~")) {
      const v = parseSemVer(trimmed.slice(1).trim());
      if (!v) return [];
      return tildeRange(v);
    }
    // bare version = exact
    if (/^\d+\.\d+\.\d+/.test(trimmed)) {
      const v = parseSemVer(trimmed);
      if (!v) return [];
      return [{ op: "=", version: v }];
    }
    // range with comparators
    return trimmed
      .split(/\s+/)
      .map(parseComparator)
      .filter((c): c is Comparator => c !== null);
  });
}

export function satisfies(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  if (range === "*" || range === "") return true;
  const orGroups = parseRange(range);
  return orGroups.some((group) =>
    group.length === 0 ? true : group.every((c) => matchesComparator(v, c))
  );
}
