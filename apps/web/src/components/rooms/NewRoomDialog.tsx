'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AssignableRoleSchema,
  MAPS,
  MapIdSchema,
  RoomDescriptionSchema,
  RoomNameSchema,
  RoomPasswordSchema,
  type MapId,
} from '@rotationlab/shared';
import { Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyApiError } from '@/components/auth/formErrors';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { FieldError, Input, Label } from '@/components/ui/input';
import { NativeSelect, Textarea } from '@/components/ui/select';
import { useCreateRoom } from '@/lib/rooms';
import { MapPicker } from './bits';

const FormSchema = z
  .object({
    name: RoomNameSchema,
    description: RoomDescriptionSchema,
    usePassword: z.boolean(),
    password: z.string(),
    mapId: MapIdSchema,
    defaultRole: AssignableRoleSchema,
  })
  .superRefine((v, ctx) => {
    if (v.usePassword && !RoomPasswordSchema.safeParse(v.password).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Room password must be 4–128 characters',
      });
    }
  });
type FormIn = z.input<typeof FormSchema>;
type FormOut = z.output<typeof FormSchema>;

/** UI_UX_SPEC §3.3 "New room" dialog (UF-3). */
export function NewRoomDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const create = useCreateRoom();
  const {
    register,
    handleSubmit,
    control,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      description: '',
      usePassword: false,
      password: '',
      mapId: 'erangel',
      defaultRole: 'EDITOR',
    },
  });
  const usePassword = useWatch({ control, name: 'usePassword' });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { room } = await create.mutateAsync({
        name: v.name,
        description: v.description || null,
        password: v.usePassword ? v.password : null,
        defaultRole: v.defaultRole,
        firstBoard: { name: `${MAPS[v.mapId].name} – Plan 1`, mapId: v.mapId },
      });
      setOpen(false);
      reset();
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      applyApiError(err, setError, ['name', 'description', 'password']);
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" aria-hidden /> New room
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="New room" description="A private space for your squad's plans.">
        <form
          method="post"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name">Name</Label>
            <Input
              id="room-name"
              autoFocus
              maxLength={40}
              aria-invalid={errors.name ? true : undefined}
              {...register('name')}
            />
            <FieldError id="room-name-error">{errors.name?.message}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-description">
              Description <span className="text-text-muted">(optional)</span>
            </Label>
            <Textarea id="room-description" rows={2} maxLength={280} {...register('description')} />
            <FieldError id="room-description-error">{errors.description?.message}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                {...register('usePassword')}
              />
              Require a room password
            </label>
            {usePassword && (
              <>
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label="Room password"
                  aria-invalid={errors.password ? true : undefined}
                  {...register('password')}
                />
                <FieldError id="room-password-error">{errors.password?.message}</FieldError>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">First board map</span>
            <Controller
              control={control}
              name="mapId"
              render={({ field }) => (
                <MapPicker
                  name="first-map"
                  value={field.value}
                  onChange={(m: MapId) => {
                    field.onChange(m);
                  }}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-default-role">New members join as</Label>
            <NativeSelect id="room-default-role" {...register('defaultRole')}>
              <option value="EDITOR">Editor — can draw</option>
              <option value="VIEWER">Viewer — view & chat only</option>
            </NativeSelect>
          </div>
          {errors.root?.message && (
            <p role="alert" data-testid="form-error" className="text-sm text-danger">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="h-10">
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Create room
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
