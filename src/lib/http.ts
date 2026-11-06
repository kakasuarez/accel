import { NextResponse } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { LlmConfigError, LlmError } from "./llm/client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const failure = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** Turns anything a handler throws into a consistent JSON error. */
export function route<Context>(handler: (request: Request, context: Context) => Promise<Response>) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) return failure(error.status, error.code, error.message);
      if (error instanceof ZodError) return failure(400, "invalid_request", z.prettifyError(error));
      if (error instanceof LlmConfigError) {
        console.error(error);
        return failure(503, "llm_not_configured", "The assistant isn't available right now.");
      }
      if (error instanceof LlmError) {
        console.error(error);
        return failure(502, "llm_failed", "The assistant couldn't respond. Please try again.");
      }
      console.error(error);
      return failure(500, "server_error", "Something went wrong.");
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body: unknown = await request.json().catch(() => {
    throw new ApiError(400, "invalid_request", "The request body must be JSON.");
  });
  return schema.parse(body);
}
