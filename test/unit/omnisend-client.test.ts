import { describe, it, expect, afterEach, vi } from "vitest";
import { OmnisendClient, getSettings } from "../../functions/lib/omnisend-client";
import { mockOmnisend, calls } from "../helpers/omnisend-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OmnisendClient", () => {
  it("sends authenticated JSON requests to the v3 API", async () => {
    const fetchMock = mockOmnisend({ "POST /contacts": { body: { contactID: "c1" } } });
    const client = new OmnisendClient("key123");

    const res = await client.post("/contacts", { a: 1 });

    expect(res).toEqual({ contactID: "c1" });
    const [call] = calls(fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.omnisend.com/v3/contacts");
    expect(call.method).toBe("POST");
    expect(call.headers).toEqual({ "X-API-KEY": "key123", "Content-Type": "application/json" });
    expect(call.body).toEqual({ a: 1 });
  });

  it("appends query params for get and patch", async () => {
    const fetchMock = mockOmnisend();
    const client = new OmnisendClient("k");

    await client.get("/batches", { endpoint: "contacts", limit: "250" });
    await client.patch("/contacts", { firstName: "J" }, { email: "a@b.c" });

    const [get, patch] = calls(fetchMock);
    expect(get).toMatchObject({ method: "GET", path: "/batches", query: { endpoint: "contacts", limit: "250" } });
    expect(get.body).toBeUndefined();
    expect(patch).toMatchObject({ method: "PATCH", query: { email: "a@b.c" }, body: { firstName: "J" } });
  });

  it("uses PUT and DELETE methods", async () => {
    const fetchMock = mockOmnisend({ "DELETE /carts/c1": { status: 204 } });
    const client = new OmnisendClient("k");

    await client.put("/carts/c1", { x: 1 });
    const deleted = await client.delete("/carts/c1");

    expect(calls(fetchMock).map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    expect(deleted).toBeUndefined();
  });

  it("throws with status and response text on errors", async () => {
    mockOmnisend({ "GET /carts/x": { status: 404, body: { error: "not found" } } });
    const client = new OmnisendClient("k");

    await expect(client.get("/carts/x")).rejects.toThrow(
      'Omnisend GET /carts/x failed 404: {"error":"not found"}',
    );
  });
});

describe("getSettings", () => {
  it("returns the omnisend settings section", () => {
    expect(getSettings({ omnisend: { api_key: "k" } })).toEqual({ api_key: "k" });
  });

  it("returns an empty object when not configured", () => {
    expect(getSettings(undefined)).toEqual({});
    expect(getSettings({})).toEqual({});
  });
});
