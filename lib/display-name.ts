// Name if present, else the email prefix before "@".
export function displayName(name: string | null | undefined, email: string | null | undefined): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return email?.split("@")[0] ?? "";
}
