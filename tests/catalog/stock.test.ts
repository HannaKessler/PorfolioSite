import { describe, expect, it } from "vitest";
import { addToCartLabel, isOutOfStock } from "../../src/scripts/catalog-data";

const fixture = (stock: number, availabilityStatus: string) => ({ stock, availabilityStatus });

describe("isOutOfStock", () => {
  it("treats stock 0 as out of stock", () => {
    expect(isOutOfStock(fixture(0, "In Stock"))).toBe(true);
  });

  it("treats an Out of Stock status as out of stock even when a count remains", () => {
    expect(isOutOfStock(fixture(4, "Out of Stock"))).toBe(true);
  });

  it("treats matching stock and status as out of stock", () => {
    expect(isOutOfStock(fixture(0, "Out of Stock"))).toBe(true);
  });

  it("leaves in-stock and low-stock items available", () => {
    expect(isOutOfStock(fixture(12, "In Stock"))).toBe(false);
    expect(isOutOfStock(fixture(3, "Low Stock"))).toBe(false);
  });
});

describe("addToCartLabel", () => {
  it("labels out-of-stock items for the disabled button", () => {
    expect(addToCartLabel(fixture(0, "Out of Stock"))).toBe("Out of Stock");
  });

  it("keeps the add-to-cart label when the item is available", () => {
    expect(addToCartLabel(fixture(8, "In Stock"))).toBe("Add to Cart");
  });
});
