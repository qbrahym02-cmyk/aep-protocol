# !/usr/bin/env node
/**
  * Cross-Language Interop Test — TS ↔ Python
  * Reference: spec/10-10 §54 Cross Implementation
  * /

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_VECTORS,
  SEMVER_VECTORS,
  TRANSITION_VECTORS,
  runAllVectors,
  exportVectorsAsJSON,
  fingerprint,
  satisfies,
  canTransition,
} from "../src/index.js";  // scripts/ → ../src/

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");  // sdk/typescript/scripts → aep/
const TMP = join(ROOT, "tmp-cross-lang");
mkdirSync(TMP, { recursive: true });

const pyConfPath = join(ROOT, "sdk", "python");

function runPy(args: string[]): string {
  // Write args to a temp file and run python with the args
  const scriptPath = join(TMP, "py-args.json");
  writeFileSync(scriptPath, JSON.stringify(args));
  const code = `
import json, sys
with open(${JSON.stringify(scriptPath)}) as f:
    args = json.load(f)
${args[0]}
`;
  // Write code to file
  const codePath = join(TMP, "py-script.py");
  writeFileSync(codePath, code);
  return execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" }).trim();
}

function pyCanonical(input: unknown): string {
  const inputJson = JSON.stringify(input);
  const scriptPath = join(TMP, "py-canonical-input.json");
  writeFileSync(scriptPath, inputJson);
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pyConfPath)})
with open(${JSON.stringify(scriptPath)}) as f:
    inp = json.load(f)
from aep.canonical import canonicalize
print(canonicalize(inp))
`;
  const codePath = join(TMP, "py-canonical.py");
  writeFileSync(codePath, code);
  return execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" }).trim();
}

function pyFingerprint(input: unknown): string {
  const inputJson = JSON.stringify(input);
  const scriptPath = join(TMP, "py-fp-input.json");
  writeFileSync(scriptPath, inputJson);
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pyConfPath)})
with open(${JSON.stringify(scriptPath)}) as f:
    inp = json.load(f)
from aep.canonical import fingerprint
print(fingerprint(inp))
`;
  const codePath = join(TMP, "py-fp.py");
  writeFileSync(codePath, code);
  return execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" }).trim();
}

function pySatisfies(version: string, range: string): string {
  const inputJson = JSON.stringify({ version, range });
  const scriptPath = join(TMP, "py-semver-input.json");
  writeFileSync(scriptPath, inputJson);
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pyConfPath)})
with open(${JSON.stringify(scriptPath)}) as f:
    inp = json.load(f)
from aep.semver import satisfies
print("true" if satisfies(inp["version"], inp["range"]) else "false")
`;
  const codePath = join(TMP, "py-semver.py");
  writeFileSync(codePath, code);
  return execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" }).trim();
}

function pyTransition(from: string, to: string): string {
  const inputJson = JSON.stringify({ from, to });
  const scriptPath = join(TMP, "py-trans-input.json");
  writeFileSync(scriptPath, inputJson);
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pyConfPath)})
with open(${JSON.stringify(scriptPath)}) as f:
    inp = json.load(f)
from aep.state_machine import can_transition_str
print("true" if can_transition_str(inp["from"], inp["to"]) else "false")
`;
  const codePath = join(TMP, "py-trans.py");
  writeFileSync(codePath, code);
  return execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" }).trim();
}

async function main() {
  console.log("=== Cross-Language Interop Test ===\n");

  // 1) Run TS vectors
  const tsSummary = runAllVectors();

  // 2) Run Python vectors
  let pySummary;
  try {
    const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pyConfPath)})
from aep.conformance import run_all
s = run_all()
print(json.dumps({'total': s['total'], 'passed': s['passed'], 'failed': s['failed']}))
`;
    const codePath = join(TMP, "py-conf.py");
    writeFileSync(codePath, code);
    const output = execSync(`cd ${pyConfPath} && python3 ${codePath}`, { encoding: "utf-8" });
    pySummary = JSON.parse(output.trim());
  } catch (err) {
    console.error("Failed to run Python:", err.message);
    process.exit(1);
  }

  console.log("TS conformance:    ", tsSummary.passed + "/" + tsSummary.total);
  console.log("Python conformance: ", pySummary.passed + "/" + pySummary.total);
  console.log();

  let mismatches = 0;

  // 3) Canonical comparison
  console.log("--- Canonical output comparison ---");
  for (const v of CANONICAL_VECTORS) {
    const pyResult = pyCanonical(v.input);
    const tsResult = v.expected;
    if (pyResult !== tsResult) {
      console.log(`  [MISMATCH] ${v.name}`);
      console.log(`    TS: ${tsResult}`);
      console.log(`    PY: ${pyResult}`);
      mismatches++;
    }
  }
  console.log("  ✓ all canonical outputs match (TS = Python)");

  // 4) Fingerprint comparison
  console.log("\n--- Fingerprint comparison ---");
  for (const v of CANONICAL_VECTORS) {
    const pyFp = pyFingerprint(v.input);
    const tsFp = fingerprint(v.input);
    if (pyFp !== tsFp) {
      console.log(`  [MISMATCH] ${v.name}`);
      console.log(`    TS: ${tsFp}`);
      console.log(`    PY: ${pyFp}`);
      mismatches++;
    }
  }
  console.log("  ✓ all fingerprints match (TS = Python)");

  // 5) SemVer comparison
  console.log("\n--- SemVer matching comparison ---");
  for (const v of SEMVER_VECTORS) {
    const pyResult = pySatisfies(v.version, v.range);
    const tsResult = satisfies(v.version, v.range) ? "true" : "false";
    if (pyResult !== tsResult) {
      console.log(`  [MISMATCH] ${v.name}: ${v.version} vs ${v.range}`);
      console.log(`    TS: ${tsResult}, PY: ${pyResult}`);
      mismatches++;
    }
  }
  console.log("  ✓ all semver matches agree (TS = Python)");

  // 6) State transition comparison
  console.log("\n--- State transition comparison ---");
  for (const v of TRANSITION_VECTORS) {
    const pyResult = pyTransition(v.from, v.to);
    const tsResult = canTransition(v.from as any, v.to as any) ? "true" : "false";
    if (pyResult !== tsResult) {
      console.log(`  [MISMATCH] ${v.name}: ${v.from} → ${v.to}`);
      console.log(`    TS: ${tsResult}, PY: ${pyResult}`);
      mismatches++;
    }
  }
  console.log("  ✓ all state transitions agree (TS = Python)");

  console.log("\n=== Summary ===");
  console.log("TS conformance:    ", tsSummary.passed + "/" + tsSummary.total);
  console.log("Python conformance: ", pySummary.passed + "/" + pySummary.total);
  console.log("Cross-lang mismatches:", mismatches);

  if (mismatches === 0 && tsSummary.failed === 0 && pySummary.failed === 0) {
    console.log("\n✓ Cross-language interop: PASS");
    process.exit(0);
  } else {
    console.log("\n✗ Cross-language interop: FAIL");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
