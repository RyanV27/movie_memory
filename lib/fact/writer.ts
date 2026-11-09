// Writes one short fact about a movie title.
export interface FactWriter {
  write(movieTitle: string): Promise<string>;
}
