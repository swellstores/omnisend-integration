import { describe, it, expect, afterEach, vi } from "vitest";
import testConnection, { config } from "../../functions/test-connection";
import { createMockRequest } from "../helpers/mock-request";
import { settings, mockOmnisend, calls } from "../helpers/omnisend-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

function run(omnisend: object = settings) {
  return testConnection(createMockRequest({ swell: { settings: vi.fn().mockResolvedValue({ omnisend }) } }));
}

describe("test-connection", () => {
  it("is an action", () => {
    expect(config.action).toBe(true);
  });

  it("asks for the API key without calling Omnisend", async () => {
    const fetchMock = mockOmnisend();
    await expect(run({ store_url: "https://shop.test" })).rejects.toMatchObject({
      status: 400,
      message: "Add the API key and save the settings first.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the key with one read-only contacts call", async () => {
    const fetchMock = mockOmnisend({ "GET /contacts": { body: { contacts: [] } } });
    await expect(run()).resolves.toEqual({ message: "Connected to Omnisend: the API key can read your contacts." });
    expect(calls(fetchMock)).toEqual([
      expect.objectContaining({ method: "GET", path: "/contacts", query: { limit: "1" }, body: undefined }),
    ]);
  });

  it("explains a rejected key", async () => {
    mockOmnisend({ "GET /contacts": { status: 403, body: { error: "Forbidden" } } });
    await expect(run()).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/didn't accept the API key/) });
  });

  it("says when Omnisend can't be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(run()).rejects.toThrow(/couldn't be reached/);
  });
});
