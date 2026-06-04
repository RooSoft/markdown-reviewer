// ---------------------------------------------------------------------------
// Async FIFO mutex
// ---------------------------------------------------------------------------
//
// Serializes manifest read-modify-write sequences so the background
// auto-discover crawl and request handlers can't interleave at await
// boundaries and lose each other's updates (B5).
//
// Chained-promise design: acquire() returns *this* acquisition's release fn,
// resolved only once the previous holder releases. Each holder resolves the
// exact promise the next waiter is parked on, so there are no lost wakeups —
// the failure mode of a single-shared-resolver implementation.
//
// Usage:
//   const release = await mutex.acquire();
//   try { /* critical section */ } finally { release(); }

export interface Mutex {
  acquire(): Promise<() => void>;
}

export function createMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve();
  return {
    acquire(): Promise<() => void> {
      let release!: () => void;
      const next = new Promise<void>((resolve) => { release = resolve; });
      const prev = tail;
      tail = next;
      return prev.then(() => release);
    },
  };
}
