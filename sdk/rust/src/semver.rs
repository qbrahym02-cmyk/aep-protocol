//! AEP SemVer Matcher — MUST match TypeScript and Python implementations.
//!
//! Reference: spec/core/002-envelope.md §Capability Reference
//!
//! Supports:
//!   exact   "1.2.3"
//!   caret   "^1.2"     >=1.2.0 <2.0.0   (or  >=0.2.0 <0.3.0 for 0.x)
//!   tilde   "~1.2.3"   >=1.2.3 <1.3.0
//!   range   ">=1.0.0 <2.0.0"
//!   star    "*"
//!   or      "1.2.3 || 1.5.0"

use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemVer {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub prerelease: Vec<String>,
}

/// Normalize incomplete version strings:
///   "1"     → "1.0.0"
///   "1.2"   → "1.2.0"
///   "1.2.3" → "1.2.3"
fn normalize_version(version: &str) -> String {
    let re = Regex::new(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$").unwrap();
    if let Some(caps) = re.captures(version) {
        let major = caps.get(1).map(|m| m.as_str()).unwrap_or("0");
        let minor = caps.get(2).map(|m| m.as_str()).unwrap_or("0");
        let patch = caps.get(3).map(|m| m.as_str()).unwrap_or("0");
        let rest = caps.get(4).map(|m| m.as_str()).unwrap_or("");
        return format!("{}.{}.{}{}", major, minor, patch, rest);
    }
    version.to_string()
}

/// Parse a version string into SemVer. Returns None on failure.
pub fn parse_semver(version: &str) -> Option<SemVer> {
    let normalized = normalize_version(version);
    let re = Regex::new(
        r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+)?$",
    )
    .unwrap();
    let caps = re.captures(&normalized)?;
    let prerelease = caps
        .get(4)
        .map(|m| m.as_str().split('.').map(|s| s.to_string()).collect())
        .unwrap_or_default();
    Some(SemVer {
        major: caps.get(1)?.as_str().parse().ok()?,
        minor: caps.get(2)?.as_str().parse().ok()?,
        patch: caps.get(3)?.as_str().parse().ok()?,
        prerelease,
    })
}

fn compare_prerelease(a: &[String], b: &[String]) -> std::cmp::Ordering {
    if a.is_empty() && b.is_empty() {
        return std::cmp::Ordering::Equal;
    }
    if a.is_empty() {
        return std::cmp::Ordering::Greater; // no prerelease > has prerelease
    }
    if b.is_empty() {
        return std::cmp::Ordering::Less;
    }
    let max_len = a.len().max(b.len());
    for i in 0..max_len {
        let ai = a.get(i);
        let bi = b.get(i);
        match (ai, bi) {
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, None) => return std::cmp::Ordering::Equal,
            (Some(a_str), Some(b_str)) => {
                let a_num = a_str.parse::<i64>().ok();
                let b_num = b_str.parse::<i64>().ok();
                match (a_num, b_num) {
                    (Some(an), Some(bn)) => {
                        if an != bn {
                            return an.cmp(&bn);
                        }
                    }
                    (Some(_), None) => return std::cmp::Ordering::Less, // numeric < non-numeric
                    (None, Some(_)) => return std::cmp::Ordering::Greater,
                    (None, None) => {
                        match a_str.cmp(b_str) {
                            std::cmp::Ordering::Equal => continue,
                            other => return other,
                        }
                    }
                }
            }
        }
    }
    std::cmp::Ordering::Equal
}

pub fn compare_semver(a: &SemVer, b: &SemVer) -> std::cmp::Ordering {
    if a.major != b.major {
        return a.major.cmp(&b.major);
    }
    if a.minor != b.minor {
        return a.minor.cmp(&b.minor);
    }
    if a.patch != b.patch {
        return a.patch.cmp(&b.patch);
    }
    compare_prerelease(&a.prerelease, &b.prerelease)
}

#[derive(Debug, Clone)]
struct Comparator {
    op: String, // ">=", "<=", ">", "<", "="
    version: SemVer,
}

fn matches_comparator(v: &SemVer, c: &Comparator) -> bool {
    let cmp = compare_semver(v, &c.version);
    match c.op.as_str() {
        "=" => cmp == std::cmp::Ordering::Equal,
        ">" => cmp == std::cmp::Ordering::Greater,
        ">=" => matches!(cmp, std::cmp::Ordering::Greater | std::cmp::Ordering::Equal),
        "<" => cmp == std::cmp::Ordering::Less,
        "<=" => matches!(cmp, std::cmp::Ordering::Less | std::cmp::Ordering::Equal),
        _ => false,
    }
}

fn parse_comparator(s: &str) -> Option<Comparator> {
    let re = Regex::new(r"^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?)$").unwrap();
    let caps = re.captures(s)?;
    let v = parse_semver(caps.get(2)?.as_str())?;
    let op = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| "=".to_string());
    Some(Comparator { op, version: v })
}

fn caret_range(version: &SemVer) -> Vec<Comparator> {
    if version.major > 0 {
        vec![
            Comparator { op: ">=".to_string(), version: version.clone() },
            Comparator { op: "<".to_string(), version: SemVer { major: version.major + 1, minor: 0, patch: 0, prerelease: vec![] } },
        ]
    } else if version.minor > 0 {
        vec![
            Comparator { op: ">=".to_string(), version: version.clone() },
            Comparator { op: "<".to_string(), version: SemVer { major: 0, minor: version.minor + 1, patch: 0, prerelease: vec![] } },
        ]
    } else {
        vec![
            Comparator { op: ">=".to_string(), version: version.clone() },
            Comparator { op: "<".to_string(), version: SemVer { major: 0, minor: 0, patch: version.patch + 1, prerelease: vec![] } },
        ]
    }
}

fn tilde_range(version: &SemVer) -> Vec<Comparator> {
    vec![
        Comparator { op: ">=".to_string(), version: version.clone() },
        Comparator { op: "<".to_string(), version: SemVer { major: version.major, minor: version.minor + 1, patch: 0, prerelease: vec![] } },
    ]
}

fn parse_range(range_str: &str) -> Vec<Vec<Comparator>> {
    range_str
        .split("||")
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() || trimmed == "*" {
                return Some(vec![]);
            }
            if trimmed.starts_with('^') {
                let v = parse_semver(trimmed[1..].trim())?;
                return Some(caret_range(&v));
            }
            if trimmed.starts_with('~') {
                let v = parse_semver(trimmed[1..].trim())?;
                return Some(tilde_range(&v));
            }
            // bare version = exact
            let bare_re = Regex::new(r"^\d+\.\d+\.\d+").unwrap();
            if bare_re.is_match(trimmed) {
                let v = parse_semver(trimmed)?;
                return Some(vec![Comparator { op: "=".to_string(), version: v }]);
            }
            // space-separated comparators
            let comps: Vec<Comparator> = trimmed
                .split_whitespace()
                .filter_map(|t| parse_comparator(t))
                .collect();
            Some(comps)
        })
        .collect()
}

/// Check if version satisfies range. Matches TS satisfies() and Python satisfies().
pub fn satisfies(version: &str, range_str: &str) -> bool {
    let v = match parse_semver(version) {
        Some(v) => v,
        None => return false,
    };
    if range_str == "*" || range_str.is_empty() {
        return true;
    }
    let or_groups = parse_range(range_str);
    or_groups.iter().any(|group| {
        group.is_empty() || group.iter().all(|c| matches_comparator(&v, c))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(satisfies("1.2.3", "1.2.3"));
        assert!(!satisfies("1.2.4", "1.2.3"));
    }

    #[test]
    fn test_caret_in_range() {
        assert!(satisfies("1.5.0", "^1.2"));
        assert!(satisfies("1.2.0", "^1.2"));
        assert!(!satisfies("2.0.0", "^1.2"));
    }

    #[test]
    fn test_caret_0_x_minor() {
        assert!(satisfies("0.2.5", "^0.2.3"));
        assert!(!satisfies("0.3.0", "^0.2.3"));
    }

    #[test]
    fn test_caret_0_0_x_patch() {
        assert!(satisfies("0.0.3", "^0.0.3"));
        assert!(!satisfies("0.0.4", "^0.0.3"));
    }

    #[test]
    fn test_tilde_in_range() {
        assert!(satisfies("1.2.5", "~1.2.3"));
        assert!(!satisfies("1.3.0", "~1.2.3"));
    }

    #[test]
    fn test_star() {
        assert!(satisfies("99.99.99", "*"));
    }

    #[test]
    fn test_or() {
        assert!(satisfies("1.2.3", "1.2.3 || 1.5.0"));
        assert!(satisfies("1.5.0", "1.2.3 || 1.5.0"));
        assert!(!satisfies("1.4.0", "1.2.3 || 1.5.0"));
    }

    #[test]
    fn test_range() {
        assert!(satisfies("1.5.0", ">=1.0.0 <2.0.0"));
        assert!(!satisfies("2.0.0", ">=1.0.0 <2.0.0"));
        assert!(!satisfies("0.9.0", ">=1.0.0 <2.0.0"));
    }

    #[test]
    fn test_incomplete_major() {
        assert!(satisfies("1.0.0", "1"));
    }

    #[test]
    fn test_incomplete_minor() {
        assert!(satisfies("1.2.0", "1.2"));
    }
}
