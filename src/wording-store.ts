import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { q1, tx } from './db.js';
import { applyWording, validWording, type WordingOverrides } from './wording.js';

interface Snapshot { revision: number; overrides: WordingOverrides }

let cached: Snapshot = { revision: 0, overrides: {} };
let checkedAt = 0;
let reading: Promise<Snapshot> | undefined;

function useSnapshot(snapshot: Snapshot) {
  if (snapshot.revision >= cached.revision) {
    cached = snapshot;
    applyWording(snapshot.overrides);
  }
  return cached;
}

export function readWording(): Promise<Snapshot> {
  if (Date.now() - checkedAt < 5000) return Promise.resolve(cached);
  if (!reading) {
    reading = q1<Snapshot>('SELECT revision, overrides FROM app_wording WHERE id=1')
      .then(row => row ? useSnapshot(row) : cached)
      .finally(() => { reading = undefined; checkedAt = Date.now(); });
  }
  return reading;
}

export function canSyncWording(auth: string | undefined) {
  const token = config.wordingSyncToken;
  if (!token || !auth?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function saveWording(changes: Record<string, unknown>) {
  const rejected: string[] = [];
  const snapshot = await tx(async client => {
    const previous = (await client.query<Snapshot>('SELECT revision, overrides FROM app_wording WHERE id=1 FOR UPDATE')).rows[0];
    const entries: [string, string][] = [];
    for (const [key, text] of Object.entries(changes)) {
      if (validWording(key, text)) entries.push([key, text]);
      else {
        rejected.push(key);
        if (Object.hasOwn(previous.overrides, key)) entries.push([key, previous.overrides[key]]);
      }
    }
    const next = Object.fromEntries(entries);
    const updated = await client.query<Snapshot>(`UPDATE app_wording SET overrides=$1, revision=revision+1
      WHERE id=1 AND overrides<>$1::jsonb RETURNING revision,overrides`, [JSON.stringify(next)]);
    return updated.rows[0] || previous;
  });
  useSnapshot(snapshot);
  checkedAt = Date.now();
  return { revision: snapshot.revision, rejected };
}
