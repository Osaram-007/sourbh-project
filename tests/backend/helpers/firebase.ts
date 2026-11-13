/**
 * T1-03 (ADR-0003): a local JWKS server plus jose-minted Firebase-shaped ID tokens.
 *
 *   before(startJwks); after(stopJwks);
 *
 * startJwks() sets the env vars the verifier reads. Names come from ADR-0003: FIREBASE_JWKS_URL
 * (override of Google's JWKS URL) and FIREBASE_PROJECT_ID (issuer https://securetoken.google.com/<id>,
 * audience <id>).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload, type KeyLike } from "jose";

export const JWKS_ENV = "FIREBASE_JWKS_URL";
export const PROJECT_ID_ENV = "FIREBASE_PROJECT_ID";
export const TEST_PROJECT_ID = "fullcharge-test";
export const TEST_KID = "test-key-1";
export const issuerFor = (projectId: string) => `https://securetoken.google.com/${projectId}`;

type Pair = { publicKey: KeyLike; privateKey: KeyLike };
let keys: Promise<{ main: Pair; other: Pair }> | undefined;
const getKeys = () =>
  (keys ??= (async () => ({
    main: (await generateKeyPair("RS256")) as Pair,
    other: (await generateKeyPair("RS256")) as Pair, // never published: "signed with a different key"
  }))());

let server: http.Server | undefined;
let jwksUrl: string | undefined;

/** Start the JWKS server (127.0.0.1, free port) and point the verifier env vars at it. Idempotent. */
export async function startJwks(): Promise<string> {
  if (server && jwksUrl) return jwksUrl;
  const { main } = await getKeys();
  const jwk = { ...(await exportJWK(main.publicKey)), kid: TEST_KID, alg: "RS256", use: "sig" };
  const body = JSON.stringify({ keys: [jwk] });
  const s = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  server = s;
  jwksUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}/jwks.json`;
  process.env[JWKS_ENV] = jwksUrl;
  process.env[PROJECT_ID_ENV] = TEST_PROJECT_ID;
  return jwksUrl;
}

export async function stopJwks(): Promise<void> {
  const s = server;
  server = jwksUrl = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((ok) => s.close(() => ok()));
}

export const getJwksUrl = () => {
  if (!jwksUrl) throw new Error("startJwks() has not been called");
  return jwksUrl;
};

export interface MintOpts {
  projectId?: string; // default TEST_PROJECT_ID; sets both iss and aud
  issuer?: string;
  audience?: string;
  kid?: string; // default TEST_KID
  signWith?: "main" | "other";
  /** Seconds to add to "now" for exp (default +3600; negative = expired). */
  expiresInSec?: number;
}

/**
 * A Firebase-shaped ID token. Claim overrides win over the defaults; pass `undefined` to drop a claim.
 * Defaults: iss, aud, sub, user_id, auth_time (now), iat (now), exp (+1h), firebase.sign_in_provider "google.com".
 */
export async function mintIdToken(claims: JWTPayload & Record<string, unknown> = {}, o: MintOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const pid = o.projectId ?? TEST_PROJECT_ID;
  const sub = claims.sub ?? "test-uid-1";
  const payload: Record<string, unknown> = {
    sub,
    user_id: sub,
    auth_time: now,
    firebase: { sign_in_provider: "google.com", identities: {} },
    ...claims,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  const k = await getKeys();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: o.kid ?? TEST_KID, typ: "JWT" })
    .setIssuer(o.issuer ?? issuerFor(pid))
    .setAudience(o.audience ?? pid)
    .setIssuedAt(now)
    .setExpirationTime(now + (o.expiresInSec ?? 3600))
    .sign((o.signWith === "other" ? k.other : k.main).privateKey);
}

/** Negative variants. Each is otherwise valid. */
export const mintExpired = (c: JWTPayload = {}) => mintIdToken(c, { expiresInSec: -60 });
export const mintWrongAudience = (c: JWTPayload = {}) => mintIdToken(c, { audience: "some-other-project" });
export const mintWrongIssuer = (c: JWTPayload = {}) => mintIdToken(c, { issuer: issuerFor("some-other-project") });
export const mintUnknownKid = (c: JWTPayload = {}) => mintIdToken(c, { kid: "no-such-kid" });
export const mintWrongKey = (c: JWTPayload = {}) => mintIdToken(c, { signWith: "other" });

/** Hand-built unsigned token with alg "none". */
export function mintAlgNone(claims: JWTPayload = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: issuerFor(TEST_PROJECT_ID),
    aud: TEST_PROJECT_ID,
    sub: "test-uid-1",
    user_id: "test-uid-1",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com" },
    ...claims,
  })}.`;
}
