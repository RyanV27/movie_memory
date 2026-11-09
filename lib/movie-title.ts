import { z } from "zod";

// Line breaks and tabs become spaces.
const LINE_BREAKS_AND_TABS = /[\t\n\v\f\r\u2028\u2029]/g;

export function normalizeMovieTitle(raw: string): string {
  return (
    raw
      // One Unicode encoding per character.
      .normalize("NFC")
      .replace(LINE_BREAKS_AND_TABS, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Cleans the title, then checks its length.
export const movieTitleSchema = z
  .string()
  .transform(normalizeMovieTitle)
  .pipe(
    z
      .string()
      .min(1, "Enter a movie title.")
      .max(100, "Movie title must be 100 characters or fewer."),
  );
