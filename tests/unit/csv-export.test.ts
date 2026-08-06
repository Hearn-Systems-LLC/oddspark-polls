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

  it.each([
    [
      "VOTES header",
      (source: CanonicalExportDataset) => {
        source.votes = { columns: ["\0=CMD()"], rows: [["safe"]] };
      },
    ],
    [
      "VOTES row",
      (source: CanonicalExportDataset) => {
        source.votes = { columns: ["SAFE"], rows: [["\0=CMD()"]] };
      },
    ],
    [
      "TALLY header",
      (source: CanonicalExportDataset) => {
        source.tally = { columns: ["\0=CMD()"], rows: [["safe"]] };
      },
    ],
    [
      "TALLY row",
      (source: CanonicalExportDataset) => {
        source.tally = { columns: ["SAFE"], rows: [["\0=CMD()"]] };
      },
    ],
    [
      "SUMMARY header",
      (source: CanonicalExportDataset) => {
        source.summary = { columns: ["\0=CMD()"], rows: [["safe"]] };
      },
    ],
    [
      "SUMMARY row",
      (source: CanonicalExportDataset) => {
        source.summary = { columns: ["SAFE"], rows: [["\0=CMD()"]] };
      },
    ],
  ] as const)("rejects NUL-bearing cells in the %s", (_label, placeNul) => {
    const source = dataset();
    placeNul(source);
    const before = structuredClone(source);

    expect(() => serializeCsvExport(source)).toThrow("Malformed CSV cell");
    expect(source).toEqual(before);
  });

  it.each(
    [
      ["tab", "\t"],
      ["line feed", "\n"],
      ["vertical tab", "\v"],
      ["form feed", "\f"],
      ["carriage return", "\r"],
      ["space", " "],
      ["mixed ASCII whitespace", "\t \v\f\r\n"],
    ].flatMap(([whitespaceName, whitespace]) =>
      ["=", "+", "-", "@"].map((marker) => [
        `${whitespaceName} plus ${marker}`,
        `${whitespace}${marker}CMD()`,
      ]),
    ),
  )(
    "neutralizes formulas after leading ASCII %s in every exported text location",
    (_label, cell) => {
      const source = dataset();
      source.votes = { columns: [cell], rows: [[cell]] };
      source.tally = { columns: [cell], rows: [[cell]] };
      source.summary = { columns: [cell], rows: [[cell]] };
      const before = structuredClone(source);

      const csv = serializeCsvExport(source);
      const encoded = `"'${cell}"`;
      expect(csv.split(encoded)).toHaveLength(7);
      expect(source).toEqual(before);
    },
  );

  it.each([
    ["ordinary text", "Alpha"],
    ["marker after text", "Alpha=CMD()"],
    ["minus inside text", "1-2"],
    ["apostrophe before a marker", "\t'=CMD()"],
    ["non-ASCII whitespace", "\u00a0=CMD()"],
  ])("does not alter safe non-formula %s", (_label, cell) => {
    const source = dataset();
    source.votes = { columns: ["VALUE"], rows: [[cell]] };
    const before = structuredClone(source);

    expect(serializeCsvExport(source)).toContain(
      `"${cell.replaceAll('"', '""')}"`,
    );
    expect(source).toEqual(before);
  });
});
