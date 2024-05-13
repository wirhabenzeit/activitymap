import "./global.css";

import {AppRouterCacheProvider} from "@mui/material-nextjs/v13-appRouter";
import {ThemeProvider} from "@mui/material/styles";
import {Box, CssBaseline} from "@mui/material";
import theme from "../theme";
import SideBar from "~/components/SideBar";
import MainContainer from "~/components/MainContainer";
import Header from "~/components/Header";
import {DrawerHeader} from "~/components/Drawer";
import {auth} from "~/auth";
import {db} from "~/server/db";
import type {User} from "~/server/db/schema";
import {Analytics} from "@vercel/analytics/react";
import {SpeedInsights} from "@vercel/speed-insights/next";

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
        <Analytics />
        <SpeedInsights />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <Box
              sx={{
                width: "100dvw",
                height: "100dvh",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <CssBaseline />
              <Header />
              <Box
                sx={{
                  width: "100dvw",
                  flexGrow: 1,
                  display: "flex",
                  flexDirection: "row",
                }}
              >
                <SideBar />
                <Box
                  sx={{
                    overflow: "hidden",
                    flexGrow: 1,
                    p: 0,
                    height: "100dvh",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <DrawerHeader />
                  <Box
                    sx={{
                      width: "100%",
                      minHeight: 0,
                      minWidth: 0,
                      overflow: "hidden",
                      flexGrow: 1,
                    }}
                  >
                    <MainContainer
                      account={account}
                      user={user as User}
                    >
                      {children}
                    </MainContainer>
                  </Box>
                </Box>
              </Box>
            </Box>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
