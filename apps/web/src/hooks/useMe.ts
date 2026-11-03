'use client';

import { UserResponseSchema, type Me } from '@rotationlab/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/queryKeys';

export { ME_QUERY_KEY };

export function useMe() {
  return useQuery<Me>({
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }) => (await api('/me', { schema: UserResponseSchema, signal })).user,
  });
}
