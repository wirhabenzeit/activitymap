"use client";

import { usePathname, useRouter } from "next/navigation";
import { Map } from "lucide-react";
import { cn } from "~/lib/utils";
import { useShallowStore } from "~/store";

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = useShallowStore((state) => state.activeTab);

  const handleNavClick = (path: string) => {
    router.replace(path, { scroll: false });
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/' || pathname === '/map';
    if (path === '/list') return pathname === '/list';
    if (path === '/stats') return pathname?.startsWith('/stats');
    return false;
  };

  // Get current view from pathname for highlighting
  const getCurrentView = () => {
    if (pathname === '/list') return 'list';
    if (pathname?.startsWith('/stats')) return 'stats';
    return 'map'; // default to map for root path
  };

  const currentView = getCurrentView();

  return (
    <div className="ml-2 mr-4 flex">
      <button
        onClick={() => handleNavClick('/')}
        className={cn(
          "hover:text-header-foreground mr-4 flex items-center space-x-2 transition-colors lg:mr-6",
          currentView === 'map'
            ? "text-header-foreground"
            : "text-header-foreground/60",
        )}
      >
        <Map className="h-6 w-6" />
        <span className="hidden font-bold lg:inline-block">ActivityMap</span>
      </button>
      <nav className="flex items-center gap-4 text-sm font-semibold lg:gap-6">
        <button
          onClick={() => handleNavClick('/list')}
          className={cn(
            "hover:text-header-foreground transition-colors",
            currentView === 'list'
              ? "text-header-foreground"
              : "text-header-foreground/60",
          )}
        >
          List
        </button>
        <button
          onClick={() => handleNavClick(activeTab)}
          className={cn(
            "hover:text-header-foreground transition-colors",
            currentView === 'stats'
              ? "text-header-foreground"
              : "text-header-foreground/60",
          )}
        >
          Stats
        </button>
      </nav>
    </div>
  );
}
