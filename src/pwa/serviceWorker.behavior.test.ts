/**
 * Behavioural verification of the REAL service worker (`public/sw.js`).
 *
 * Static string assertions (production smoke) prove the file contains certain
 * guards; these tests actually EXECUTE the worker's install/activate/fetch
 * handlers inside a mocked ServiceWorkerGlobalScope and verify the offline
 * contract end to end:
 *
 *  - an offline navigation is answered from the cached app shell,
 *  - the first (installing) worker pre-caches the shell so offline works
 *    after a single online visit,
 *  - cross-origin traffic (Supabase REST/auth) is NEVER intercepted,
 *  - non-GET traffic (every command/mutation) is NEVER intercepted,
 *  - API-ish same-origin requests (fetch/XHR destinations) are NEVER cached,
 *  - a redirected document response is never poisoned into the shell cache,
 *  - activation deletes caches from previous worker versions (safe
 *    invalidation, no unbounded growth, no stale-bundle serving).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// process.cwd() is the repository root under vitest.
const SW_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

const ORIGIN = "https://app.example.com";

/* ------------------------------------------------------------------ mocks */

class MockResponse {
  body: string;
  ok: boolean;
  status: number;
  redirected: boolean;
  type: string;

  constructor(
    body: string,
    opts: { ok?: boolean; status?: number; redirected?: boolean; type?: string } = {},
  ) {
    this.body = body;
    this.ok = opts.ok ?? true;
    this.status = opts.status ?? 200;
    this.redirected = opts.redirected ?? false;
    this.type = opts.type ?? "basic";
  }

  clone(): MockResponse {
    return new MockResponse(this.body, {
      ok: this.ok,
      status: this.status,
      redirected: this.redirected,
      type: this.type,
    });
  }
}

interface MockRequest {
  url: string;
  method: string;
  mode: string;
  destination: string;
}

function request(
  url: string,
  opts: Partial<Omit<MockRequest, "url">> = {},
): MockRequest {
  return {
    url,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "no-cors",
    destination: opts.destination ?? "",
  };
}

class MockCache {
  store = new Map<string, MockResponse>();

  private key(req: MockRequest | string): string {
    const url = typeof req === "string" ? req : req.url;
    return new URL(url, ORIGIN).href;
  }

  async match(req: MockRequest | string): Promise<MockResponse | undefined> {
    return this.store.get(this.key(req));
  }

  async put(req: MockRequest | string, response: MockResponse): Promise<void> {
    this.store.set(this.key(req), response);
  }

  async add(req: MockRequest | string): Promise<void> {
    const response = (await harness.fetch(
      typeof req === "string" ? request(req) : req,
    )) as MockResponse;
    if (!response.ok) throw new Error("cache.add failed");
    await this.put(req, response);
  }
}

class MockCacheStorage {
  caches = new Map<string, MockCache>();

  async open(name: string): Promise<MockCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MockCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async match(req: MockRequest | string): Promise<MockResponse | undefined> {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

type Handler = (event: unknown) => void;

type FetchMock = ReturnType<typeof vi.fn<(req: MockRequest) => Promise<MockResponse>>>;

interface Harness {
  listeners: Map<string, Handler[]>;
  cacheStorage: MockCacheStorage;
  fetch: FetchMock;
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  dispatchInstall(): Promise<void>;
  dispatchActivate(): Promise<void>;
  /** Returns the worker's response, or null when it did NOT intercept. */
  dispatchFetch(req: MockRequest): Promise<MockResponse | null>;
}

let harness: Harness;

function loadWorker(): Harness {
  const listeners = new Map<string, Handler[]>();
  const cacheStorage = new MockCacheStorage();
  const fetchMock = vi.fn<(req: MockRequest) => Promise<MockResponse>>();
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});

  const self = {
    location: new URL(ORIGIN + "/"),
    addEventListener(type: string, handler: Handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    skipWaiting,
    clients: { claim },
  };

  const sandbox = {
    self,
    caches: cacheStorage,
    fetch: fetchMock,
    Request: function (url: string, init?: { cache?: string }) {
      void init;
      return request(url);
    },
    URL,
    Set,
    Promise,
    Error,
    console,
  };

  // Execute the real worker source inside the sandbox scope.
  const run = new Function(
    ...Object.keys(sandbox),
    `"use strict";\n${SW_SOURCE}`,
  );
  run(...Object.values(sandbox));

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };

  return {
    listeners,
    cacheStorage,
    fetch: fetchMock,
    skipWaiting,
    claim,
    async dispatchInstall() {
      let pending: Promise<unknown> = Promise.resolve();
      await dispatch("install", {
        waitUntil(promise: Promise<unknown>) {
          pending = promise;
        },
      });
      await pending;
    },
    async dispatchActivate() {
      let pending: Promise<unknown> = Promise.resolve();
      await dispatch("activate", {
        waitUntil(promise: Promise<unknown>) {
          pending = promise;
        },
      });
      await pending;
    },
    async dispatchFetch(req: MockRequest) {
      let responded: Promise<MockResponse> | null = null;
      await dispatch("fetch", {
        request: req,
        respondWith(promise: Promise<MockResponse>) {
          responded = promise;
        },
      });
      return responded ? await responded : null;
    },
  };
}

beforeEach(() => {
  harness = loadWorker();
});

/* ------------------------------------------------------------------ tests */

describe("service worker — offline app shell", () => {
  it("pre-caches the app shell on install so ONE online visit enables offline start", async () => {
    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>shell</html>"));
    await harness.dispatchInstall();

    const cached = await harness.cacheStorage.match("/index.html");
    expect(cached?.body).toBe("<html>shell</html>");
    expect(harness.skipWaiting).toHaveBeenCalled();
  });

  it("serves the cached shell for an offline navigation instead of failing", async () => {
    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>shell</html>"));
    await harness.dispatchInstall();

    // Network is now down.
    harness.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const response = await harness.dispatchFetch(
      request(`${ORIGIN}/events/123`, { mode: "navigate", destination: "document" }),
    );
    expect(response).not.toBeNull();
    expect(response?.body).toBe("<html>shell</html>");
  });

  it("prefers the network for navigations when online (no stale shell lock-in)", async () => {
    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>old</html>"));
    await harness.dispatchInstall();

    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>fresh</html>"));
    const response = await harness.dispatchFetch(
      request(`${ORIGIN}/home`, { mode: "navigate", destination: "document" }),
    );
    expect(response?.body).toBe("<html>fresh</html>");

    // And the fresh document replaced the cached shell.
    const cached = await harness.cacheStorage.match("/index.html");
    expect(cached?.body).toBe("<html>fresh</html>");
  });

  it("survives a failed shell pre-cache and recovers on the first online navigation", async () => {
    harness.fetch.mockRejectedValueOnce(new TypeError("offline during install"));
    await harness.dispatchInstall(); // must not throw

    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>shell</html>"));
    await harness.dispatchFetch(
      request(`${ORIGIN}/home`, { mode: "navigate", destination: "document" }),
    );

    harness.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const offline = await harness.dispatchFetch(
      request(`${ORIGIN}/home`, { mode: "navigate", destination: "document" }),
    );
    expect(offline?.body).toBe("<html>shell</html>");
  });

  it("never poisons the shell cache with a redirected document response", async () => {
    // Install: server redirects (e.g. auth gateway) — must NOT become the shell.
    harness.fetch.mockResolvedValueOnce(
      new MockResponse("redirect target", { redirected: true }),
    );
    await harness.dispatchInstall();
    expect(await harness.cacheStorage.match("/index.html")).toBeUndefined();

    // Online navigation that redirects — must also not be cached as the shell.
    harness.fetch.mockResolvedValueOnce(
      new MockResponse("redirect target", { redirected: true }),
    );
    await harness.dispatchFetch(
      request(`${ORIGIN}/home`, { mode: "navigate", destination: "document" }),
    );
    expect(await harness.cacheStorage.match("/index.html")).toBeUndefined();
  });
});

describe("service worker — operational data is never served stale", () => {
  it("does not intercept cross-origin requests (Supabase REST/auth/realtime)", async () => {
    for (const url of [
      "https://xyz.supabase.co/rest/v1/events?select=*",
      "https://xyz.supabase.co/auth/v1/token",
      "https://xyz.supabase.co/realtime/v1/websocket",
    ]) {
      const response = await harness.dispatchFetch(request(url));
      expect(response).toBeNull(); // not intercepted → browser default
    }
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("does not intercept non-GET requests (commands/mutations)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await harness.dispatchFetch(
        request(`${ORIGIN}/anything`, { method }),
      );
      expect(response).toBeNull();
    }
  });

  it("does not cache same-origin fetch/XHR (API-shaped) requests", async () => {
    // destination "" is what fetch()/XHR produce — must pass through untouched.
    const response = await harness.dispatchFetch(
      request(`${ORIGIN}/api/data`, { destination: "" }),
    );
    expect(response).toBeNull();
  });

  it("caches only static asset destinations, cache-first", async () => {
    harness.fetch.mockResolvedValueOnce(new MockResponse("js-bundle-v1"));
    const first = await harness.dispatchFetch(
      request(`${ORIGIN}/assets/index-abc123.js`, { destination: "script" }),
    );
    expect(first?.body).toBe("js-bundle-v1");

    // Second request: network would now return something else, but the asset
    // is content-hashed so cache-first must win without touching the network.
    harness.fetch.mockClear();
    const second = await harness.dispatchFetch(
      request(`${ORIGIN}/assets/index-abc123.js`, { destination: "script" }),
    );
    expect(second?.body).toBe("js-bundle-v1");
    expect(harness.fetch).not.toHaveBeenCalled();
  });
});

describe("service worker — versioned cache invalidation", () => {
  it("activation deletes caches belonging to previous worker versions", async () => {
    await harness.cacheStorage.open("hospitality-static-v1");
    await harness.cacheStorage.open("hospitality-shell-v1");
    const current = await harness.cacheStorage.keys();
    expect(current).toContain("hospitality-static-v1");

    await harness.dispatchActivate();

    const remaining = await harness.cacheStorage.keys();
    expect(remaining).not.toContain("hospitality-static-v1");
    expect(remaining).not.toContain("hospitality-shell-v1");
    expect(harness.claim).toHaveBeenCalled();
  });

  it("activation keeps the current version's caches", async () => {
    harness.fetch.mockResolvedValueOnce(new MockResponse("<html>shell</html>"));
    await harness.dispatchInstall();
    await harness.dispatchActivate();

    expect(await harness.cacheStorage.match("/index.html")).toBeDefined();
  });
});
