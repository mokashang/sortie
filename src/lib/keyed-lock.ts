// In-process mutex by key: callers with the same key run one after another, in arrival order;
// different keys never wait for each other. Kept on globalThis so dev hot reloads share it.
//
// For read → await an LLM → write sequences that two parallel assistant sessions can start on the
// same row (two sessions harvesting the same LinkedIn thread drafted two different replies, and
// with 自动投递 on both went out to the same person).
type Chains = Map<string, Promise<unknown>>;

function chains(): Chains {
  const g = globalThis as { __sortieKeyedLocks?: Chains };
  return (g.__sortieKeyedLocks ??= new Map());
}

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const all = chains();
  const before = all.get(key) ?? Promise.resolve();
  const mine = before.then(fn, fn);
  // The stored tail never rejects, so a failure does not poison the next caller.
  const tail = mine.then(
    () => undefined,
    () => undefined
  );
  all.set(key, tail);
  try {
    return await mine;
  } finally {
    if (all.get(key) === tail) all.delete(key);
  }
}
