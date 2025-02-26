"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map } from "lucide-react";
import { cn } from "~/lib/utils";
import { useShallowStore } from "~/store";

export function MainNav() {
  const pathname = usePathname();
  const activeTab = useShallowStore((state) => state.activeTab);

  return (
    <div className="ml-2 mr-4 flex">
      <Link
        href="/"
        className={cn(
          "hover:text-header-foreground mr-4 flex items-center space-x-2 transition-colors lg:mr-6",
          pathname === "/map"
            ? "text-header-foreground"
            : "text-header-foreground/60",
        )}
      >
        <Map className="h-6 w-6" />
        <span className="hidden font-bold lg:inline-block">ActivityMap</span>
      </Link>
      <nav className="flex items-center gap-4 text-sm font-semibold lg:gap-6">
        <Link
          href="/list"
          className={cn(
            "hover:text-header-foreground transition-colors",
            pathname === "/list"
              ? "text-header-foreground"
              : "text-header-foreground/60",
          )}
        >
          List
        </Link>
        <Link
          href={activeTab}
          className={cn(
            "hover:text-header-foreground transition-colors",
            pathname?.startsWith("/stats")
              ? "text-header-foreground"
              : "text-header-foreground/60",
          )}
        >
          Stats
        </Link>
      </nav>
    </div>
  );
}
