'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Edit } from 'lucide-react';
import { type ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

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
import { sportTypes } from '~/contracts/sport';
import { type SportType } from '~/contracts/sport';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
} from '~/contracts/v1/activity-mutations';
import { useActivityMutations } from '~/hooks/use-activity-mutations';
import { useToast } from '~/hooks/use-toast';
import { type Activity } from '~/lib/activity';
import { isSilentActivityCommandError } from '~/lib/activity-command-session';
import {
  type ActivityEditValues,
  activityEditCommand,
  activityEditSchema,
} from '~/lib/activity-edit';
import { activityMutationAvailability } from '~/lib/activity-mutation-availability';
import { ActivityCommandError } from '~/lib/activity-mutation-client';
import {
  mutationFailureNotice,
  mutationNotice,
} from '~/lib/activity-mutation-notice';
import { message } from '~/lib/presentation/messages';
import { aliasMap, colorMap, iconMap } from '~/settings/category';
import { useShallowStore } from '~/store';

import { Select } from '../ui/select';

type FormValues = ActivityEditValues;

type ActivityTypeInfo = {
  name: SportType;
  Icon: ComponentType<{ className?: string; style?: { color: string } }>;
  color: string;
  group: string;
};

export function ProfileForm({
  activity,
  setOpen,
  commands,
  dirtyRef,
}: {
  activity: Activity;
  setOpen?: (open: boolean) => void;
  commands: ReturnType<typeof useActivityMutations>;
  dirtyRef: { current: boolean };
}) {
  const { toast } = useToast();
  const { canEdit, editReason } = useShallowStore(activityMutationAvailability);
  const submitting = useRef(false);
  // A sync may update the visible activity while this draft is open. Only
  // differences from the draft's opening baseline represent user edits.
  const [original] = useState(() => ({
    name: activity.name,
    description: activity.description ?? '',
    sportType: activity.sport_type,
  }));
  const [failure, setFailure] = useState<ActivityCommandError | null>(null);
  const [releasedRetryAt, setReleasedRetryAt] = useState(0);
  const retryAt = failure?.facts.retryAt;
  const waitingForRetry = !!retryAt && retryAt > releasedRetryAt;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(
      () => setReleasedRetryAt(retryAt),
      Math.min(2_147_483_647, Math.max(0, retryAt - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  const form = useForm<FormValues>({
    resolver: zodResolver(activityEditSchema, {
      error: (issue) => {
        if (issue.path?.[0] === 'sportType')
          return message('activity.edit.validationSport');
        if (issue.path?.[0] === 'description')
          return message('activity.edit.descriptionLength', {
            maximum: ACTIVITY_DESCRIPTION_MAX_LENGTH,
          });
        return issue.code === 'too_big'
          ? message('activity.edit.nameLength', {
              maximum: ACTIVITY_NAME_MAX_LENGTH,
            })
          : message('activity.edit.validationName');
      },
    }),
    defaultValues: original,
  });

  const isDirty = form.formState.isDirty;
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [dirtyRef, isDirty]);
  async function onSubmit(values: FormValues) {
    if (
      submitting.current ||
      !activityMutationAvailability(useShallowStore.getState()).canEdit ||
      !commands.isCurrent() ||
      failure?.requiresRefresh ||
      (retryAt && retryAt > Date.now())
    )
      return;
    submitting.current = true;
    try {
      const outcome = await commands.save(
        activityEditCommand(original, values),
      );
      if (!commands.isCurrent()) return;
      form.reset({
        name: outcome.activity.name,
        description: outcome.activity.description ?? '',
        sportType: outcome.activity.sport_type,
      });
      dirtyRef.current = false;
      toast(
        mutationNotice(
          outcome,
          'save',
          () => commands.retryCache(outcome),
          commands.isCurrent,
        ),
      );
      setOpen?.(false);
    } catch (error) {
      if (isSilentActivityCommandError(error)) return;
      if (commands.isCurrent()) {
        setFailure(error instanceof ActivityCommandError ? error : null);
        toast(mutationFailureNotice(error));
        form.setError('root', {
          message: mutationFailureNotice(error).description,
        });
      }
    } finally {
      submitting.current = false;
    }
  }

  async function recover() {
    if (
      submitting.current ||
      !commands.isCurrent() ||
      (retryAt && retryAt > Date.now())
    )
      return;
    submitting.current = true;
    try {
      const outcome = await commands.refresh();
      if (!commands.isCurrent()) return;
      form.reset({
        name: outcome.activity.name,
        description: outcome.activity.description ?? '',
        sportType: outcome.activity.sport_type,
      });
      dirtyRef.current = false;
      setFailure(null);
      toast(
        mutationNotice(
          outcome,
          'refresh',
          () => commands.retryCache(outcome),
          commands.isCurrent,
        ),
      );
      setOpen?.(false);
    } catch (error) {
      if (isSilentActivityCommandError(error)) return;
      if (commands.isCurrent()) {
        // Keep recovery required until Strava has been reread successfully.
        if (error instanceof ActivityCommandError)
          setFailure(
            new ActivityCommandError(error.message, {
              ...error.facts,
              details: { upstreamSucceeded: true },
            }),
          );
        form.setError('root', {
          message: mutationFailureNotice(error, 'refresh').description,
        });
        toast(mutationFailureNotice(error, 'refresh'));
      }
    } finally {
      submitting.current = false;
    }
  }

  const activtyTypes = sportTypes
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
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <AppDialogBody className="space-y-8">
          <fieldset disabled={commands.isPending} className="space-y-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{message('activity.edit.name')}</FormLabel>
                  <FormControl>
                    <Input placeholder={activity.name} {...field} />
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
                  <FormLabel>{message('activity.edit.description')}</FormLabel>
                  <FormControl>
                    <textarea
                      className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
                      {...field}
                    />
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
                  <FormLabel>{message('activity.edit.sport')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
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
          </fieldset>
          {editReason && <p role="status">{editReason}</p>}
          {form.formState.errors.root && (
            <p role="alert">{form.formState.errors.root.message}</p>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          {failure?.requiresRefresh && (
            <Button
              type="button"
              disabled={commands.isPending || waitingForRetry}
              onClick={() => void recover()}
            >
              {message('action.refresh')}
            </Button>
          )}
          <Button
            type="submit"
            disabled={
              commands.isPending ||
              !canEdit ||
              !form.formState.isDirty ||
              !!failure?.requiresRefresh ||
              waitingForRetry
            }
          >
            {message(
              commands.isPending
                ? 'activity.edit.saving'
                : 'activity.edit.save',
            )}
          </Button>
        </AppDialogFooter>
      </form>
    </Form>
  );
}

export function EditActivity({
  activity,
  commands: suppliedCommands,
  open,
  setOpen,
  trigger = true,
}: {
  activity: Activity;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  trigger: boolean;
  commands?: ReturnType<typeof useActivityMutations>;
}) {
  const { canEdit, editReason } = useShallowStore(activityMutationAvailability);
  const [localOpen, setLocalOpen] = useState(false);
  const boundCommands = useActivityMutations(activity.id);
  const commands = suppliedCommands ?? boundCommands;
  const dirtyRef = useRef(false);
  const changeOpen = (next: boolean) => {
    if (
      next &&
      !activityMutationAvailability(useShallowStore.getState()).canEdit
    )
      return;
    if (
      !next &&
      (commands.isPending ||
        (dirtyRef.current &&
          !window.confirm(message('activity.edit.discardQuestion'))))
    )
      return;
    (setOpen ?? setLocalOpen)(next);
  };

  return (
    <Dialog open={open ?? localOpen} onOpenChange={changeOpen}>
      {trigger && (
        <DialogTrigger asChild>
          <Button
            variant={'ghost'}
            size={'sm'}
            className="p-1"
            disabled={!canEdit || commands.isPending}
            title={editReason}
            aria-label={
              editReason
                ? message('activity.action.unavailable', {
                    action: message('activity.edit.title'),
                    name: activity.name,
                    reason: editReason,
                  })
                : message('activity.edit.title')
            }
          >
            <Edit className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <AppDialogContent
        closeLabel={message('activity.edit.close')}
        layout="sections"
      >
        <AppDialogHeader>
          <DialogTitle>{message('activity.edit.title')}</DialogTitle>
          <DialogDescription>
            {message('activity.edit.subtitle')}
          </DialogDescription>
        </AppDialogHeader>
        <ProfileForm
          key={activity.id}
          activity={activity}
          setOpen={(next) => (setOpen ?? setLocalOpen)(next)}
          commands={commands}
          dirtyRef={dirtyRef}
        />
      </AppDialogContent>
    </Dialog>
  );
}
