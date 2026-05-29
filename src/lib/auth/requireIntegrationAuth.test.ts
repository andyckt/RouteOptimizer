import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/http/errors";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";

const ENV_KEY = "ROUTE_OPTIMIZER_INBOUND_TOKEN";

function requestWithAuth(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("https://example.com/api/integrations/runs/create-and-optimize", {
    headers,
  });
}

describe("requireIntegrationAuth", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedToken;
  });

  it("throws 503 when token is not configured", () => {
    delete process.env[ENV_KEY];
    assert.throws(
      () => requireIntegrationAuth(requestWithAuth(null)),
      (err: unknown) =>
        err instanceof ApiError &&
        err.statusCode === 503 &&
        err.code === "INTEGRATION_NOT_CONFIGURED"
    );
  });

  it("throws 503 when token is empty", () => {
    process.env[ENV_KEY] = "   ";
    assert.throws(
      () => requireIntegrationAuth(requestWithAuth(null)),
      (err: unknown) => err instanceof ApiError && err.statusCode === 503
    );
  });

  it("throws 401 when Authorization header is missing", () => {
    process.env[ENV_KEY] = "secret-token";
    assert.throws(
      () => requireIntegrationAuth(requestWithAuth(null)),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });

  it("throws 401 when Authorization header is malformed", () => {
    process.env[ENV_KEY] = "secret-token";
    assert.throws(
      () => requireIntegrationAuth(requestWithAuth("Token secret-token")),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });

  it("throws 401 when token is wrong", () => {
    process.env[ENV_KEY] = "secret-token";
    assert.throws(
      () => requireIntegrationAuth(requestWithAuth("Bearer wrong-token")),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });

  it("does not throw when Bearer token matches", () => {
    process.env[ENV_KEY] = "secret-token";
    assert.doesNotThrow(() =>
      requireIntegrationAuth(requestWithAuth("Bearer secret-token"))
    );
  });

  it("accepts Bearer prefix case-insensitively", () => {
    process.env[ENV_KEY] = "secret-token";
    assert.doesNotThrow(() =>
      requireIntegrationAuth(requestWithAuth("bearer secret-token"))
    );
  });
});
