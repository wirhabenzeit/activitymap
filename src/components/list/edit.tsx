'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type Row } from '@tanstack/react-table';
import { Edit } from 'lucide-react';
import { type ComponentType } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
} from '~/components/app-dialog';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useToast } from '~/hooks/use-toast';
import { reloadStreamSummaryActivity } from '~/lib/activity-stream-summary';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { type Activity, sportTypeEnum } from '~/server/db/schema';
import { updateActivity } from '~/server/strava/actions';
import { type SportType } from '~/server/strava/types';
import { type UpdateActivityInput } from '~/server/strava/validators';
import { aliasMap, colorMap, iconMap } from '~/settings/category';
import { useShallowStore } from '~/store';

import { Select } from '../ui/select';
import { type Features } from './table-extensions';

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

export function ProfileForm({
  row,
  setOpen,
}: {
  row: Row<Features, Activity>;
  setOpen?: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userId = useShallowStore((state) => state.user?.id);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row.original.name,
      description: row.original.description ?? '',
      sportType: row.original.sport_type,
    },
  });

  async function onSubmit(values: FormValues) {
    const isCurrent = () => {
      const state = useShallowStore.getState();
      return !!userId && state.user?.id === userId && !state.isGuest;
    };
    if (!isCurrent()) return;
    setLoading(true);
    try {
      const activityUpdate: UpdateActivityInput = {
        name: values.name,
        sport_type: values.sportType,
        id: row.original.id,
        ...(values.description && { description: values.description }),
      };

      await updateActivity(activityUpdate);
      if (!userId || !isCurrent()) return;

      if (userId) {
        await reloadStreamSummaryActivity(
          queryClient,
          userId,
          String(row.original.id),
        );
      }

      if (userId)
        await requestLibrarySync(
          queryClient,
          authenticatedLibraryScope(userId),
        );
      if (!isCurrent()) return;

      toast({
        title: 'Activity Updated',
        description: 'Changes have been saved to Strava and local database.',
      });

      setOpen?.(false);
    } catch (error) {
      if (!isCurrent()) return;
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

  const activtyTypes = sportTypeEnum.enumValues
    .filter(
      (value): value is SportType =>
        value in iconMap && value in aliasMap && value in colorMap,
    )
    .map((value): ActivityTypeInfo => ({
      name: value,
      Icon: iconMap[value]!,
      color: colorMap[value]!,
      group: aliasMap[value]!,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <AppDialogBody className="space-y-8">
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
        </AppDialogBody>
        <AppDialogFooter>
          <Button type="submit" disabled={loading || !form.formState.isDirty}>
            {loading ? 'Saving...' : 'Save changes'}
          </Button>
        </AppDialogFooter>
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
  row: Row<Features, Activity>;
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
      <AppDialogContent closeLabel="Close Edit activity" layout="sections">
        <AppDialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>
            Make changes to your activity here.
          </DialogDescription>
        </AppDialogHeader>
        <ProfileForm row={row} setOpen={setOpen} />
      </AppDialogContent>
    </Dialog>
  );
}
