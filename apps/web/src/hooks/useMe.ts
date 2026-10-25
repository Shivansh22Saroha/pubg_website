'use client';

import { UserResponseSchema, type Me } from '@rotationlab/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
  return useQuery<Me>({
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }) => (await api('/me', { schema: UserResponseSchema, signal })).user,
  });
}
