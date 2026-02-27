import { NextResponse } from "next/server";
import { ApiError } from "./errors";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode }
    );
  }
  console.error(err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json(
    { error: message },
    { status: 500 }
  );
}
