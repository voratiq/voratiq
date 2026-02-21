export const REQUIRED_REVIEW_SECTION_ORDER = [
  "Specification",
  "Key Requirements",
  "Candidate Assessments",
  "Comparison",
  "Ranking",
  "Recommendation",
] as const;

type RequiredReviewSection = (typeof REQUIRED_REVIEW_SECTION_ORDER)[number];

interface ParsedSection {
  title: string;
  startLine: number;
  endLine: number;
}

interface ParsedCandidateAssessment {
  candidateId: string;
  body: string;
}

export interface ValidatedReviewOutput {
  ranking: string[];
}

export function validateReviewOutputContract(options: {
  reviewMarkdown: string;
  eligibleCandidateIds: readonly string[];
}): ValidatedReviewOutput {
  const { reviewMarkdown, eligibleCandidateIds } = options;

  const expectedCandidates = normalizeCandidateIds(eligibleCandidateIds);
  if (expectedCandidates.length === 0) {
    throw new Error(
      "No eligible candidates were provided for review validation.",
    );
  }

  const lines = splitMarkdownLines(reviewMarkdown);
  const sections = parseTopLevelSections(lines);
  const sectionMap = validateRequiredSectionOrder(sections);

  const candidateAssessments = parseCandidateAssessmentsSection({
    lines,
    section: getRequiredSection(sectionMap, "Candidate Assessments"),
  });

  validateCandidateAssessments({
    assessments: candidateAssessments,
    expectedCandidates,
  });

  const ranking = parseRankingSection({
    lines,
    section: getRequiredSection(sectionMap, "Ranking"),
  });

  validateRankingCoverage({
    ranking,
    expectedCandidates,
  });

  return { ranking };
}

function splitMarkdownLines(markdown: string): string[] {
  return markdown.replace(/\r\n/gu, "\n").split("\n");
}

function parseTopLevelSections(lines: readonly string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const heading = parseHeadingLine(line);
    if (!heading || heading.level !== 2) {
      continue;
    }

    sections.push({
      title: heading.title,
      startLine: index,
      endLine: lines.length - 1,
    });
  }

  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index];
    const nextSection = sections[index + 1];
    if (!current || !nextSection) {
      continue;
    }
    current.endLine = nextSection.startLine - 1;
  }

  return sections;
}

function validateRequiredSectionOrder(
  sections: readonly ParsedSection[],
): Map<RequiredReviewSection, ParsedSection> {
  const requiredSet = new Set<string>(REQUIRED_REVIEW_SECTION_ORDER);
  const requiredOrderIndices = new Map<RequiredReviewSection, number>();
  const requiredSections = new Map<RequiredReviewSection, ParsedSection>();

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }
    if (!requiredSet.has(section.title)) {
      continue;
    }

    const title = section.title as RequiredReviewSection;
    if (requiredSections.has(title)) {
      throw new Error(`Duplicate required section heading: ## ${title}`);
    }

    requiredSections.set(title, section);
    requiredOrderIndices.set(title, index);
  }

  for (const sectionTitle of REQUIRED_REVIEW_SECTION_ORDER) {
    if (!requiredSections.has(sectionTitle)) {
      throw new Error(`Missing required section heading: ## ${sectionTitle}`);
    }
  }

  for (
    let index = 1;
    index < REQUIRED_REVIEW_SECTION_ORDER.length;
    index += 1
  ) {
    const left = REQUIRED_REVIEW_SECTION_ORDER[index - 1];
    const right = REQUIRED_REVIEW_SECTION_ORDER[index];
    if (!left || !right) {
      continue;
    }
    const leftPosition = requiredOrderIndices.get(left);
    const rightPosition = requiredOrderIndices.get(right);

    if (
      typeof leftPosition !== "number" ||
      typeof rightPosition !== "number" ||
      leftPosition >= rightPosition
    ) {
      throw new Error(
        `Section order is invalid. Expected ## ${left} before ## ${right}.`,
      );
    }
  }

  return requiredSections;
}

function getRequiredSection(
  sectionMap: Map<RequiredReviewSection, ParsedSection>,
  title: RequiredReviewSection,
): ParsedSection {
  const section = sectionMap.get(title);
  if (!section) {
    throw new Error(`Missing required section heading: ## ${title}`);
  }
  return section;
}

function parseCandidateAssessmentsSection(options: {
  lines: readonly string[];
  section: ParsedSection;
}): ParsedCandidateAssessment[] {
  const { lines, section } = options;

  const headings: Array<{ candidateId: string; line: number }> = [];
  for (
    let lineIndex = section.startLine + 1;
    lineIndex <= section.endLine;
    lineIndex += 1
  ) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }

    const heading = parseHeadingLine(line);
    if (!heading || heading.level !== 3) {
      continue;
    }

    headings.push({ candidateId: heading.title, line: lineIndex });
  }

  if (headings.length === 0) {
    throw new Error(
      "Section ## Candidate Assessments must include per-candidate entries as level-3 headings.",
    );
  }

  const assessments: ParsedCandidateAssessment[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    if (!current) {
      continue;
    }
    const next = headings[index + 1];
    const blockStart = current.line + 1;
    const blockEnd = (next?.line ?? section.endLine + 1) - 1;
    const body =
      blockStart <= blockEnd
        ? lines.slice(blockStart, blockEnd + 1).join("\n")
        : "";

    assessments.push({
      candidateId: current.candidateId,
      body,
    });
  }

  return assessments;
}

function validateCandidateAssessments(options: {
  assessments: readonly ParsedCandidateAssessment[];
  expectedCandidates: readonly string[];
}): void {
  const { assessments, expectedCandidates } = options;

  const expectedSorted = [...expectedCandidates].sort((left, right) =>
    left.localeCompare(right),
  );
  const assessmentIds = assessments.map((assessment) => assessment.candidateId);

  assertUnique(
    assessmentIds,
    "Candidate assessments contain duplicate entries",
  );

  const assessmentSet = new Set(assessmentIds);
  const expectedSet = new Set(expectedSorted);

  const unknown = assessmentIds.filter(
    (candidateId) => !expectedSet.has(candidateId),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Candidate assessments include unknown candidate id(s): ${unknown.join(", ")}.`,
    );
  }

  const missing = expectedSorted.filter(
    (candidateId) => !assessmentSet.has(candidateId),
  );
  if (missing.length > 0) {
    throw new Error(
      `Candidate assessments are missing candidate id(s): ${missing.join(", ")}.`,
    );
  }

  if (!arraysEqual(assessmentIds, expectedSorted)) {
    throw new Error(
      `Candidate assessments must be ordered lexicographically by candidate id. Expected: ${expectedSorted.join(", ")}. Received: ${assessmentIds.join(", ")}.`,
    );
  }
}

function parseRankingSection(options: {
  lines: readonly string[];
  section: ParsedSection;
}): string[] {
  const { lines, section } = options;

  const rankingItems: Array<{ index: number; candidateId: string }> = [];

  for (
    let lineIndex = section.startLine + 1;
    lineIndex <= section.endLine;
    lineIndex += 1
  ) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }

    const match = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/u);
    if (!match) {
      continue;
    }

    const numericToken = match[1];
    const candidateToken = match[2];
    if (!numericToken || !candidateToken) {
      continue;
    }

    const numericIndex = Number.parseInt(numericToken, 10);
    if (!Number.isFinite(numericIndex) || numericIndex <= 0) {
      throw new Error(
        `Ranking entry has an invalid numeric index: ${line.trim()}`,
      );
    }

    rankingItems.push({
      index: numericIndex,
      candidateId: unwrapMarkdownCodeSpan(candidateToken),
    });
  }

  if (rankingItems.length === 0) {
    throw new Error("Section ## Ranking is missing ordered list entries.");
  }

  const ranking = rankingItems.map((item) => item.candidateId);
  assertUnique(ranking, "Ranking contains duplicate candidate ids");

  for (
    let expectedIndex = 1;
    expectedIndex <= rankingItems.length;
    expectedIndex += 1
  ) {
    const actual = rankingItems[expectedIndex - 1]?.index;
    if (actual !== expectedIndex) {
      throw new Error(
        `Ranking must be a strict sequence from 1..N without gaps. Expected ${expectedIndex}.`,
      );
    }
  }

  return ranking;
}

function validateRankingCoverage(options: {
  ranking: readonly string[];
  expectedCandidates: readonly string[];
}): void {
  const { ranking, expectedCandidates } = options;
  const expectedSet = new Set(expectedCandidates);
  const rankingSet = new Set(ranking);

  const unknown = ranking.filter(
    (candidateId) => !expectedSet.has(candidateId),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Ranking contains unknown candidate id(s): ${unknown.join(", ")}.`,
    );
  }

  const missing = expectedCandidates.filter(
    (candidateId) => !rankingSet.has(candidateId),
  );
  if (missing.length > 0) {
    throw new Error(
      `Ranking must include every eligible candidate exactly once; missing: ${missing.join(", ")}.`,
    );
  }

  if (ranking.length !== expectedCandidates.length) {
    throw new Error(
      `Ranking must include every eligible candidate exactly once; expected ${expectedCandidates.length} entries but found ${ranking.length}.`,
    );
  }
}

function parseHeadingLine(
  line: string,
): { level: number; title: string } | undefined {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
  if (!match) {
    return undefined;
  }

  const marker = match[1];
  const rawTitle = match[2];
  if (!marker || !rawTitle) {
    return undefined;
  }

  const level = marker.length;
  const title = normalizeHeadingTitle(rawTitle);
  if (!title) {
    return undefined;
  }

  return {
    level,
    title,
  };
}

function normalizeHeadingTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeCandidateIds(candidateIds: readonly string[]): string[] {
  const normalized = candidateIds.map((candidateId) => candidateId.trim());
  const nonEmpty = normalized.filter((candidateId) => candidateId.length > 0);
  assertUnique(nonEmpty, "Eligible candidate ids contain duplicates");
  return nonEmpty;
}

function unwrapMarkdownCodeSpan(value: string): string {
  const trimmed = value.trim();
  const codeSpan = trimmed.match(/^`([^`]+)`$/u);
  if (codeSpan) {
    const inner = codeSpan[1];
    return inner ? inner.trim() : trimmed;
  }
  return trimmed;
}

function assertUnique(values: readonly string[], message: string): void {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(message);
  }
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
