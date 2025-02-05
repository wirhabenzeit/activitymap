'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '~/components/ui/form';
import { Input } from '~/components/ui/input';

const formSchema = z.object({
  name: z.string().min(2, {
    message: 'Activity name must be at least 2 characters long',
  }),
  description: z.string(),
  sportType: z.enum(sportType.enumValues),
});

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Edit } from 'lucide-react';
import { Row } from '@tanstack/react-table';
import { Activity } from '~/server/db/schema';
import { UpdatableActivity } from '~/server/strava/actions';
import { sportType } from 'drizzle/schema';
import { Select } from '../ui/select';
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { aliasMap, colorMap, iconMap } from '~/settings/category';
import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';

export function ProfileForm({ row }: { row: Row<Activity> }) {
  const [updateActivity, loading] = useStore(
    useShallow((state) => [state.updateActivity, state.loading]),
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row.original.name,
      description: row.original.description || '',
      sportType: row.original.sport_type,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    const activityUpdate: UpdatableActivity = {
      name: values.name,
      sport_type: values.sportType,
      id: row.original.id,
      athlete: row.original.athlete,
      ...(values.description && { description: values.description }),
    };
    const newActivity = await updateActivity(activityUpdate);
  }
  const activtyTypes = sportType.enumValues
    .map((value) => ({
      name: value,
      Icon: iconMap[value],
      color: colorMap[value],
      alias: aliasMap[value],
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {[
          { name: 'name', label: 'Name' },
          { name: 'description', label: 'Description' },
        ].map(({ name, label }) => (
          <FormField
            control={form.control}
            name={name}
            key={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  <Input placeholder={row.getValue(name)} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <FormField
          control={form.control}
          name="sportType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sport type</FormLabel>
              <Select
                defaultValue={row.original.sport_type}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {activtyTypes.map(({ name, Icon, color }) => (
                    <SelectItem key={name} value={name}>
                      <div className="flex items-center space-x-2">
                        <Icon className="size-4" style={{ color }} />
                        <span>{name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={loading || !form.formState.isDirty}>
          {loading ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </Form>
  );
}

export function EditActivity({
  row,
  open,
  setOpen,
  trigger = true,
}: {
  row: Row<Activity>;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  trigger: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger asChild>
          <Button variant={'ghost'} size={'sm'} className="p-1">
            <Edit className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit actity</DialogTitle>
          <DialogDescription>
            Make changes to your activity here.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm row={row} />
        {/* <DialogFooter>
          <Button type="submit">Save changes</Button>
        </DialogFooter> */}
      </DialogContent>
    </Dialog>
  );
}
