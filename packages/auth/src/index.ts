import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { BridgeError, type Principal } from "@bridge/domain";
import {
  CompactEncrypt,
  compactDecrypt,
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly organizationExternalId: string;
}

export interface OidcAccessTokenConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly organizationClaim?: string;
  readonly jwksUri?: string;
}

export interface PrincipalDirectory {
  resolveOidcPrincipal(identity: OidcIdentity): Promise<Principal | undefined>;
}

export interface OidcConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly organizationClaim?: string;
  readonly loginOrganization?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly endSessionEndpoint?: string;
  readonly revocationEndpoint?: string;
  readonly jwksUri?: string;
  readonly cliClientId?: string;
  readonly cliRedirectUri?: string;
  readonly cliScopes?: readonly string[];
  readonly publicApiUrl: string;
  readonly publicWebUrl: string;
  readonly sessionSecret: string;
  readonly secureCookies?: boolean;
}

export interface WebLoginResult {
  readonly authorizationUrl: string;
  readonly transactionCookie: string;
}

export interface WebCallbackResult {
  readonly redirectUrl: string;
  readonly sessionCookie: string;
  readonly clearTransactionCookie: string;
}

export interface WebLogoutResult {
  readonly redirectUrl: string;
  readonly clearSessionCookie: string;
}

export interface AuthenticationProvider {
  readonly mode: "oidc";
  publicConfiguration(): Readonly<Record<string, string>>;
  authenticateRequest(input: {
    readonly authorization?: string;
    readonly cookie?: string;
  }): Promise<Principal>;
  beginWebLogin(returnTo?: string): Promise<WebLoginResult>;
  completeWebLogin(input: {
    readonly code?: string;
    readonly state?: string;
    readonly cookie?: string;
  }): Promise<WebCallbackResult>;
  endWebSession(returnTo?: string): WebLogoutResult;
}

interface LoginTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

interface SessionEnvelope {
  readonly accessToken: string;
  readonly expiresAt: number;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly id_token?: unknown;
  readonly expires_in?: unknown;
}

const transactionCookieName = "bridge_oidc_transaction";
const sessionCookieName = "bridge_session";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizedIssuer(value: string): string {
  return `${value.replace(/\/+$/, "")}/`;
}

function base64UrlRandom(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  options: { readonly maxAge: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

function safeReturnTo(candidate: string | undefined, publicWebUrl: string): string {
  const fallback = new URL(publicWebUrl);
  if (!candidate) return fallback.toString();
  try {
    const parsed = new URL(candidate, fallback);
    return parsed.origin === fallback.origin ? parsed.toString() : fallback.toString();
  } catch {
    return fallback.toString();
  }
}

function validateCliRedirectUri(value: string): void {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    throw new Error("BRIDGE_OIDC_CLI_REDIRECT_URI must be a valid URL.");
  }
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    Number(redirect.port) < 1 ||
    Number(redirect.port) > 65_535 ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  ) {
    throw new Error(
      "BRIDGE_OIDC_CLI_REDIRECT_URI must use http://127.0.0.1:<port>/<path> without credentials, query, or fragment.",
    );
  }
}

function accessTokenScopes(payload: JWTPayload): readonly string[] {
  if (payload.scope === undefined) return [];
  if (typeof payload.scope !== "string") {
    throw new BridgeError("UNAUTHENTICATED", "The access token has an invalid scope claim.", 401);
  }
  const scopes = [...new Set(payload.scope.split(/\s+/).filter(Boolean))];
  if (
    scopes.length > 100 ||
    scopes.some((scope) => scope.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(scope))
  ) {
    throw new BridgeError("UNAUTHENTICATED", "The access token has an invalid scope claim.", 401);
  }
  return scopes;
}

async function verifyAccessToken(
  token: string,
  configuration: OidcAccessTokenConfiguration,
  directory: PrincipalDirectory,
  jwks: JWTVerifyGetKey,
): Promise<Principal> {
  let payload: JWTPayload;
  const issuer = normalizedIssuer(configuration.issuer);
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: configuration.audience,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new BridgeError("UNAUTHENTICATED", "The access token is invalid or expired.", 401);
  }
  const organizationClaim = configuration.organizationClaim ?? "org_id";
  const organizationExternalId = payload[organizationClaim];
  if (!payload.sub || typeof organizationExternalId !== "string" || organizationExternalId.length === 0) {
    throw new BridgeError("UNAUTHENTICATED", "The access token is missing required identity claims.", 401);
  }
  const scopes = accessTokenScopes(payload);
  const principal = await directory.resolveOidcPrincipal({
    issuer,
    subject: payload.sub,
    organizationExternalId,
  });
  if (!principal) {
    throw new BridgeError("UNAUTHENTICATED", "No active organization membership was found.", 401);
  }
  const { scopes: _directoryScopes, ...principalWithoutScopes } = principal;
  if (principal.type === "human") {
    return scopes.length > 0 ? { ...principalWithoutScopes, scopes } : principalWithoutScopes;
  }
  return { ...principalWithoutScopes, scopes };
}

export class OidcAccessTokenVerifier {
  private readonly configuration: OidcAccessTokenConfiguration;
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    configuration: OidcAccessTokenConfiguration,
    private readonly directory: PrincipalDirectory,
    jwks?: JWTVerifyGetKey,
  ) {
    this.configuration = {
      ...configuration,
      issuer: normalizedIssuer(configuration.issuer),
      organizationClaim: configuration.organizationClaim ?? "org_id",
    };
    this.jwks = jwks ?? createRemoteJWKSet(new URL(
      configuration.jwksUri ?? `${this.configuration.issuer}.well-known/jwks.json`,
    ));
  }

  async authenticateAccessToken(token: string): Promise<Principal> {
    return verifyAccessToken(token, this.configuration, this.directory, this.jwks);
  }
}

function isLoginTransaction(value: unknown): value is LoginTransaction {
  return typeof value === "object" && value !== null &&
    "state" in value && typeof value.state === "string" &&
    "nonce" in value && typeof value.nonce === "string" &&
    "verifier" in value && typeof value.verifier === "string" &&
    "returnTo" in value && typeof value.returnTo === "string" &&
    "expiresAt" in value && typeof value.expiresAt === "number";
}

function isSessionEnvelope(value: unknown): value is SessionEnvelope {
  return typeof value === "object" && value !== null &&
    "accessToken" in value && typeof value.accessToken === "string" &&
    "expiresAt" in value && typeof value.expiresAt === "number";
}

export class OidcAuthenticator implements AuthenticationProvider {
  readonly mode = "oidc" as const;
  private readonly config: Required<Pick<OidcConfiguration, "organizationClaim" | "secureCookies">> & OidcConfiguration;
  private readonly key: Uint8Array;
  private readonly jwks: JWTVerifyGetKey;
  private readonly accessTokenVerifier: OidcAccessTokenVerifier;

  constructor(
    configuration: OidcConfiguration,
    private readonly directory: PrincipalDirectory,
    jwks?: JWTVerifyGetKey,
  ) {
    if (configuration.sessionSecret.length < 32) {
      throw new Error("BRIDGE_AUTH_SESSION_SECRET must contain at least 32 characters.");
    }
    if (Boolean(configuration.cliClientId) !== Boolean(configuration.cliRedirectUri)) {
      throw new Error("BRIDGE_OIDC_CLI_CLIENT_ID and BRIDGE_OIDC_CLI_REDIRECT_URI must be configured together.");
    }
    if (configuration.cliRedirectUri) validateCliRedirectUri(configuration.cliRedirectUri);
    this.config = {
      ...configuration,
      issuer: normalizedIssuer(configuration.issuer),
      organizationClaim: configuration.organizationClaim ?? "org_id",
      secureCookies: configuration.secureCookies ?? true,
    };
    this.key = createHash("sha256").update(configuration.sessionSecret).digest();
    this.jwks = jwks ?? createRemoteJWKSet(new URL(
      configuration.jwksUri ?? `${this.config.issuer}.well-known/jwks.json`,
    ));
    this.accessTokenVerifier = new OidcAccessTokenVerifier(
      {
        issuer: this.config.issuer,
        audience: this.config.audience,
        organizationClaim: this.config.organizationClaim,
        ...(this.config.jwksUri ? { jwksUri: this.config.jwksUri } : {}),
      },
      directory,
      this.jwks,
    );
  }

  publicConfiguration(): Readonly<Record<string, string>> {
    const configuration: Record<string, string> = {
      mode: "oidc",
      loginUrl: `${this.config.publicApiUrl.replace(/\/$/, "")}/v1/auth/login`,
      logoutUrl: `${this.config.publicApiUrl.replace(/\/$/, "")}/v1/auth/logout`,
    };
    if (this.config.cliClientId && this.config.cliRedirectUri) {
      configuration.cliClientId = this.config.cliClientId;
      configuration.cliAuthorizationEndpoint = this.config.authorizationEndpoint ?? `${this.config.issuer}authorize`;
      configuration.cliTokenEndpoint = this.config.tokenEndpoint ?? `${this.config.issuer}oauth/token`;
      configuration.cliRevocationEndpoint = this.config.revocationEndpoint ?? `${this.config.issuer}oauth/revoke`;
      configuration.cliAudience = this.config.audience;
      configuration.cliRedirectUri = this.config.cliRedirectUri;
      configuration.cliScopes = (this.config.cliScopes ?? ["openid", "profile", "email", "offline_access"]).join(" ");
      if (this.config.loginOrganization) configuration.cliOrganization = this.config.loginOrganization;
    }
    return configuration;
  }

  async authenticateRequest(input: {
    readonly authorization?: string;
    readonly cookie?: string;
  }): Promise<Principal> {
    const bearer = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const accessToken = bearer ?? await this.accessTokenFromSession(input.cookie);
    if (!accessToken) {
      throw new BridgeError("UNAUTHENTICATED", "Authentication is required.", 401);
    }
    return this.authenticateAccessToken(accessToken);
  }

  async authenticateAccessToken(token: string): Promise<Principal> {
    return this.accessTokenVerifier.authenticateAccessToken(token);
  }

  async beginWebLogin(returnTo?: string): Promise<WebLoginResult> {
    const state = base64UrlRandom();
    const nonce = base64UrlRandom();
    const verifier = base64UrlRandom(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const transaction: LoginTransaction = {
      state,
      nonce,
      verifier,
      returnTo: safeReturnTo(returnTo, this.config.publicWebUrl),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    };
    const authorizationUrl = new URL(
      this.config.authorizationEndpoint ?? `${this.config.issuer}authorize`,
    );
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: `${this.config.publicApiUrl.replace(/\/$/, "")}/v1/auth/callback`,
      audience: this.config.audience,
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(this.config.loginOrganization ? { organization: this.config.loginOrganization } : {}),
    }).toString();
    return {
      authorizationUrl: authorizationUrl.toString(),
      transactionCookie: serializeCookie(
        transactionCookieName,
        await this.encrypt(transaction),
        { maxAge: 600, secure: this.config.secureCookies },
      ),
    };
  }

  async completeWebLogin(input: {
    readonly code?: string;
    readonly state?: string;
    readonly cookie?: string;
  }): Promise<WebCallbackResult> {
    const encryptedTransaction = parseCookie(input.cookie, transactionCookieName);
    if (!encryptedTransaction || !input.code || !input.state) {
      throw new BridgeError("UNAUTHENTICATED", "The sign-in transaction is incomplete.", 401);
    }
    const transactionValue = await this.decrypt<unknown>(encryptedTransaction);
    if (!isLoginTransaction(transactionValue)) {
      throw new BridgeError("UNAUTHENTICATED", "The sign-in transaction is invalid.", 401);
    }
    const transaction = transactionValue;
    if (transaction.expiresAt < Math.floor(Date.now() / 1000) || !safeEqual(transaction.state, input.state)) {
      throw new BridgeError("UNAUTHENTICATED", "The sign-in state is invalid or expired.", 401);
    }

    const response = await fetch(this.config.tokenEndpoint ?? `${this.config.issuer}oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        code_verifier: transaction.verifier,
        redirect_uri: `${this.config.publicApiUrl.replace(/\/$/, "")}/v1/auth/callback`,
      }),
    });
    if (!response.ok) {
      throw new BridgeError("UNAUTHENTICATED", "The identity provider rejected the sign-in exchange.", 401);
    }
    const tokens = await response.json() as TokenResponse;
    if (typeof tokens.access_token !== "string" || typeof tokens.id_token !== "string") {
      throw new BridgeError("UNAUTHENTICATED", "The identity provider returned an incomplete token response.", 401);
    }
    let identitySubject: string;
    try {
      const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["nonce", "sub"],
      });
      if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, transaction.nonce)) {
        throw new Error("nonce mismatch");
      }
      identitySubject = payload.sub!;
    } catch {
      throw new BridgeError("UNAUTHENTICATED", "The identity token is invalid.", 401);
    }
    await this.authenticateAccessToken(tokens.access_token);
    const accessClaims = decodeJwt(tokens.access_token);
    if (accessClaims.sub !== identitySubject) {
      throw new BridgeError("UNAUTHENTICATED", "The identity and access tokens do not match.", 401);
    }
    const expiresAt = typeof accessClaims.exp === "number"
      ? accessClaims.exp
      : Math.floor(Date.now() / 1000) + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600);
    return {
      redirectUrl: transaction.returnTo,
      sessionCookie: serializeCookie(
        sessionCookieName,
        await this.encrypt<SessionEnvelope>({ accessToken: tokens.access_token, expiresAt }),
        { maxAge: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)), secure: this.config.secureCookies },
      ),
      clearTransactionCookie: serializeCookie(
        transactionCookieName,
        "",
        { maxAge: 0, secure: this.config.secureCookies },
      ),
    };
  }

  endWebSession(returnTo?: string): WebLogoutResult {
    const safeDestination = safeReturnTo(returnTo, this.config.publicWebUrl);
    const logout = new URL(this.config.endSessionEndpoint ?? `${this.config.issuer}v2/logout`);
    logout.search = new URLSearchParams({
      client_id: this.config.clientId,
      returnTo: safeDestination,
    }).toString();
    return {
      redirectUrl: logout.toString(),
      clearSessionCookie: serializeCookie(
        sessionCookieName,
        "",
        { maxAge: 0, secure: this.config.secureCookies },
      ),
    };
  }

  private async accessTokenFromSession(cookieHeader: string | undefined): Promise<string | undefined> {
    const encrypted = parseCookie(cookieHeader, sessionCookieName);
    if (!encrypted) return undefined;
    const envelopeValue = await this.decrypt<unknown>(encrypted);
    if (!isSessionEnvelope(envelopeValue)) {
      throw new BridgeError("UNAUTHENTICATED", "The authentication session is invalid.", 401);
    }
    const envelope = envelopeValue;
    if (envelope.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new BridgeError("UNAUTHENTICATED", "The session is expired.", 401);
    }
    return envelope.accessToken;
  }

  private async encrypt<T extends object>(value: T): Promise<string> {
    return new CompactEncrypt(encoder.encode(JSON.stringify(value)))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .encrypt(this.key);
  }

  private async decrypt<T>(value: string): Promise<T> {
    try {
      const { plaintext } = await compactDecrypt(value, this.key);
      return JSON.parse(decoder.decode(plaintext)) as T;
    } catch {
      throw new BridgeError("UNAUTHENTICATED", "The authentication session is invalid.", 401);
    }
  }
}

export function developmentAuthConfiguration(): Readonly<Record<string, string>> {
  return { mode: "development" };
}
