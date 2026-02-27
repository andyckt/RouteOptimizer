/**
 * Server-side environment validation. Never import in client components.
 */

const required = [
  "MONGODB_URI",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_CLOUD_PROJECT_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "OPENPHONE_API_KEY",
  "OPENPHONE_FROM",
  "DRIVER_LINK_SECRET",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_SESSION_SECRET",
] as const;

type EnvVars = {
  [K in (typeof required)[number]]: string;
};

let _cached: EnvVars | null = null;

export function getServerEnv(): EnvVars {
  if (_cached) return _cached;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Create a file named .env (not .env.example) in the project root, copy variables from .env.example, add your values, then restart the dev server.`
    );
  }
  _cached = {
    MONGODB_URI: process.env.MONGODB_URI!,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY!,
    GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID!,
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
    OPENPHONE_API_KEY: process.env.OPENPHONE_API_KEY!,
    OPENPHONE_FROM: process.env.OPENPHONE_FROM!,
    DRIVER_LINK_SECRET: process.env.DRIVER_LINK_SECRET!,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH!,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET!,
  };
  return _cached;
}
