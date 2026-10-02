import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OmnisendClient } from "../../functions/lib/omnisend-client";
import { createContact, updateContact, syncContacts, validateLogin } from "../../functions/lib/contact";
import { mockOmnisend, mockSwell, calls, makeAccount } from "../helpers/omnisend-fixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const client = () => new OmnisendClient("k");

describe("createContact", () => {
  it("skips accounts without email", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell();
    await createContact(swell, client(), "acc_1", makeAccount({ email: undefined }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(swell.put).not.toHaveBeenCalled();
  });

  it("creates a subscribed contact and tracks its email on the account", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell();

    await createContact(swell, client(), "acc_1", makeAccount());

    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "POST", path: "/contacts" });
    expect(call.body).toMatchObject({
      id: "acc_1",
      firstName: "Jane",
      lastName: "Doe",
      city: "NYC",
      state: "NY",
      countryCode: "US",
      postalCode: "10001",
      address: "1 Main St; Apt 2",
      customProperties: {
        company: "Acme",
        shipping_phone: "+12015550000",
        account_phone: "+12015550123",
        email: "jane@example.com",
      },
      identifiers: [
        {
          type: "email",
          id: "jane@example.com",
          channels: { email: { status: "subscribed", statusDate: "2026-01-01T00:00:00.000Z" } },
        },
      ],
    });
    expect(swell.put).toHaveBeenCalledWith("/accounts/{id}", {
      $events: false,
      id: "acc_1",
      omnisend_email: "jane@example.com",
    });
  });

  it("omits address on create when the account has none", async () => {
    const fetchMock = mockOmnisend();
    await createContact(mockSwell(), client(), "acc_1", makeAccount({ shipping: {} }));
    expect(calls(fetchMock)[0].body.address).toBeUndefined();
  });

  it("does not tag the account when Omnisend rejects the contact", async () => {
    mockOmnisend({ "POST /contacts": { status: 400 } });
    const swell = mockSwell();
    await createContact(swell, client(), "acc_1", makeAccount());
    expect(swell.put).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("updateContact", () => {
  it("does nothing when the account is missing", async () => {
    const fetchMock = mockOmnisend();
    await updateContact(mockSwell(), client(), "acc_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips accounts not yet synced to Omnisend", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/accounts/{id}": makeAccount() });
    await updateContact(swell, client(), "acc_1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("patches the contact by its tracked email", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({
      "/accounts/{id}": makeAccount({ email: "new@example.com", omnisend_email: "jane@example.com" }),
    });

    await updateContact(swell, client(), "acc_1");

    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "PATCH", path: "/contacts", query: { email: "jane@example.com" } });
    expect(call.body.customProperties.email).toBe("new@example.com");
    expect(call.body.identifiers).toBeUndefined();
  });
});

describe("syncContacts", () => {
  it("sends each page of accounts as a batch and tags them", async () => {
    const fetchMock = mockOmnisend();
    const pages: Record<number, any> = {
      1: { results: [makeAccount(), makeAccount({ id: "acc_2", email: undefined })] },
      2: { results: [makeAccount({ id: "acc_3", email: "c@example.com" })] },
      3: { results: [] },
    };
    const swell = mockSwell({ "/accounts": (q: any) => pages[q.page] });

    await syncContacts(swell, client());

    const batches = calls(fetchMock);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({ method: "POST", path: "/batches", body: { method: "POST", endpoint: "contacts" } });
    expect(batches[0].body.items.map((i: any) => i.id)).toEqual(["acc_1", "acc_2"]);
    expect(swell.get).toHaveBeenCalledWith("/accounts", { limit: 100, page: 1 });
    // accounts without email are not tagged
    expect(swell.put.mock.calls.map((c: any[]) => c[1].id)).toEqual(["acc_1", "acc_3"]);
  });
});

describe("validateLogin", () => {
  it("returns true when Omnisend accepts the test contact", async () => {
    const fetchMock = mockOmnisend();
    await expect(validateLogin("key")).resolves.toBe(true);
    const [call] = calls(fetchMock);
    expect(call.headers["X-API-KEY"]).toBe("key");
    expect(call.body.identifiers[0].id).toBe("validate@test.com");
  });

  it("returns false when the API key is rejected", async () => {
    mockOmnisend({ "POST /contacts": { status: 403 } });
    await expect(validateLogin("bad")).resolves.toBe(false);
  });
});
