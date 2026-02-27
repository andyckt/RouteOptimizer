/**
 * Admin session verification for Edge runtime (middleware).
 * Uses only Web Crypto API - no Node.js dependencies.
 */

const SESSION_COOKIE_NAME = "admin_session";

function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET required");
  return s;
}

async function verifyHmac(payloadB64: string, expectedSigHex: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (sigHex.length !== expectedSigHex.length) return false;
  let diff = 0;
  for (let i = 0; i < sigHex.length; i++) {
    diff |= sigHex.charCodeAt(i) ^ expectedSigHex.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyAdminSessionEdge(cookieValue: string | null | undefined): Promise<boolean> {
  if (!cookieValue || typeof cookieValue !== "string") return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return false;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!payloadB64 || !sig) return false;

  let payload: { admin?: boolean; exp?: number };
  try {
    let b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    b64 += "==".slice(0, (4 - (b64.length % 4)) % 4);
    const decoded = atob(b64);
    payload = JSON.parse(decoded);
  } catch {
    return false;
  }

  if (payload.admin !== true || typeof payload.exp !== "number") return false;
  if (payload.exp < Date.now()) return false;

  return verifyHmac(payloadB64, sig, getSecret());
}

export { SESSION_COOKIE_NAME };
