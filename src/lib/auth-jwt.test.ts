import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { jwt, testUtils } from 'better-auth/plugins';
import test from 'node:test';

import { CONVEX_TOKEN_AUDIENCE, convexJwtOptions } from './auth-jwt';

const issuer = 'https://test.activitymap.cc';

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

void test('Convex tokens stay off until an issuer is configured', () => {
  assert.equal(convexJwtOptions({}), null);
  assert.equal(convexJwtOptions({ ACTIVITYMAP_AUTH_JWT_ISSUER: '  ' }), null);
});

void test('a session yields an ES256 token Convex can verify, carrying only the user ID', async () => {
  const options = convexJwtOptions({ ACTIVITYMAP_AUTH_JWT_ISSUER: issuer })!;
  const auth = betterAuth({
    secret: 'test-secret-for-convex-token-round-trip',
    baseURL: 'http://localhost:3000',
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
    }),
    plugins: [jwt(options), testUtils()],
  });
  const context = await auth.$context;
  const user = await context.test.saveUser(
    context.test.createUser({ email: 'rider@example.com', name: 'A Rider' }),
  );
  const { headers } = await context.test.login({ userId: user.id });

  const { token } = await auth.api.getToken({ headers });
  const { keys } = await auth.api.getJwks();
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = decode(headerPart!);
  const payload = decode(payloadPart!);

  // What Convex's customJwt provider checks: algorithm, key ID, signature,
  // issuer, audience and expiry.
  assert.equal(header.alg, 'ES256');
  const jwk = keys.find((key) => key.kid === header.kid);
  assert(jwk, 'the JWKS publishes the signing key');
  assert(
    verify(
      'sha256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      {
        key: createPublicKey({ key: jwk, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(signaturePart!, 'base64url'),
    ),
  );
  assert.equal(payload.iss, issuer);
  assert.equal(payload.aud, CONVEX_TOKEN_AUDIENCE);
  assert.equal(payload.sub, user.id);
  assert.equal(Number(payload.exp) - Number(payload.iat), 15 * 60);
  // No profile data (email, name, image) travels in the token.
  assert.deepEqual(Object.keys(payload).sort(), [
    'aud',
    'exp',
    'iat',
    'iss',
    'sub',
  ]);
});
