//! AEP Rust Conformance Runner — runs test vectors matching TS and Python.

use aep::*;
use aep::conformance_vectors::*;

fn main() {
    println!("AEP Rust SDK — Conformance Tests\n");

    let mut passed = 0;
    let mut failed = 0;

    // Canonical vectors
    println!("--- Canonicalization ---");
    for (name, input, expected) in canonical_vectors() {
        let actual = canonicalize(&input);
        if actual == expected {
            println!("  [PASS] canonical:{}", name);
            passed += 1;
        } else {
            println!("  [FAIL] canonical:{}", name);
            println!("         expected: {}", expected);
            println!("         actual:   {}", actual);
            failed += 1;
        }
    }

    // Fingerprint determinism
    println!("\n--- Fingerprint ---");
    for (name, input, _expected) in canonical_vectors() {
        let fp1 = fingerprint(&input);
        let fp2 = fingerprint(&input);
        if fp1 == fp2 && fp1.len() == 64 {
            println!("  [PASS] fingerprint:{}", name);
            passed += 1;
        } else {
            println!("  [FAIL] fingerprint:{} — fp={}", name, fp1);
            failed += 1;
        }
    }

    // SemVer vectors
    println!("\n--- SemVer ---");
    for (name, version, range, expected) in semver_vectors() {
        let actual = satisfies(version, range);
        if actual == expected {
            println!("  [PASS] semver:{}", name);
            passed += 1;
        } else {
            println!("  [FAIL] semver:{}", name);
            println!("         satisfies({}, {}) = {}, expected {}", version, range, actual, expected);
            failed += 1;
        }
    }

    // State transition vectors
    println!("\n--- State Transitions ---");
    for (name, from, to, expected) in transition_vectors() {
        let actual = can_transition_str(from, to);
        if actual == expected {
            println!("  [PASS] transition:{}", name);
            passed += 1;
        } else {
            println!("  [FAIL] transition:{}", name);
            println!("         {} → {} = {}, expected {}", from, to, actual, expected);
            failed += 1;
        }
    }

    // Audit hash chain
    println!("\n--- Audit Chain ---");
    {
        let records = audit_chain_records();
        let genesis = "0".repeat(64);
        let mut prev = genesis.clone();
        let mut hashes: Vec<String> = Vec::new();
        for (i, record) in records.iter().enumerate() {
            let mut r = record.clone();
            // Inject seq
            if let Some(obj) = r.as_object_mut() {
                obj.insert("seq".to_string(), serde_json::Value::Number((i + 1).into()));
            }
            let h = audit_hash(&r, &prev);
            hashes.push(h.clone());
            prev = h;
        }
        // Verify determinism
        let mut prev2 = genesis;
        let mut hashes2: Vec<String> = Vec::new();
        for (i, record) in records.iter().enumerate() {
            let mut r = record.clone();
            if let Some(obj) = r.as_object_mut() {
                obj.insert("seq".to_string(), serde_json::Value::Number((i + 1).into()));
            }
            let h = audit_hash(&r, &prev2);
            hashes2.push(h.clone());
            prev2 = h;
        }
        if hashes == hashes2 && hashes.len() == 3 {
            println!("  [PASS] audit_chain:simple_chain");
            passed += 1;
        } else {
            println!("  [FAIL] audit_chain:simple_chain");
            failed += 1;
        }
    }

    println!("\n=== Summary ===");
    println!("{}/{} tests passed", passed, passed + failed);

    if failed == 0 {
        println!("\n✓ Rust SDK conformance: PASS");
        std::process::exit(0);
    } else {
        println!("\n✗ Rust SDK conformance: FAIL");
        std::process::exit(1);
    }
}
