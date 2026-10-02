import { afterEach, describe, expect, it, vi } from "vitest";
import { adminSyncPage, publicContext } from "../../frontend/worker/swell-server";
import { DEFAULT_PAGE_SIZE } from "../../functions/lib/sync";

// The app frontend Worker endpoint that runs the initial sync page by page for staff.

const origin = "https://app.example.invalid";
const headers = {
  "Swell-Store-Id": "example",
  "Swell-Public-Key": "public-fixture-key",
  "Swell-Admin-Url": "https://example.swell.store",
  "Swell-API-Host": "https://api.example.invalid",
  "Swell-Access-Token": "private-fixture-token",
  "Swell-App-Id": "omnisend",
};

function request(
  cookie: string | null,
  { body = { entity: "contacts", page: 1 } as unknown, extra = {} as Record<string, string> } = {},
) {
  return new Request(`${origin}/app-api/admin/sync`, {
    method: "POST",
    headers: {
      ...headers,
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const session = "_swell_admin_session=fixture";
const validSession = () => Response.json({ user_id: "staff", client_id: "example" });
const noPlatformCalls = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("Must not contact the platform");
  });

type Override = Response | ((url: URL, init: RequestInit) => Response | Promise<Response>);

const settings = {
  omnisend: { api_key: "omnisend-fixture-key", store_url: "https://shop.test", enabled: true },
};

const account = { id: "acc_1", email: "jane@example.com", email_optin: true, date_created: "2026-01-01" };

// Routes mocked platform and Omnisend calls by URL; `overrides` replaces a route's response.
function mockPlatform(overrides: Record<string, Override> = {}) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    calls.push(`${method} ${url.hostname}${url.pathname}`);
    const isOmnisend = url.hostname === "api.omnisend.com";
    const route = isOmnisend ? `omnisend ${method} ${url.pathname.replace(/^\/v3/, "")}` : `${method} ${url.pathname}`;
    const override = overrides[route];
    if (override) return typeof override === "function" ? override(url, init) : override.clone();
    if (!isOmnisend) {
      expect(init.redirect).toBe("manual");
    }
    switch (route) {
      case "GET /admin/api/session":
        return validSession();
      case "GET /settings/omnisend":
        return Response.json(settings);
      case "GET /accounts":
        return Response.json({ count: 1, results: [account] });
      case "GET /products":
        return Response.json({ count: 1, results: [{ id: "p1", name: "One", sku: "ONE" }] });
      case "GET /orders":
        return Response.json({ count: 1, results: [{ id: "o1", number: "1001", items: [] }] });
      case "POST /:batch":
        return Response.json(JSON.parse(String(init.body)).map(() => ({})));
      case "omnisend POST /batches":
        return Response.json({ batchID: "b1" });
      default:
        throw new Error(`Unexpected request ${route}`);
    }
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publicContext", () => {
  it("contains public fields only", async () => {
    const result: any = await publicContext(request(null)).json();

    expect(result.storeId).toBe("example");
    expect(result.storefrontApiOrigin).toBe("https://example.swell.store");
    expect(JSON.stringify(result)).not.toContain("private-fixture-token");
    expect(JSON.stringify(result)).not.toContain("api.example.invalid");
  });

  it("explains how to enter through Swell when context is missing", () => {
    expect(publicContext(new Request("http://localhost/")).status).toBe(503);
  });
});

describe("adminSyncPage request checks", () => {
  it.each([{ Origin: "https://evil.example" }, { "Content-Type": "text/plain" }])(
    "rejects cross-site or non-JSON requests: %j",
    async (extra) => {
      noPlatformCalls();
      expect((await adminSyncPage(request(session, { extra }))).status).toBe(403);
    },
  );

  it.each([
    "not json",
    { entity: "contacts", page: 0 },
    { entity: "contacts", page: 1.5 },
    { entity: "contacts", page: "2" },
  ])("rejects invalid body: %j", async (body) => {
    noPlatformCalls();
    expect((await adminSyncPage(request(session, { body }))).status).toBe(400);
  });

  it.each([undefined, "carts"])("rejects entity %j before contacting the platform", async (entity) => {
    noPlatformCalls();

    const result = await adminSyncPage(request(session, { body: { entity, page: 1 } }));

    expect(result.status).toBe(400);
    expect(((await result.json()) as any).error).toBe("Invalid entity, use one of contacts, products, orders");
  });

  it.each([null, "_swell_admin_session=%ZZ"])("rejects missing or malformed session: %s", async (cookie) => {
    noPlatformCalls();
    expect((await adminSyncPage(request(cookie))).status).toBe(401);
  });

  it.each([{}, { user_id: "user", client_id: "other-store" }])(
    "rejects invalid or other-store session: %j",
    async (sessionBody) => {
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(sessionBody));

      expect((await adminSyncPage(request(session))).status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([50, 1001, "all"])("rejects page size %j before contacting the platform", async (limit) => {
    noPlatformCalls();

    const result = await adminSyncPage(request(session, { body: { entity: "contacts", page: 1, limit } }));

    expect(result.status).toBe(400);
    expect(((await result.json()) as any).error).toBe("Invalid page size, use one of 10, 100, 200, 500, 1000");
  });

  it("rejects an invalid date before contacting the platform", async () => {
    noPlatformCalls();

    const result = await adminSyncPage(
      request(session, { body: { entity: "contacts", page: 1, created_after: "yesterday" } }),
    );

    expect(result.status).toBe(400);
    expect(((await result.json()) as any).error).toBe("Invalid created_after date");
  });

  it.each(["session", "backend"])("rejects %s redirects without following them", async (redirectAt) => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init: RequestInit = {}) => {
      calls++;
      expect(init.redirect).toBe("manual");
      if (redirectAt === "backend" && calls === 1) return validSession();
      return new Response(null, { status: 302, headers: { Location: "https://untrusted.example" } });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adminSyncPage(request(session));

    expect(result.status).toBe(redirectAt === "session" ? 401 : 502);
    expect(calls).toBe(redirectAt === "session" ? 1 : 2);
    if (redirectAt === "backend") expect(((await result.json()) as any).details.status).toBe(302);
  });
});

describe("adminSyncPage sync", () => {
  it("validates the session, syncs one page of contacts and returns only progress fields", async () => {
    let tagBody: unknown;
    const calls = mockPlatform({
      "GET /settings/omnisend": (_url, init) => {
        expect((init.headers as Record<string, string>).Authorization).toBe(
          `Basic ${btoa("example:private-fixture-token")}`,
        );
        return Response.json(settings);
      },
      "POST /:batch": (_url, init) => {
        tagBody = JSON.parse(String(init.body));
        return Response.json([{}]);
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await adminSyncPage(request(session));

    expect(await result.json()).toEqual({
      entity: "contacts", page: 1, limit: DEFAULT_PAGE_SIZE, count: 1, synced: 1, done: true,
    });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(calls).toEqual([
      "GET example.swell.store/admin/api/session",
      "GET api.example.invalid/settings/omnisend",
      "GET api.example.invalid/accounts",
      "POST api.omnisend.com/v3/batches",
      "POST api.example.invalid/:batch",
    ]);
    expect(tagBody).toEqual([
      { url: "/accounts/acc_1", method: "put", data: { $events: false, omnisend_email: "jane@example.com" } },
    ]);
  });

  it.each([
    ["products", "/products"],
    ["orders", "/orders"],
  ])("syncs one page of %s", async (entity, path) => {
    let batch: any;
    const calls = mockPlatform({
      "omnisend POST /batches": (_url, init) => {
        batch = JSON.parse(String(init.body));
        return Response.json({ batchID: "b1" });
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await adminSyncPage(request(session, { body: { entity, page: 1 } }));

    expect(await result.json()).toEqual({ entity, page: 1, limit: DEFAULT_PAGE_SIZE, count: 1, synced: 1, done: true });
    expect(calls).toContain(`GET api.example.invalid${path}`);
    expect(calls).not.toContain("POST api.example.invalid/:batch");
    expect(batch).toMatchObject({ method: "POST", endpoint: entity });
  });

  it("requests the given page, size and date filter in a stable order", async () => {
    let accountsUrl: URL | undefined;
    mockPlatform({
      "GET /accounts": (url) => {
        accountsUrl = url;
        return Response.json({ count: 1001, results: [account] });
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await adminSyncPage(request(session, {
      body: { entity: "contacts", page: 3, limit: 500, created_after: "2026-09-01T00:00:00+02:00" },
    }));

    expect(await result.json()).toEqual({ entity: "contacts", page: 3, limit: 500, count: 1001, synced: 1, done: true });
    expect(accountsUrl?.searchParams.get("page")).toBe("3");
    expect(accountsUrl?.searchParams.get("limit")).toBe("500");
    expect(accountsUrl?.searchParams.get("sort")).toBe("date_created asc");
    expect(accountsUrl?.searchParams.get("date_created[$gte]")).toBe("2026-08-31T22:00:00.000Z");
  });

  it("syncs all records without a date filter", async () => {
    let accountsUrl: URL | undefined;
    mockPlatform({
      "GET /accounts": (url) => {
        accountsUrl = url;
        return Response.json({ count: 0, results: [] });
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await adminSyncPage(request(session, { body: { entity: "contacts", page: 1, created_after: "" } }));

    expect(accountsUrl?.searchParams.get("date_created[$gte]")).toBeNull();
  });
});

describe("adminSyncPage errors", () => {
  it("reports a disabled integration", async () => {
    mockPlatform({ "GET /settings/omnisend": Response.json({ omnisend: { api_key: "k" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adminSyncPage(request(session));
    const body: any = await result.json();

    expect(result.status).toBe(400);
    expect(body.error).toBe("Omnisend integration is disabled in app settings");
    expect(body.details).toEqual({ step: "sync", entity: "contacts", page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it("reports Omnisend errors with their status", async () => {
    mockPlatform({ "omnisend POST /batches": Response.json({ error: "Invalid items" }, { status: 400 }) });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adminSyncPage(request(session, { body: { entity: "products", page: 2 } }));
    const body: any = await result.json();

    expect(result.status).toBe(502);
    expect(body.error).toBe('Omnisend POST /batches failed 400: {"error":"Invalid items"}');
    expect(body.details).toEqual({ step: "omnisend", entity: "products", page: 2, status: 400, limit: DEFAULT_PAGE_SIZE });
  });

  it("reports Swell API failures with step, status and body without leaking credentials", async () => {
    mockPlatform({
      "GET /orders": new Response("bad gateway private-fixture-token", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adminSyncPage(request(session, { body: { entity: "orders", page: 1 } }));
    const body: any = await result.json();

    expect(result.status).toBe(502);
    expect(body.error).toBe("Swell API GET /orders failed with HTTP 503");
    expect(body.details).toMatchObject({
      step: "swell api",
      path: "/orders",
      status: 503,
      response: "bad gateway [redacted]",
      entity: "orders",
    });
  });

  it("passes Swell API error messages through", async () => {
    mockPlatform({
      "GET /settings/omnisend": Response.json({ error: { message: "Permission denied" } }, { status: 403 }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const body: any = await (await adminSyncPage(request(session))).json();

    expect(body.error).toBe("Permission denied");
    expect(body.details.status).toBe(403);
  });

  it("does not leak credentials from upstream exceptions", async () => {
    mockPlatform({
      "GET /settings/omnisend": () => {
        throw new Error("private-fixture-token");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adminSyncPage(request(session));
    const body = JSON.stringify(await result.json());

    expect(result.status).toBe(502);
    expect(body).not.toContain("private-fixture-token");
    expect(body).toContain("[redacted]");
  });
});
