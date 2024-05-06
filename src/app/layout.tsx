import "./global.css";

import {AppRouterCacheProvider} from "@mui/material-nextjs/v13-appRouter";
import {ThemeProvider} from "@mui/material/styles";
import {Box, CssBaseline} from "@mui/material";
import theme from "../theme";
import SideBar from "~/components/SideBar";
import MainContainer from "~/components/MainContainer";
import Header from "~/components/Header";
import {auth} from "~/auth";
import {db} from "~/server/db";

export const metadata = {
  title: "Activity Map",
  description: "A map of Strava activities",
  icons: [{rel: "icon", url: "/favicon.ico"}],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user =
    session && "user" in session ? session.user : undefined;
  const account =
    user && "id" in user
      ? await db.query.accounts.findFirst({
          where: (accounts, {eq}) =>
            eq(accounts.userId, user.id!),
        })
      : undefined;

  return (
    <html lang="en">
      <head>
        <meta
          name="apple-mobile-web-app-capable"
          content="yes"
        />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="#1976d2"
        />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <Box
              sx={{
                width: "100vw",
                height: "100vh",
              }}
            >
              <CssBaseline />
              <Header
                user={user ? user : undefined}
                account={account}
              />
              <Box
                sx={{
                  width: "100vw",
                  height: "100vh",
                }}
              >
                <SideBar />
                <MainContainer account={account}>
                  {children}
                </MainContainer>
              </Box>
            </Box>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
