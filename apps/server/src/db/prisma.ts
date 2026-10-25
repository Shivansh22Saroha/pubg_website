import { PrismaClient } from '@prisma/client';

export function createPrisma(databaseUrl: string) {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
