import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api';

/**
 * Maps an API error onto form fields (inline, UI_UX_SPEC §3.2) or the form-level error.
 * `fields` lists the form's field names; API detail paths outside it go to the root.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  if (!(err instanceof ApiError)) {
    setError('root', { message: 'Something went wrong. Please try again.' });
    return;
  }
  const byCode: Partial<Record<string, Path<T>>> = {
    USERNAME_TAKEN: 'username' as Path<T>,
    EMAIL_TAKEN: 'email' as Path<T>,
  };
  const direct = byCode[err.code];
  if (direct && fields.includes(direct)) {
    setError(direct, { message: err.message });
    return;
  }
  if (err.code === 'VALIDATION_ERROR' && err.details.length > 0) {
    let placed = false;
    for (const d of err.details) {
      const field = d.path as Path<T>;
      if (fields.includes(field)) {
        setError(field, { message: err.message });
        placed = true;
      }
    }
    if (placed) return;
  }
  setError('root', { message: err.message });
}
