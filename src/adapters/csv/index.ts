import type { CanonicalExportDataset } from "../../modules/results/export";
import type { PollTypeExportCell } from "../../shared/application/index";

function formulaSafe(value: string): string {
  if (value.includes("\0")) throw new Error("Malformed CSV cell");
  return /^[\x09-\x0D\x20]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function quoteCell(cell: PollTypeExportCell): string {
  const value = typeof cell === "string" ? formulaSafe(cell) : String(cell);
  return `"${value.replaceAll('"', '""')}"`;
}

function record(cells: readonly PollTypeExportCell[]): string {
  return `${cells.map(quoteCell).join(",")}\r\n`;
}

export function serializeCsvExport(dataset: CanonicalExportDataset): string {
  let csv = record(["VOTES"]);
  csv += record(dataset.votes.columns);
  for (const row of dataset.votes.rows) csv += record(row);
  csv += "\r\n";
  csv += record(["TALLY"]);
  csv += record(dataset.tally.columns);
  for (const row of dataset.tally.rows) csv += record(row);
  csv += "\r\n";
  csv += record(["SUMMARY"]);
  csv += record(dataset.summary.columns);
  for (const row of dataset.summary.rows) csv += record(row);
  return csv;
}
