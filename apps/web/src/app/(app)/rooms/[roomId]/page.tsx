import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { RoomWorkspace } from '@/components/room/RoomWorkspace';

export const metadata: Metadata = { title: 'Room' };

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!z.uuid().safeParse(roomId).success) notFound();
  return <RoomWorkspace key={roomId} roomId={roomId} />;
}
