import { describe, expect, it } from "vitest";
import { formatRub, rubToKopecks, splitCommission, discountPercent } from "./money";
import { decryptStock, encryptStock, parseStockKey, generateApiKey, hashApiKey, isApiKeyFormat } from "./crypto";

describe("money", () => {
  it("converts and formats", () => {
    expect(rubToKopecks("199,99")).toBe(19999);
    expect(rubToKopecks(0.1 + 0.2)).toBe(30);
    expect(formatRub(150000)).toBe("1 500 ₽");
    expect(formatRub(19999)).toBe("199,99 ₽");
  });
  it("splits commission", () => {
    expect(splitCommission(10_000, 1000)).toEqual({ fee: 1000, net: 9000 });
    expect(splitCommission(999, 1000)).toEqual({ fee: 100, net: 899 });
  });
  it("discount", () => expect(discountPercent(7500, 10000)).toBe(25));
});

describe("crypto", () => {
  it("roundtrips AES-GCM", () => {
    const key = parseStockKey("ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=");
    const enc = encryptStock("AAAAA-BBBBB-CCCCC", key);
    expect(decryptStock(enc, key)).toBe("AAAAA-BBBBB-CCCCC");
    expect(enc).not.toContain("AAAAA");
  });
  it("api keys", () => {
    const k = generateApiKey();
    expect(isApiKeyFormat(k.key)).toBe(true);
    expect(hashApiKey(k.key)).toBe(k.hash);
  });
});
