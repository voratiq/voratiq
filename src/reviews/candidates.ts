import { randomInt } from "node:crypto";

export const BLINDED_ALIAS_PATTERN = /^r_[a-z0-9]{10,16}$/u;

const ALIAS_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export type BlindedCandidateAlias = `r_${string}`;

export function isBlindedCandidateAlias(
  value: string,
): value is BlindedCandidateAlias {
  return BLINDED_ALIAS_PATTERN.test(value);
}

export function generateBlindedCandidateAlias(options: {
  seen: ReadonlySet<string>;
  length?: number;
}): BlindedCandidateAlias {
  const { seen, length = 12 } = options;
  if (!Number.isInteger(length) || length < 10 || length > 16) {
    throw new Error("Blinded alias length must be an integer in [10, 16].");
  }

  for (let attempt = 0; attempt < 512; attempt += 1) {
    let suffix = "";
    for (let i = 0; i < length; i += 1) {
      suffix += ALIAS_ALPHABET[randomInt(ALIAS_ALPHABET.length)];
    }
    const alias = `r_${suffix}` as const;
    if (!seen.has(alias)) {
      return alias;
    }
  }

  throw new Error("Failed to generate unique blinded alias.");
}
