#!/usr/bin/env node
// Prints the SHA-256 hex of a passcode, for the TRIP_PASS_HASH env var.
// Usage: node scripts/hash-passcode.mjs "your passcode"
import { createHash } from "node:crypto";
const pass = process.argv.slice(2).join(" ").trim();
if (!pass) {
  console.error('Usage: node scripts/hash-passcode.mjs "your passcode"');
  process.exit(1);
}
console.log(createHash("sha256").update(pass).digest("hex"));
