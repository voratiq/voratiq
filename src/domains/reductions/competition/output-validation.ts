export const REQUIRED_REDUCTION_SECTION_ORDER = ["Reduction"] as const;

export function validateReductionOutputContract(options: {
  reductionMarkdown: string;
}): void {
  const { reductionMarkdown } = options;
  const normalized = reductionMarkdown.replace(/\r\n/gu, "\n");
  const trimmed = normalized.trim();
  if (trimmed.length === 0) {
    throw new Error("Reduction markdown must not be empty.");
  }

  if (!/^## Reduction\s*$/mu.test(normalized)) {
    throw new Error("Missing required section heading: ## Reduction");
  }
  if (!/^\*\*Sources\*\*:\s*.+$/mu.test(normalized)) {
    throw new Error("Missing required field: **Sources**");
  }
  if (!/^\*\*Summary\*\*:\s*.+$/mu.test(normalized)) {
    throw new Error("Missing required field: **Summary**");
  }
}
