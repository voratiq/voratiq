export function sanitizeSlug(value: string): string {
  const withoutLinks = value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const normalized = withoutLinks
    .toLowerCase()
    .replace(/[`*~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return normalized;
}
