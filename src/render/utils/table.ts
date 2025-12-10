interface TableColumn<Row> {
  header: string;
  accessor: (row: Row) => string;
  align?: "left" | "right";
}

interface RenderTableOptions<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  columnGap?: string;
}

const ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*m`, "g");

function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function padValue(
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }

  const padding = " ".repeat(width - length);
  return align === "right" ? padding + value : value + padding;
}

export function renderTable<Row>({
  columns,
  rows,
  columnGap = "  ",
}: RenderTableOptions<Row>): string[] {
  if (columns.length === 0) {
    return [];
  }

  const widths = columns.map((column) => {
    const headerLength = visibleLength(column.header);
    const rowLengths = rows.map((row) => visibleLength(column.accessor(row)));
    return Math.max(headerLength, ...rowLengths);
  });

  const headerLine = columns
    .map((column, index) =>
      padValue(column.header, widths[index], column.align),
    )
    .join(columnGap);

  const lines = [headerLine];

  for (const row of rows) {
    const values = columns.map((column, index) =>
      padValue(column.accessor(row), widths[index], column.align),
    );
    lines.push(values.join(columnGap));
  }

  return lines;
}
