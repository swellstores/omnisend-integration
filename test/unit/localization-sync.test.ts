import { describe, it, expect, afterEach, vi } from "vitest";
import { getDefaultLocale, getLocalizedRecord, getLocalizedResults } from "../../functions/lib/localization";
import { waitForBatches } from "../../functions/lib/sync";
import { OmnisendClient } from "../../functions/lib/omnisend-client";
import { mockOmnisend, mockSwell, calls, skipDelays, settings } from "../helpers/omnisend-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

const localized = { ...settings, use_display_locale: true };

describe("getDefaultLocale", () => {
  it("reads the store locale", async () => {
    const swell = mockSwell({ "/settings/store": { locale: "en-US" } });
    await expect(getDefaultLocale(swell)).resolves.toBe("en-US");
  });
});

describe("getLocalizedRecord", () => {
  it("returns the record as is when display locale is disabled", async () => {
    const swell = mockSwell({ "/orders/{id}": { id: "o1", display_locale: "fr" } });
    const record = await getLocalizedRecord(swell, settings, "/orders/{id}", { id: "o1" });
    expect(record).toEqual({ id: "o1", display_locale: "fr" });
    expect(swell.get).toHaveBeenCalledTimes(1);
  });

  it("returns the record as is when it has no display locale", async () => {
    const swell = mockSwell({ "/orders/{id}": { id: "o1" } });
    await getLocalizedRecord(swell, localized, "/orders/{id}", { id: "o1" });
    expect(swell.get).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a record already in the store default locale", async () => {
    const swell = mockSwell({
      "/settings/store": { locale: "en" },
      "/orders/{id}": { id: "o1", display_locale: "en" },
    });

    await getLocalizedRecord(swell, localized, "/orders/{id}", { id: "o1" });

    expect(swell.get.mock.calls.map((c: any[]) => c[0])).toEqual(["/orders/{id}", "/settings/store"]);
  });

  it("refetches the record in a non-default display locale", async () => {
    const swell = mockSwell({
      "/settings/store": { locale: "en" },
      "/orders/{id}": (q: any) => ({ id: "o1", display_locale: "fr", name: q.$locale ? "Commande" : "Order" }),
    });

    const record = await getLocalizedRecord(swell, localized, "/orders/{id}", { id: "o1" });

    expect(record.name).toBe("Commande");
    expect(swell.get).toHaveBeenLastCalledWith("/orders/{id}", { id: "o1", $locale: "fr" });
  });
});

describe("getLocalizedResults", () => {
  const results = [
    { id: "a", display_locale: "en" },
    { id: "b", display_locale: "fr" },
    { id: "c" },
  ];

  it("returns results unchanged when display locale is disabled", async () => {
    const swell = mockSwell();
    expect(await getLocalizedResults(swell, settings, "en", "/orders", {}, results)).toBe(results);
    expect(swell.get).not.toHaveBeenCalled();
  });

  it("returns results unchanged when all are in the default locale", async () => {
    const swell = mockSwell();
    const same = [results[0], results[2]];
    expect(await getLocalizedResults(swell, localized, "en", "/orders", {}, same)).toBe(same);
  });

  it("refetches non-default-locale records grouped by locale", async () => {
    const swell = mockSwell({ "/orders": () => ({ results: [{ id: "b", display_locale: "fr", localized: true }] }) });

    const out = await getLocalizedResults(swell, localized, "en", "/orders", { limit: 1000, page: 3, expand: ["account"] }, results);

    expect(swell.get).toHaveBeenCalledWith("/orders", {
      limit: 1000,
      expand: ["account"],
      id: { $in: ["b"] },
      $locale: "fr",
    });
    expect(out.map((r: any) => r.id)).toEqual(["a", "c", "b"]);
    expect(out[2].localized).toBe(true);
  });
});

describe("waitForBatches", () => {
  it("polls until no batch is pending or in progress", async () => {
    skipDelays();
    const fetchMock = mockOmnisend({
      "GET /batches": [
        { body: { batches: [{ status: "inProgress" }], paging: {} } },
        { body: { batches: [{ status: "finished" }], paging: { next: "x" } } },
        { body: { batches: [{ status: "finished" }], paging: {} } },
      ],
    });

    await waitForBatches(new OmnisendClient("k"), "contacts");

    const queries = calls(fetchMock).map((c) => c.query);
    expect(queries).toEqual([
      { endpoint: "contacts", limit: "250", offset: "0" },
      { endpoint: "contacts", limit: "250", offset: "0" },
      { endpoint: "contacts", limit: "250", offset: "250" },
    ]);
  });
});
