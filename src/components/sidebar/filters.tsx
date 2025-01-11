'use client';

import { ComponentType } from 'react';

import { LucideProps, MoreHorizontal } from 'lucide-react';

import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';

import * as React from 'react';
import { categorySettings } from '~/settings/category';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from '~/components/ui/sidebar';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '~/components/ui/dropdown-menu';

import { MonthRangePicker } from '~/components/ui/monthrangepicker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { CalendarIcon } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

import { format } from 'date-fns/format';

import { useState } from 'react';
import { cn } from '~/lib/utils';

import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { Mountain, Briefcase } from 'lucide-react';

import { binaryFilters, inequalityFilters } from '~/settings/filter';
import { Switch } from '../ui/switch';
import { Toggle } from '../ui/toggle';
import { Checkbox } from '../ui/checkbox';

type DropdownProps = {
  title: string;
  values: string[];
  Icon: ComponentType<LucideProps>;
  color: string;
  onToggle: () => void;
  onChange: (values: string[]) => void;
  active: boolean;
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
  console.log(title, active, values);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a onClick={onClick} href="#">
          {active ? (
            <Icon color={color} />
          ) : (
            <Icon className="text-foreground/60" />
          )}
          <span className={active ? 'text-foreground' : 'text-foreground/60'}>
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
            active={categories[id as keyof typeof categories].active}
            onToggle={() => toggleCategory(id as keyof typeof categories)}
            onChange={(v) => updateCategory(id as keyof typeof categories, v)}
          />
        ),
      )}
    </SidebarMenu>
  );
}

export function InequalityFilter({
  name,
}: {
  name: keyof typeof inequalityFilters;
}) {
  const [greater, setGreater] = useState(true);
  const [input, setInput] = useState('');
  const [value, setValue] = useState(0.0);

  const validateInput = (value: string) => {
    const number = parseFloat(value);
    const valid = !isNaN(value);
    if (valid) {
      setInput(value);
      setValue(isNaN(number) ? 0 : number);
    }
  };

  const [setValueFilter, values, filterRanges] = useStore(
    useShallow((state) => [
      state.setValueFilter,
      state.values,
      state.filterRanges,
    ]),
  );

  React.useEffect(() => {
    if (!filterRanges[name]) return;
    const transformed = inequalityFilters[name].transform(value);
    if (greater) setValueFilter(name, [transformed, filterRanges[name][1]]);
    else setValueFilter(name, [filterRanges[name][0], transformed]);
  }, [greater, value]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="pr-0">
        <div>
          {inequalityFilters[name].icon}
          <span className="relative flex w-full items-center">
            <Button
              className="absolute left-1 h-6 w-6 px-1 py-1 text-foreground/60"
              variant="secondary"
              onClick={() => setGreater((greater) => !greater)}
            >
              {greater ? '≥' : '≤'}
            </Button>
            <Input
              value={input}
              placeholder="0"
              onChange={(event) => validateInput(event.target.value)}
              className="h-8 w-full pl-8 pr-8 text-right focus-visible:bg-background focus-visible:ring-0"
            />
            <span className="absolute right-2 py-1 text-foreground/60">
              {inequalityFilters[name].unit}
            </span>
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function MonthPicker() {
  const [dates, setDates] = useStore(
    useShallow((state) => [state.dateRange, state.setDateRange]),
  );

  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton className={cn(!dates && 'text-muted-foreground')}>
            <CalendarIcon />
            {dates ? (
              `${format(dates.start, 'MMM yyyy')} - ${format(dates.end, 'MMM yyyy')}`
            ) : (
              <span>Pick a month range</span>
            )}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <MonthRangePicker
            onMonthRangeSelect={setDates}
            selectedMonthRange={dates}
          />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

export function BinaryFilter({ name }: { name: keyof typeof binaryFilters }) {
  const [value, setBinary] = useStore(
    useShallow((state) => [state.binary[name], state.setBinary]),
  );

  return (
    <SidebarMenuItem className="flex items-center gap-4 h-8 mx-2">
      {binaryFilters[name].icon}
      <label
        htmlFor="terms"
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {binaryFilters[name].label}
      </label>
      <Checkbox
        checked={value == undefined ? 'indeterminate' : value}
        onClick={() => setBinary(name, value == undefined ? true : !value)}
      />
    </SidebarMenuItem>
  );
}
