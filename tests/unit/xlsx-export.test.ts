import { describe, expect, it } from "vitest";
import { read, utils, type WorkBook, type WorkSheet } from "xlsx";
import { serializeXlsxExport } from "../../src/adapters/xlsx/index";
import type { CanonicalExportDataset } from "../../src/modules/results/export";

function dataset(): CanonicalExportDataset {
  return {
    votes: {
      columns: ["TIMESTAMP", "DISPLAY NAME", "COMMENT", "SELECTION 1"],
      rows: [
        [
          "2027-01-15T08:00:00.000Z",
          "Zoë, \"Z\"",
          "literal _x000A_\nsecond line",
          "=HYPERLINK(\"https://invalid\")",
        ],
        ["2027-01-15T08:00:00.001Z", "", "\t+SUM(1,2)", "@cmd"],
      ],
    },
    tally: { columns: ["OPTION", "COUNT"], rows: [["-hostile", 2]] },
    summary: {
      columns: ["METRIC", "VALUE"],
      rows: [["VOTERS", 2], ["SELECTIONS", 2]],
    },
  };
}

function parse(bytes: ArrayBuffer): WorkBook {
  return read(bytes, { type: "array", cellFormula: true });
}

function rows(sheet: WorkSheet): unknown[][] {
  return utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
}

describe("XLSX export adapter", () => {
  it("round-trips exactly three ordered sheets with literal cell types", async () => {
    const source = dataset();
    const workbook = parse(await serializeXlsxExport(source));
    expect(workbook.SheetNames).toEqual(["VOTES", "TALLY", "SUMMARY"]);
    expect(rows(workbook.Sheets.VOTES!)).toEqual([
      source.votes.columns,
      ...source.votes.rows,
    ]);
    expect(rows(workbook.Sheets.TALLY!)).toEqual([
      source.tally.columns,
      ...source.tally.rows,
    ]);
    expect(rows(workbook.Sheets.SUMMARY!)).toEqual([
      source.summary.columns,
      ...source.summary.rows,
    ]);
    for (const sheet of Object.values(workbook.Sheets)) {
      for (const cell of Object.values(sheet)) {
        if (typeof cell !== "object" || cell === null || !("t" in cell)) continue;
        expect(cell).not.toHaveProperty("f");
        expect(cell).not.toHaveProperty("l");
        expect(["s", "n"]).toContain(cell.t);
      }
    }
  });

  it("does not mutate the canonical dataset", async () => {
    const source = dataset();
    const before = structuredClone(source);
    await serializeXlsxExport(source);
    expect(source).toEqual(before);
  });

  it("emits header-only VOTES with zero-inclusive Tally and Summary", async () => {
    const source = dataset();
    source.votes.rows = [];
    source.tally.rows = [["Alpha", 0], ["Beta", 0]];
    source.summary.rows = [["VOTERS", 0], ["SELECTIONS", 0]];
    const workbook = parse(await serializeXlsxExport(source));
    expect(rows(workbook.Sheets.VOTES!)).toEqual([source.votes.columns]);
    expect(rows(workbook.Sheets.TALLY!)).toEqual([
      source.tally.columns,
      ...source.tally.rows,
    ]);
  });

  it("fails closed instead of truncating or creating continuation sheets", async () => {
    const tooManyVotes = dataset();
    tooManyVotes.votes.rows = Array.from({ length: 1_001 }, () => [
      "2027-01-15T08:00:00.000Z",
      "",
      "",
      "Alpha",
    ]);
    await expect(serializeXlsxExport(tooManyVotes)).rejects.toThrow(
      "XLSX accepted Vote limit exceeded",
    );
    await expect(
      serializeXlsxExport(dataset(), { worksheetRowLimit: 2 }),
    ).rejects.toThrow("XLSX worksheet row limit exceeded");
    await expect(
      serializeXlsxExport(dataset(), { worksheetColumnLimit: 3 }),
    ).rejects.toThrow("XLSX worksheet column limit exceeded");

    const emptyColumns = dataset();
    emptyColumns.summary = { columns: [], rows: [] };
    await expect(serializeXlsxExport(emptyColumns)).rejects.toThrow(
      "XLSX worksheet column limit exceeded",
    );

    for (const raggedRow of [
      ["2027-01-15T08:00:00.000Z", "", ""],
      ["2027-01-15T08:00:00.000Z", "", "", "Alpha", "unexpected"],
    ]) {
      const ragged = dataset();
      ragged.votes.rows = [raggedRow];
      await expect(serializeXlsxExport(ragged)).rejects.toThrow(
        "Malformed XLSX table row",
      );
    }
  });

  it("rejects NUL, CR, malformed Unicode, unsafe numbers, and invalid limits", async () => {
    for (const invalid of ["\0=CMD()", "first\r\nsecond", "invalid \ud800 text"]) {
      const source = dataset();
      source.votes.rows = [
        ["2027-01-15T08:00:00.000Z", "", invalid, "Alpha"],
      ];
      await expect(serializeXlsxExport(source)).rejects.toThrow(
        "Malformed XLSX cell",
      );
    }
    const unsafe = dataset();
    unsafe.summary.rows = [
      ["VOTERS", Number.MAX_SAFE_INTEGER + 1],
      ["SELECTIONS", 2],
    ];
    await expect(serializeXlsxExport(unsafe)).rejects.toThrow(
      "Malformed XLSX cell",
    );
    await expect(
      serializeXlsxExport(dataset(), { worksheetRowLimit: 0 }),
    ).rejects.toThrow("Invalid XLSX worksheet limit");
  });
});
