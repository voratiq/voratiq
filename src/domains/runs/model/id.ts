import { randomBytes } from "node:crypto";

function generateSlug(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  let slug = "";
  for (let index = 0; index < length; index += 1) {
    const value = bytes[index] ?? 0;
    slug += alphabet[value % alphabet.length];
  }
  return slug;
}

export function generateRunId(now = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());
  const slug = generateSlug(5);

  return `${year}${month}${day}-${hours}${minutes}${seconds}-${slug}`;
}
