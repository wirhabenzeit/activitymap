"use client";

import { ComponentType } from "react";

import {
  LucideProps,
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  MoreHorizontal,
} from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from "~/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import { useStore } from "~/contexts/Zustand";
import { useShallow } from "zustand/shallow";

import * as React from "react";
import { useState } from "react";
import { categorySettings } from "~/settings/category";

type DropdownProps = {
  title: string;
  values: string[];
  Icon: ComponentType<LucideProps>;
  color: string;
};

export function DropdownMenuCheckboxes({
  title,
  values,
  Icon,
  color,
  onToggle,
  onChange,
  active,
}: DropdownProps) {
  const [selected, setSelected] = useState(
    Object.fromEntries(values.map((key) => [key, true])),
  );
  React.useEffect(() => {
    onChange(
      Object.entries(selected)
        .filter(([v, a]) => a)
        .map(([v, a]) => v),
    );
  }, [selected]);
  const onClick = () => {
    setSelected((selected) =>
      Object.fromEntries(Object.keys(selected).map((key) => [key, !active])),
    );
    onToggle();
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a onClick={onClick} href="#">
          {active ? (
            <Icon color={color} />
          ) : (
            <Icon className="text-foreground/60" />
          )}
          <span className={active ? "text-foreground" : "text-foreground/60"}>
            {title}
          </span>
        </a>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          {values.map((key) => (
            <DropdownMenuCheckboxItem
              checked={selected[key]}
              key={key}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() =>
                setSelected((selected) => ({
                  ...selected,
                  [key]: !selected[key],
                }))
              }
            >
              {key}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function CategoryFilter() {
  const { updateCategory, toggleCategory, categories } = useStore(
    useShallow((state) => ({
      updateCategory: state.updateCategory,
      toggleCategory: state.toggleCategory,
      categories: state.categories,
    })),
  );

  return (
    <SidebarMenu>
      {Object.entries(categorySettings).map(
        ([id, { name, color, icon, alias }]) => (
          <DropdownMenuCheckboxes
            values={alias}
            color={color}
            title={name}
            key={id}
            Icon={icon}
            active={categories[id].active}
            onToggle={() => toggleCategory(id)}
            onChange={(v) => updateCategory(id, v)}
          />
        ),
      )}
    </SidebarMenu>
  );
}
