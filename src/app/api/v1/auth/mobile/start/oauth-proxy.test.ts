import assert from 'node:assert/strict';
import test from 'node:test';

import { betterAuth } from 'better-auth';
import { symmetricDecrypt } from 'better-auth/crypto';
import { oAuthProxy } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

import { parseMobileRedirectAllowlist } from '~/server/auth/mobile-redirect-allowlist.ts';
import { createMobileAuthStartHandler } from './handler.ts';

const PRODUCTION = 'https://activitymap.cc';
const DEPLOYMENT = 'activitymap-deployment.vercel.app';
const PREVIEW = 'https://activitymap-preview.vercel.app';
const PROXY_SECRET = 'mobile-oauth-proxy-regression-test-secret';

void test('mobile OAuth preserves its request origin instead of using VERCEL_URL', async (t) => {
  const previousDeployment = process.env.VERCEL_URL;
  process.env.VERCEL_URL = DEPLOYMENT;
  try {
    for (const origin of [PRODUCTION, PREVIEW]) {
      await t.test(origin === PRODUCTION ? 'production skips the preview proxy' : 'preview returns to its own origin', async () => {
        const auth = betterAuth({
          secret: 'mobile-auth-regression-test-secret-with-enough-length',
          baseURL: {
            allowedHosts: ['activitymap.cc', '*.vercel.app'],
            fallback: PRODUCTION,
            protocol: 'https',
          },
          logger: { disabled: true },
          plugins: [
            genericOAuth({
              config: [{
                providerId: 'strava',
                authorizationUrl: 'https://www.strava.com/oauth/authorize',
                tokenUrl: 'https://www.strava.com/oauth/token',
                clientId: 'test-client',
                clientSecret: 'test-secret',
                pkce: false,
              }],
            }),
            oAuthProxy({ productionURL: PRODUCTION, secret: PROXY_SECRET }),
          ],
        });
        const GET = createMobileAuthStartHandler({
          loadRedirectAllowlist: () => parseMobileRedirectAllowlist('activitymap-dev://auth/callback'),
          startSocialSignIn: async ({ callbackURL, errorCallbackURL, headers, request }) => {
            const response = await auth.api.signInSocial({
              body: { provider: 'strava', callbackURL, errorCallbackURL },
              headers,
              request,
              asResponse: true,
            });
            const body = await response.json() as { url: string };
            return { url: body.url, headers: response.headers };
          },
        });
        const request = new Request(`${origin}/api/v1/auth/mobile/start?state=mobile-state&code_challenge=challenge&redirect_uri=activitymap-dev%3A%2F%2Fauth%2Fcallback`, {
          headers: { host: new URL(origin).host },
        });
        const response = await GET(request);
        assert.equal(response.status, 302);
        assert.ok(response.headers.getSetCookie().length > 0);
        const authorization = new URL(response.headers.get('location') ?? '');
        assert.equal(authorization.origin, 'https://www.strava.com');
        assert.equal(authorization.searchParams.get('redirect_uri'), `${PRODUCTION}/api/auth/callback/strava`);
        const state = authorization.searchParams.get('state');
        assert.ok(state);
        if (origin === PRODUCTION) {
          // A normal state is opaque random text, not an encrypted proxy package.
          await assert.rejects(symmetricDecrypt({ key: PROXY_SECRET, data: state }));
        } else {
          const proxy = JSON.parse(await symmetricDecrypt({ key: PROXY_SECRET, data: state })) as { isOAuthProxy: boolean; stateCookie: string };
          assert.equal(proxy.isOAuthProxy, true);
          const stored = JSON.parse(await symmetricDecrypt({ key: PROXY_SECRET, data: proxy.stateCookie })) as { callbackURL: string };
          const callback = new URL(stored.callbackURL);
          assert.equal(callback.origin, PREVIEW);
          assert.equal(callback.pathname, '/api/auth/callback/strava/oauth-proxy');
          const mobileCallback = new URL(callback.searchParams.get('callbackURL') ?? '');
          assert.equal(mobileCallback.origin, PREVIEW);
          assert.equal(mobileCallback.pathname, '/api/v1/auth/mobile/callback');
          assert.equal(mobileCallback.searchParams.get('state'), 'mobile-state');
        }
      });
    }
  } finally {
    if (previousDeployment === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previousDeployment;
  }
});
