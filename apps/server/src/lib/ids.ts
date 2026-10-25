import { v7 } from 'uuid';

/** Time-ordered UUIDv7 for every primary key (DATABASE_SCHEMA intro). */
export function newId(): string {
  return v7();
}
