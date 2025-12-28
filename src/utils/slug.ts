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

export function slugify(value: string, fallback: string): string {
  const normalized = sanitizeSlug(value);
  return normalized.length > 0 ? normalized : fallback;
}
