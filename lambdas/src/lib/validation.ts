import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ZodError, ZodType } from 'zod';
import { jsonResponse } from './http';

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: APIGatewayProxyStructuredResultV2 };

/** Parses `body` as JSON and validates it against `schema`, in one 400-on-failure step. */
export function parseJsonBody<T>(schema: ZodType<T>, body: string | null | undefined): ValidationResult<T> {
  let raw: unknown;
  try {
    raw = body ? JSON.parse(body) : {};
  } catch {
    return { success: false, response: jsonResponse(400, { message: 'Request body must be valid JSON' }) };
  }

  return validate(schema, raw);
}

/** Validates path/query parameters (which arrive as a string map) against `schema`. */
export function parseParams<T>(
  schema: ZodType<T>,
  params: Record<string, string | undefined> | undefined
): ValidationResult<T> {
  return validate(schema, params ?? {});
}

function validate<T>(schema: ZodType<T>, raw: unknown): ValidationResult<T> {
  const result = schema.safeParse(raw);

  if (!result.success) {
    return {
      success: false,
      response: jsonResponse(400, { message: 'Validation failed', errors: formatIssues(result.error) }),
    };
  }

  return { success: true, data: result.data };
}

function formatIssues(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}
