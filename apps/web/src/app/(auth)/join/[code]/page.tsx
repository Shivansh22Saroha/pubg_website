import { InviteCodeSchema } from '@rotationlab/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JoinCard } from '@/components/rooms/JoinCard';

export const metadata: Metadata = { title: 'Join room', robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const parsed = InviteCodeSchema.safeParse(decodeURIComponent((await params).code));
  if (!parsed.success) notFound();
  return <JoinCard code={parsed.data} />;
}
