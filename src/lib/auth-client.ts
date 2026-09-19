import { createAuthClient } from 'better-auth/react';

// Resolve the auth API relative to the current deployment. A shared absolute
// URL would allow a Preview client to send auth requests to Production.
export const authClient = createAuthClient();

// Export commonly used methods for convenience
export const { signIn, signOut, useSession } = authClient;
