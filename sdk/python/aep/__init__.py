"""AEP Python SDK — public API."""

from .types import *
from .canonical import canonicalize, fingerprint, sha256_hex, audit_hash
from .semver import satisfies, parse_semver, compare_semver, SemVer
from .state_machine import can_transition, is_terminal, can_transition_str, is_terminal_str
from .conformance import run_all, main

__version__ = "0.3.0"
