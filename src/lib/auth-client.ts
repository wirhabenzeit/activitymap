import { jwtClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Resolve the auth API relative to the current deployment. A shared absolute
// URL would allow a Preview client to send auth requests to Production.
// `jwtClient` adds `authClient.token()`: short-lived tokens for the Convex
// backend (src/lib/auth-jwt.ts).
export const authClient = createAuthClient({ plugins: [jwtClient()] });

// Export commonly used methods for convenience
export const { signIn, signOut, useSession } = authClient;
