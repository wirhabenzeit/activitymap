'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type ComponentType } from 'react';

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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Edit } from 'lucide-react';
import { type Row } from '@tanstack/react-table';
import { type Activity } from '~/server/db/schema';
import { type UpdatableActivity, type SportType } from '~/server/strava/types';
import { sportType } from 'drizzle/schema';
import { Select } from '../ui/select';
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { aliasMap, colorMap, iconMap } from '~/settings/category';
import { useShallowStore } from '~/store';

const formSchema = z.object({
  name: z.string().min(2, {
    message: 'Activity name must be at least 2 characters long',
  }),
  description: z.string(),
  sportType: z.custom<SportType>(),
});

type FormValues = z.infer<typeof formSchema>;

type ActivityTypeInfo = {
  name: SportType;
  Icon: ComponentType<{ className?: string; style?: { color: string } }>;
  color: string;
  group: string;
};

import { updateActivity } from '~/server/strava/actions';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '~/hooks/use-toast';
import { useState } from 'react';

export function ProfileForm({
  row,
  setOpen,
}: {
  row: Row<Activity>;
  setOpen?: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // We removed updateActivity from the store, so no need to select it
  const { account } = useShallowStore((state) => ({
    account: state.account,
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row.original.name,
      description: row.original.description ?? '',
      sportType: row.original.sport_type,
    },
  });

  async function onSubmit(values: FormValues) {
    if (!account) return;
    setLoading(true);
    try {
      const activityUpdate: UpdatableActivity = {
        name: values.name,
        sport_type: values.sportType,
        id: row.original.id,
        athlete: row.original.athlete,
        ...(values.description && { description: values.description }),
      };

      await updateActivity(activityUpdate, {
        access_token: account.access_token!,
        providerAccountId: account.providerAccountId,
      });

      await queryClient.invalidateQueries({ queryKey: ['activities'] });

      toast({
        title: 'Activity Updated',
        description: 'Changes have been saved to Strava and local database.',
      });

      setOpen?.(false);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to update activity.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const activtyTypes = sportType.enumValues
    .filter(
      (value): value is SportType =>
        value in iconMap && value in aliasMap && value in colorMap,
    )
    .map(
      (value): ActivityTypeInfo => ({
        name: value,
        Icon: iconMap[value]!,
        color: colorMap[value]!,
        group: aliasMap[value]!,
      }),
    )
    .sort((a, b) => a.group.localeCompare(b.group));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder={row.getValue('name')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder={row.getValue('description')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
  const isGuest = useShallowStore((state) => state.isGuest);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger asChild>
          <Button
            variant={'ghost'}
            size={'sm'}
            className="p-1"
            disabled={isGuest}
          >
            <Edit className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>
            Make changes to your activity here.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm row={row} setOpen={setOpen} />
      </DialogContent>
    </Dialog>
  );
}
