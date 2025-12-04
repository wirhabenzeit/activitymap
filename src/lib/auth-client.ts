import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    plugins: [genericOAuthClient()],
});

// Export commonly used methods for convenience
export const { signIn, signOut, useSession } = authClient;
