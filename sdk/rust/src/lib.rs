//! AEP Rust SDK — main library entry point.

pub mod types;
pub mod canonical;
pub mod semver;
pub mod state_machine;
pub mod conformance_vectors;

pub use types::*;
pub use canonical::{canonicalize, fingerprint, sha256_hex, audit_hash};
pub use semver::{satisfies, parse_semver, compare_semver, SemVer};
pub use state_machine::{can_transition, is_terminal, can_transition_str, is_terminal_str};

pub const VERSION: &str = "0.4.0";
