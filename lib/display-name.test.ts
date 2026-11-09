import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

describe("displayName", () => {
  it("returns the name when present", () => {
    expect(displayName("Ada Lovelace", "ada@example.com")).toBe("Ada Lovelace");
  });

  it("falls back to the email prefix when name is null", () => {
    expect(displayName(null, "ada@example.com")).toBe("ada");
  });

  it("falls back to the email prefix when name is undefined", () => {
    expect(displayName(undefined, "ada@example.com")).toBe("ada");
  });

  it("falls back to the email prefix when name is only whitespace", () => {
    expect(displayName("   ", "ada@example.com")).toBe("ada");
  });

  it("trims surrounding spaces from the name", () => {
    expect(displayName("  Ada  ", "ada@example.com")).toBe("Ada");
  });
});
