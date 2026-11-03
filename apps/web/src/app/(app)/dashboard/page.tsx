import { RoomListResponseSchema } from '@rotationlab/shared';
import { HydrationBoundary } from '@tanstack/react-query';
import { DashboardView } from '@/components/rooms/DashboardView';
import { keys } from '@/lib/queryKeys';
import { dehydrated, prefetchApi, requestContext } from '@/lib/serverApi';

/**
 * The room list is fetched here so the first card's image is in the HTML (it is the page's
 * LCP); `/me` comes from the (app) layout. Without it the client fetches as before.
 */
export default async function DashboardPage() {
  const rooms = await prefetchApi('/rooms', RoomListResponseSchema, await requestContext());
  return (
    <HydrationBoundary state={dehydrated([[keys.rooms, rooms?.items]])}>
      <DashboardView />
    </HydrationBoundary>
  );
}
