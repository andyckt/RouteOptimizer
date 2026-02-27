/**
 * Assert that a module is only ever imported server-side.
 * Use this to wrap modules that use secrets or Node-only APIs.
 */
export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("This module must only be used on the server");
  }
}
