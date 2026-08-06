import type {
  CanonicalExportDataset,
  CanonicalExportTable,
} from "../../modules/results/export";
import type { PollTypeExportCell } from "../../shared/application/index";

export const XLSX_WORKSHEET_ROW_LIMIT = 1_048_576;
export const XLSX_WORKSHEET_COLUMN_LIMIT = 16_384;
export const XLSX_EXPORT_VOTE_LIMIT = 1_000;

type XlsxSerializationOptions = {
  /** Supports boundary tests without allocating an Excel-sized fixture. */
  worksheetRowLimit?: number;
  worksheetColumnLimit?: number;
};

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function escapeOoxmlTokens(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "_" &&
      /^_x[0-9a-f]{4}_$/iu.test(value.slice(index, index + 7))
    ) {
      escaped += "_x005F_";
    } else {
      escaped += value[index];
    }
  }
  return escaped;
}

function literalRow(cells: readonly PollTypeExportCell[]): PollTypeExportCell[] {
  return cells.map((cell) => {
    if (typeof cell === "string") {
      if (
        cell.includes("\0") ||
        cell.includes("\r") ||
        !isWellFormedUnicode(cell)
      ) {
        throw new Error("Malformed XLSX cell");
      }
      return escapeOoxmlTokens(cell);
    }
    if (typeof cell === "number" && Number.isSafeInteger(cell)) return cell;
    throw new Error("Malformed XLSX cell");
  });
}

function appendTable(
  xlsx: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  tableName: "VOTES" | "TALLY" | "SUMMARY",
  table: CanonicalExportTable,
  worksheetRowLimit: number,
  worksheetColumnLimit: number,
): void {
  if (table.columns.length > worksheetColumnLimit) {
    throw new Error("XLSX worksheet column limit exceeded");
  }
  if (table.rows.length + 1 > worksheetRowLimit) {
    throw new Error("XLSX worksheet row limit exceeded");
  }
  const worksheet = xlsx.utils.aoa_to_sheet([
    literalRow(table.columns),
    ...table.rows.map(literalRow),
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, tableName);
}

/** Serialize one already-authorized, bounded canonical dataset in memory. */
export async function serializeXlsxExport(
  dataset: CanonicalExportDataset,
  options: XlsxSerializationOptions = {},
): Promise<ArrayBuffer> {
  const worksheetRowLimit =
    options.worksheetRowLimit ?? XLSX_WORKSHEET_ROW_LIMIT;
  const worksheetColumnLimit =
    options.worksheetColumnLimit ?? XLSX_WORKSHEET_COLUMN_LIMIT;
  if (
    !Number.isSafeInteger(worksheetRowLimit) ||
    worksheetRowLimit < 1 ||
    worksheetRowLimit > XLSX_WORKSHEET_ROW_LIMIT ||
    !Number.isSafeInteger(worksheetColumnLimit) ||
    worksheetColumnLimit < 1 ||
    worksheetColumnLimit > XLSX_WORKSHEET_COLUMN_LIMIT
  ) {
    throw new Error("Invalid XLSX worksheet limit");
  }
  if (dataset.votes.rows.length > XLSX_EXPORT_VOTE_LIMIT) {
    throw new Error("XLSX accepted Vote limit exceeded");
  }

  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();
  appendTable(
    xlsx,
    workbook,
    "VOTES",
    dataset.votes,
    worksheetRowLimit,
    worksheetColumnLimit,
  );
  appendTable(
    xlsx,
    workbook,
    "TALLY",
    dataset.tally,
    worksheetRowLimit,
    worksheetColumnLimit,
  );
  appendTable(
    xlsx,
    workbook,
    "SUMMARY",
    dataset.summary,
    worksheetRowLimit,
    worksheetColumnLimit,
  );

  return xlsx.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
    bookSST: true,
  }) as ArrayBuffer;
}
