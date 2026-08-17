"""
AEP SemVer Matcher — MUST match TypeScript implementation
Reference: spec/core/002-envelope.md §Capability Reference

Supports:
  exact   "1.2.3"
  caret   "^1.2"     >=1.2.0 <2.0.0   (or  >=0.2.0 <0.3.0 for 0.x)
  tilde   "~1.2.3"   >=1.2.3 <1.3.0
  range   ">=1.0.0 <2.0.0"
  star    "*"
  or      "1.2.3 || 1.5.0"
"""

from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class SemVer:
    major: int
    minor: int
    patch: int
    prerelease: list = None

    def __post_init__(self):
        if self.prerelease is None:
            self.prerelease = []


def normalize_version(version):
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$", version)
    if not m:
        return version
    major = m.group(1)
    minor = m.group(2) or "0"
    patch = m.group(3) or "0"
    rest = m.group(4) or ""
    return f"{major}.{minor}.{patch}{rest}"


def parse_semver(version):
    normalized = normalize_version(version)
    m = re.match(
        r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+)?$",
        normalized,
    )
    if not m:
        return None
    prerelease = m.group(4).split(".") if m.group(4) else []
    return SemVer(
        major=int(m.group(1)),
        minor=int(m.group(2)),
        patch=int(m.group(3)),
        prerelease=prerelease,
    )


def _compare_prerelease(a, b):
    if not a and not b:
        return 0
    if not a:
        return 1
    if not b:
        return -1
    for i in range(max(len(a), len(b))):
        ai = a[i] if i < len(a) else None
        bi = b[i] if i < len(b) else None
        if ai is None:
            return -1
        if bi is None:
            return 1
        an = ai.isdigit()
        bn = bi.isdigit()
        if an and bn:
            diff = int(ai) - int(bi)
            if diff != 0:
                return diff
        elif an:
            return -1
        elif bn:
            return 1
        else:
            if ai < bi:
                return -1
            if ai > bi:
                return 1
    return 0


def compare_semver(a, b):
    if a.major != b.major:
        return -1 if a.major < b.major else 1
    if a.minor != b.minor:
        return -1 if a.minor < b.minor else 1
    if a.patch != b.patch:
        return -1 if a.patch < b.patch else 1
    return _compare_prerelease(a.prerelease, b.prerelease)


@dataclass
class Comparator:
    op: str
    version: SemVer


def _parse_comparator(s):
    m = re.match(r"^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?)$", s)
    if not m:
        return None
    v = parse_semver(m.group(2))
    if v is None:
        return None
    return Comparator(op=m.group(1) or "=", version=v)


def _matches_comparator(v, c):
    cmp = compare_semver(v, c.version)
    if c.op == "=":
        return cmp == 0
    if c.op == ">":
        return cmp > 0
    if c.op == ">=":
        return cmp >= 0
    if c.op == "<":
        return cmp < 0
    if c.op == "<=":
        return cmp <= 0
    return False


def _caret_range(version):
    if version.major > 0:
        return [
            Comparator(">=", version),
            Comparator("<", SemVer(version.major + 1, 0, 0)),
        ]
    if version.minor > 0:
        return [
            Comparator(">=", version),
            Comparator("<", SemVer(0, version.minor + 1, 0)),
        ]
    return [
        Comparator(">=", version),
        Comparator("<", SemVer(0, 0, version.patch + 1)),
    ]


def _tilde_range(version):
    return [
        Comparator(">=", version),
        Comparator("<", SemVer(version.major, version.minor + 1, 0)),
    ]


def _parse_range(range_str):
    or_groups = range_str.split("||")
    result = []
    for part in or_groups:
        trimmed = part.strip()
        if trimmed == "*" or trimmed == "":
            result.append([])
            continue
        if trimmed.startswith("^"):
            v = parse_semver(trimmed[1:].strip())
            if v is None:
                result.append([])
                continue
            result.append(_caret_range(v))
            continue
        if trimmed.startswith("~"):
            v = parse_semver(trimmed[1:].strip())
            if v is None:
                result.append([])
                continue
            result.append(_tilde_range(v))
            continue
        if re.match(r"^\d+\.\d+\.\d+", trimmed):
            v = parse_semver(trimmed)
            if v is None:
                result.append([])
                continue
            result.append([Comparator("=", v)])
            continue
        comps = []
        for token in trimmed.split():
            c = _parse_comparator(token)
            if c is not None:
                comps.append(c)
        result.append(comps)
    return result


def satisfies(version, range_str):
    v = parse_semver(version)
    if v is None:
        return False
    if range_str == "*" or range_str == "":
        return True
    or_groups = _parse_range(range_str)
    return any(
        len(group) == 0 or all(_matches_comparator(v, c) for c in group)
        for group in or_groups
    )
