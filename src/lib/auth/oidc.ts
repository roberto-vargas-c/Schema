import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { db } from "../db";
import { APP_URL } from "../mail";
import { open } from "./secretBox";

/** A configured OpenID Connect provider: Google, or one workspace's SSO. */
export type OidcProvider = { id: string; issuer: string; clientId: string; clientSecret: string; workspaceId?: string };

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const FLOW_COOKIE = "schema_oidc";
export const CALLBACK_PATH = "/api/auth/oidc/callback";
export const callbackUrl = () => `${APP_URL()}${CALLBACK_PATH}`;

export function googleProvider(): OidcProvider | null {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  // GOOGLE_ISSUER is only for tests against a stand-in provider.
  return { id: "google", issuer: process.env.GOOGLE_ISSUER ?? "https://accounts.google.com", clientId, clientSecret };
}

export async function ssoProvider(workspaceId: string): Promise<OidcProvider | null> {
  const s = await db.workspaceSso.findUnique({ where: { workspaceId } });
  if (!s?.enabled) return null;
  return { id: `sso:${workspaceId}`, issuer: s.issuer, clientId: s.clientId, clientSecret: open(s.clientSecretEnc), workspaceId };
}

export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit.doc;
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  // Workers only accept "follow" or "manual" here ("error" throws), so a redirect is refused by hand.
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "manual" });
  if (res.status >= 300 && res.status < 400) throw new Error(`${url} redirected; use the issuer's exact address`);
  if (!res.ok) throw new Error(`Couldn't read ${url} (${res.status})`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error("The issuer's discovery document is incomplete");
  if (doc.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw new Error("The discovery document names a different issuer");
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

const b64url = (b: Buffer) => b.toString("base64url");
const secretKey = () => new TextEncoder().encode(`oidc-state:${process.env.AUTH_SECRET}`);

export type FlowState = { provider: string; state: string; nonce: string; verifier: string; next: string };

/** Build the authorization redirect and the signed state to keep in a short-lived cookie. */
export async function beginLogin(p: OidcProvider, next: string, loginHint?: string) {
  const d = await discover(p.issuer);
  const flow: FlowState = {
    provider: p.id, next,
    state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)),
  };
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: p.clientId, redirect_uri: callbackUrl(), scope: "openid email profile",
    state: flow.state, nonce: flow.nonce,
    code_challenge: b64url(createHash("sha256").update(flow.verifier).digest()), code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
    ...(p.id === "google" ? { prompt: "select_account" } : {}),
  }).toString();
  const cookie = await new SignJWT({ ...flow }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(secretKey());
  return { url: url.toString(), cookie };
}

export async function readFlowCookie(cookie: string | undefined): Promise<FlowState | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, secretKey());
    return payload as unknown as FlowState;
  } catch {
    return null;
  }
}

export type OidcClaims = JWTPayload & { email?: string; email_verified?: boolean | string; name?: string; given_name?: string };

/** Exchange the authorization code and verify the ID token (signature, issuer, audience, nonce). */
export async function finishLogin(p: OidcProvider, flow: FlowState, code: string): Promise<OidcClaims> {
  const d = await discover(p.issuer);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: callbackUrl(),
      client_id: p.clientId, client_secret: p.clientSecret, code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.id_token !== "string") throw new Error(body.error_description ?? body.error ?? "The sign-in provider refused the code");
  let jwks = jwksCache.get(d.jwks_uri);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(d.jwks_uri)); jwksCache.set(d.jwks_uri, jwks); }
  const { payload } = await jwtVerify(body.id_token, jwks, { issuer: d.issuer, audience: p.clientId, clockTolerance: 60 });
  if (payload.nonce !== flow.nonce) throw new Error("Sign-in response didn't match this browser");
  return payload as OidcClaims;
}
