// Writes one short fact about a movie title; should stop when the signal aborts.
export interface FactWriter {
  write(movieTitle: string, signal?: AbortSignal): Promise<string>;
}
