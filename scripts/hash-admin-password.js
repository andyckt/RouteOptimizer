#!/usr/bin/env node
/**
 * Generate ADMIN_PASSWORD_HASH for .env
 * Usage: node scripts/hash-admin-password.js "yourPassword"
 */
const crypto = require("crypto");

const password = process.argv[2];
if (!password || password.length < 1) {
  console.error("Usage: node scripts/hash-admin-password.js \"yourPassword\"");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = "sha256";

crypto.pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST, (err, derived) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const hash = derived.toString("hex");
  console.log("Add this to your .env:");
  console.log(`ADMIN_PASSWORD_HASH=${salt}:${hash}`);
});
