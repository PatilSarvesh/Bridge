import type { Principal } from "@bridge/domain";
import { BridgeError } from "@bridge/domain";
import type { Response } from "express";

export interface McpAccessTokenVerifier {
  authenticateAccessToken(token: string): Promise<Principal>;
}

export interface McpRequestLike {
  header(name: string): string | undefined;
}

export interface McpPrincipalResolutionOptions {
  readonly verifier?: McpAccessTokenVerifier;
  readonly developmentPrincipal?: Principal;
  readonly production: boolean;
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

export async function resolveMcpPrincipal(
  request: McpRequestLike,
  options: McpPrincipalResolutionOptions,
): Promise<Principal> {
  if (options.verifier) {
    const token = bearerToken(request.header("authorization"));
    if (!token) {
      throw new BridgeError("UNAUTHENTICATED", "A bearer token is required for the MCP endpoint.", 401);
    }
    return options.verifier.authenticateAccessToken(token);
  }
  if (options.production) {
    throw new BridgeError(
      "IDENTITY_NOT_CONFIGURED",
      "MCP authentication is required in production.",
      503,
    );
  }
  if (!options.developmentPrincipal) {
    throw new BridgeError("UNAUTHENTICATED", "No local MCP principal is configured.", 401);
  }
  return options.developmentPrincipal;
}

export function sendMcpAuthenticationError(
  response: Response,
  error: unknown,
  resourceMetadataUrl?: string,
): void {
  const bridgeError = error instanceof BridgeError ? error : undefined;
  const statusCode = bridgeError?.statusCode ?? 500;
  if (statusCode === 401 && resourceMetadataUrl) {
    response.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
  }
  const body = bridgeError
    ? {
        error: bridgeError.code,
        error_description: bridgeError.message,
        ...(bridgeError.details ? { details: bridgeError.details } : {}),
      }
    : { error: "INTERNAL_ERROR", error_description: "An unexpected error occurred." };
  response.status(statusCode).json(body);
}
