export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string, code?: string): ApiError {
  return new ApiError(400, message, code ?? "BAD_REQUEST");
}

export function notFound(message: string): ApiError {
  return new ApiError(404, message, "NOT_FOUND");
}

export function validationError(message: string): ApiError {
  return new ApiError(422, message, "VALIDATION_ERROR");
}

export function unauthorized(message: string): ApiError {
  return new ApiError(401, message, "UNAUTHORIZED");
}
