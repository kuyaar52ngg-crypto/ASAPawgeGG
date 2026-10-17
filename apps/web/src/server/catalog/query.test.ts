import { describe, expect, it } from "vitest";
import { buildCatalogQs, parseCatalogParams } from "./query";

describe("parseCatalogParams", () => {
  it("applies defaults", () => {
    const q = parseCatalogParams({});
    expect(q).toMatchObject({ page: 1, pageSize: 24, sort: "popular" });
  });
  it("parses filters and treats inStock=0 / garbage safely", () => {
    const q = parseCatalogParams({ platform: "STEAM", minPrice: "50000", inStock: "1", discount: "0", sort: "price_asc", page: "3" });
    expect(q).toMatchObject({ platform: "STEAM", minPrice: 50000, inStock: true, discount: false, sort: "price_asc", page: 3 });
  });
  it("drops invalid values instead of throwing", () => {
    const q = parseCatalogParams({ type: "NOPE", page: "-4", sort: "evil", minPrice: "abc" });
    expect(q).toMatchObject({ page: 1, sort: "popular" });
    expect(q.type).toBeUndefined();
    expect(q.minPrice).toBeUndefined();
  });
  it("uses the first value of repeated params", () => {
    expect(parseCatalogParams({ platform: ["XBOX", "STEAM"] }).platform).toBe("XBOX");
  });
});

describe("buildCatalogQs", () => {
  it("omits defaults and falsy flags", () => {
    expect(buildCatalogQs(parseCatalogParams({}))).toBe("");
    expect(buildCatalogQs(parseCatalogParams({ platform: "STEAM", inStock: "1", sort: "new", page: "2" }))).toBe("?platform=STEAM&inStock=1&sort=new&page=2");
  });
  it("applies overrides and the default sort of the page", () => {
    const q = parseCatalogParams({ sort: "relevance" });
    expect(buildCatalogQs(q, { platform: "XBOX", page: undefined }, { defaultSort: "relevance" })).toBe("?platform=XBOX");
    expect(buildCatalogQs(q, { sort: "popular" }, { defaultSort: "relevance" })).toBe("?sort=popular");
  });
});
