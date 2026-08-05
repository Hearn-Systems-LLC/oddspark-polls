import { describe, expect, it } from "vitest";
import { serializeCsvExport } from "../../src/adapters/csv/index";
import type { CanonicalExportDataset } from "../../src/modules/results/export";

function dataset(): CanonicalExportDataset {
  return {
    votes: {
      columns: ["TIMESTAMP", "DISPLAY NAME", "COMMENT", "SELECTION 1"],
      rows: [
        [
          "2027-01-15T08:00:00.000Z",
          "Zoë, \"Z\"",
          "first line\nsecond line",
          "=HYPERLINK(\"https://invalid\")",
        ],
        ["2027-01-15T08:00:00.001Z", "", "\t+SUM(1,2)", "@cmd"],
      ],
    },
    tally: {
      columns: ["OPTION", "COUNT"],
      rows: [["-hostile", -2]],
    },
    summary: {
      columns: ["METRIC", "VALUE"],
      rows: [["VOTERS", 2], ["SELECTIONS", 2]],
    },
  };
}

describe("CSV export adapter", () => {
  it("emits deterministic quoted comma CSV with CRLF records and a final CRLF", () => {
    const csv = serializeCsvExport(dataset());
    expect(csv).toBe(
      [
        '"VOTES"\r\n',
        '"TIMESTAMP","DISPLAY NAME","COMMENT","SELECTION 1"\r\n',
        '"2027-01-15T08:00:00.000Z","Zoë, ""Z""","first line\nsecond line","\'=HYPERLINK(""https://invalid"")"\r\n',
        '"2027-01-15T08:00:00.001Z","","\'\t+SUM(1,2)","\'@cmd"\r\n',
        '\r\n"TALLY"\r\n',
        '"OPTION","COUNT"\r\n',
        '"\'-hostile","-2"\r\n',
        '\r\n"SUMMARY"\r\n',
        '"METRIC","VALUE"\r\n',
        '"VOTERS","2"\r\n',
        '"SELECTIONS","2"\r\n',
      ].join(""),
    );
    expect(csv).not.toContain("\ufeff");
    expect(csv.replaceAll("\r\n", "")).not.toContain("\r");
  });

  it("does not mutate the format-neutral canonical cells", () => {
    const source = dataset();
    const before = structuredClone(source);
    serializeCsvExport(source);
    expect(source).toEqual(before);
  });

  it("rejects NUL-bearing cells before emitting CSV", () => {
    const source = dataset();
    source.votes = {
      ...source.votes,
      rows: [
        [
          "2027-01-15T08:00:00.000Z",
          "Zoë",
          "\0=CMD()",
          "Alpha",
        ],
      ],
    };
    expect(() => serializeCsvExport(source)).toThrow("Malformed CSV cell");
  });

  it.each([
    ["vertical tab", "\v=CMD()"],
    ["form feed", "\f+SUM(1,2)"],
  ])("neutralizes formulas after leading ASCII %s", (_label, cell) => {
    const source = dataset();
    source.votes.rows = [
      ["2027-01-15T08:00:00.000Z", "", cell, "Alpha"],
    ];
    expect(serializeCsvExport(source)).toContain(`"'${cell}"`);
  });
});
