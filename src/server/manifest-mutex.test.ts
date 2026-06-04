import { test, expect, describe } from "bun:test";
import { createMutex } from "./manifest-mutex";

// These tests are deterministic — they drive the mutex by resolving/awaiting
// promises directly, with no timers, sleeps, or wall-clock dependence.

describe("createMutex", () => {
  test("a second acquire does not enter until the first releases (mutual exclusion)", async () => {
    const mutex = createMutex();
    const order: string[] = [];

    const releaseA = await mutex.acquire();
    order.push("A:in");

    // B queues behind A. Attach a marker for when it actually enters.
    let entered = false;
    const bEntered = mutex.acquire().then((releaseB) => {
      entered = true;
      order.push("B:in");
      return releaseB;
    });

    // Flush all microtasks: B still must not have entered while A holds the lock.
    await Promise.resolve();
    await Promise.resolve();
    expect(entered).toBe(false);
    expect(order).toEqual(["A:in"]);

    // Release A → B proceeds.
    releaseA();
    const releaseB = await bEntered;
    expect(order).toEqual(["A:in", "B:in"]);
    releaseB();
  });

  test("multiple waiters wake in FIFO order and all complete (no lost wakeup)", async () => {
    const mutex = createMutex();
    const entered: number[] = [];

    const release0 = await mutex.acquire();

    // Queue three waiters behind the held lock. Each records its order, then
    // releases so the next can proceed.
    const waiters = [1, 2, 3].map((n) =>
      mutex.acquire().then((release) => {
        entered.push(n);
        release();
      })
    );

    // Nothing has entered yet — the lock is still held by holder 0.
    await Promise.resolve();
    expect(entered).toEqual([]);

    // Release the holder; all three must drain in FIFO order.
    // (The previous single-shared-resolver bug deadlocked here — this await
    //  would never resolve.)
    release0();
    await Promise.all(waiters);
    expect(entered).toEqual([1, 2, 3]);
  });

  test("acquire on a free mutex resolves immediately", async () => {
    const mutex = createMutex();
    const release = await mutex.acquire();
    release();
    // Re-acquire after release also resolves without queuing.
    const release2 = await mutex.acquire();
    release2();
    expect(true).toBe(true);
  });
});
