import { describe, expect, it } from "vitest";
import { plural, initials } from "./utils";

describe("utils", () => {
  it("plural", () => {
    expect(plural(1, ["товар", "товара", "товаров"])).toBe("товар");
    expect(plural(3, ["товар", "товара", "товаров"])).toBe("товара");
    expect(plural(11, ["товар", "товара", "товаров"])).toBe("товаров");
  });
  it("initials", () => expect(initials("Иван Петров")).toBe("ИП"));
});
