import { describe, expect, it } from "vitest";
import { movieTitleSchema, normalizeMovieTitle } from "@/lib/movie-title";

describe("normalizeMovieTitle", () => {
  it("makes precomposed and decomposed Amelie equal", () => {
    const precomposed = normalizeMovieTitle("Am\u00e9lie");
    const decomposed = normalizeMovieTitle("Ame\u0301lie");
    expect(decomposed).toBe(precomposed);
  });

  it("turns a newline or tab inside a title into a space", () => {
    expect(normalizeMovieTitle("Star\nWars")).toBe("Star Wars");
    expect(normalizeMovieTitle("Star\r\nWars")).toBe("Star Wars");
    expect(normalizeMovieTitle("Star\tWars")).toBe("Star Wars");
    expect(normalizeMovieTitle("Star\u2028Wars")).toBe("Star Wars");
  });

  it("keeps the zero-width joiner inside emoji sequences", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(normalizeMovieTitle(family)).toBe(family);
  });

  it("collapses runs of whitespace and trims", () => {
    expect(normalizeMovieTitle("  The   Matrix  ")).toBe("The Matrix");
  });
});

describe("movieTitleSchema", () => {
  it("accepts a normal title and returns the cleaned value", () => {
    expect(movieTitleSchema.parse("  Heat \n")).toBe("Heat");
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace"],
  ])("rejects %j (%s)", (input) => {
    expect(movieTitleSchema.safeParse(input).success).toBe(false);
  });

  it("accepts 100 characters and rejects 101", () => {
    expect(movieTitleSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(movieTitleSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("measures length after cleanup", () => {
    expect(movieTitleSchema.safeParse("a".repeat(100) + "   ").success).toBe(true);
  });
});

describe("digits are not stripped", () => {
  it("keeps 2, 0 and 8 in titles", () => {
    expect(normalizeMovieTitle("2001 A Space Odyssey")).toBe("2001 A Space Odyssey");
  });
});
