export function wrapWords(text: string, maxWidth: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const words = trimmed.split(/\s+/);

  const lines: string[] = [];
  let current = words[0] ?? "";
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  lines.push(current);
  return lines;
}
