"use client";

import React, { useContext } from "react";

import { Settings } from "lucide-react";

import { useStore } from "~/contexts/Zustand";

import { Separator } from "~/components/ui/separator";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShallow } from "zustand/shallow";

import statsPlots from "~/stats";
import { StatsContext, StatsProvider } from "./StatsContext";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type StatsPlotsKeys = keyof typeof statsPlots;
type TabKeys = `/stats/${StatsPlotsKeys}`;
type TabValue = { label: string; index: number };

const tabs = (Object.keys(statsPlots) as (keyof typeof statsPlots)[]).reduce(
  (acc, name, index) => ({
    ...acc,
    [`/stats/${name}`]: { label: name, index },
  }),
  {} as Record<TabKeys, TabValue>,
);

export default function Stats({ children }: { children: React.ReactNode }) {
  const { settingsOpen, toggleStatsSettings: toggleStatsSettings } = useStore(
    useShallow((state) => ({
      settingsOpen: state.statsSettingsOpen,
      toggleStatsSettings: state.toggleStatsSettings,
      setActiveStatsTab: state.setActiveStatsTab,
      activeStatsTab: state.activeStatsTab,
    })),
  );

  const pathname = usePathname();

  const { settingsRef, elementRef } = useContext(StatsContext);

  return (
    <div className="flex h-full min-h-0 w-full flex-col flex-nowrap overflow-hidden">
      <StatsProvider>
        <div className="flex w-full flex-shrink-0 items-stretch overflow-hidden border-b-2 border-muted">
          <div className="flex-1">
            {Object.entries(tabs).map(([url, tab]) => (
              <Button
                variant="link"
                key={url}
                className={
                  pathname === url
                    ? "capitalize text-header-background underline"
                    : "capitalize"
                }
              >
                <Link href={url}>{tab.label}</Link>
              </Button>
            ))}
          </div>
          <div className="m-l-auto right-0 inline-flex">
            <Separator orientation="vertical" />
            <Button
              variant="ghost"
              onClick={toggleStatsSettings}
              className="p-2"
            >
              <Settings
                className={settingsOpen ? "text-header-background" : ""}
              />
            </Button>
          </div>
        </div>
        <div ref={elementRef} className="min-h-0 w-full flex-grow">
          {children}
        </div>
        <div
          className={cn(
            "h-[60px] w-full overflow-y-hidden overflow-x-scroll border-t-2 border-muted",
            settingsOpen ? "block" : "hidden",
          )}
        >
          <div
            className="m-2 flex min-w-max flex-row flex-nowrap items-center justify-evenly space-x-2"
            ref={settingsRef}
          ></div>
        </div>
      </StatsProvider>
    </div>
  );
}
