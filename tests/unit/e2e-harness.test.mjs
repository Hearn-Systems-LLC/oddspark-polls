import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => childProcess);

import {
  cleanupCreators,
  d1Execute,
  d1Query,
  sql,
} from "../e2e/creator-session.mjs";

function executedSql() {
  const args = childProcess.execFileSync.mock.calls.at(-1)?.[1];
  return args?.at(-1);
}

beforeEach(() => {
  childProcess.execFileSync.mockReset();
  childProcess.execFileSync.mockReturnValue(JSON.stringify([{ results: [] }]));
});

describe("E2E SQL statement seam", () => {
  it("encodes supported values as SQLite literals without changing their order", () => {
    d1Execute(
      sql`VALUES (${"O'Brien\nZoë"}, ${null}, ${true}, ${false}, ${-42});`,
    );

    expect(executedSql()).toBe(
      "VALUES ('O''Brien\nZoë', NULL, 1, 0, -42);",
    );
  });

  it("rejects interpolations inside fixed SQL string literals", () => {
    expect(() => sql`VALUES ('prefix-${"O'Brien"}-suffix');`).toThrow(
      "must represent complete values",
    );
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ["NUL strings", "bad\0value"],
    ["undefined", undefined],
    ["objects", {}],
    ["fractions", 1.5],
    ["non-finite numbers", Number.POSITIVE_INFINITY],
    ["unsafe integers", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s before invoking Wrangler", (_label, value) => {
    expect(() => sql`SELECT ${value};`).toThrow();
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it("rejects unsupported values inside fixed SQL string literals", () => {
    expect(() => sql`SELECT '${Symbol("unsafe")}';`).toThrow(
      "must represent complete values",
    );
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it("composes only branded statements in exact order", () => {
    d1Execute(sql.join([sql`SELECT ${1};`, sql`SELECT ${"two"};`]));

    expect(executedSql()).toBe("SELECT 1;SELECT 'two';");
    expect(() => sql.join([sql`SELECT 1;`, "SELECT 2;"])).toThrow(
      "Expected a statement produced by the sql tag",
    );
    expect(() => sql.join([])).toThrow(
      "sql.join requires at least one SQL statement",
    );
  });

  it("rejects raw or forged statements in both D1 wrappers", () => {
    expect(() => d1Execute("SELECT 1;")).toThrow(
      "Expected a statement produced by the sql tag",
    );
    expect(() => d1Query(Object.freeze({}))).toThrow(
      "Expected a statement produced by the sql tag",
    );
    expect(() => sql("SELECT 1;")).toThrow(
      "sql must be used as a tagged template",
    );
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });
});

describe("E2E Creator cleanup aggregation", () => {
  it("attempts every Creator in caller order and retains every failure", () => {
    const first = new Error("first failed");
    const third = new Error("third failed");
    const attempted = [];

    let aggregate;
    try {
      cleanupCreators(["first", "second", "third"], (userId) => {
        attempted.push(userId);
        if (userId === "first") throw first;
        if (userId === "third") throw third;
      });
    } catch (error) {
      aggregate = error;
    }

    expect(attempted).toEqual(["first", "second", "third"]);
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toMatchObject({
      message: "Failed to clean E2E Creator first",
      cause: first,
    });
    expect(aggregate.errors[1]).toMatchObject({
      message: "Failed to clean E2E Creator third",
      cause: third,
    });
  });
});

describe("E2E harness source contract", () => {
  it("routes every D1 wrapper call through the shared SQL seam", () => {
    const files = readdirSync("tests/e2e")
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => `tests/e2e/${file}`);
    const violations = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const call of source.matchAll(
        /\bd1(?:Execute|Query)\s*\(\s*(sql(?:`|\.join\s*\()|[^\s])/gu,
      )) {
        const prefix = source.slice(Math.max(0, call.index - 16), call.index);
        if (/function\s+$/u.test(prefix)) continue;
        if (!call[1].startsWith("sql")) {
          const line = source.slice(0, call.index).split("\n").length;
          violations.push(`${file}:${line}`);
        }
      }
      if (/\bd1(?:Execute|Query)\s+as\s+/u.test(source)) {
        violations.push(`${file}:aliased D1 wrapper import`);
      }
      if (
        /\b(?:const|let|var)\s+\w+\s*=\s*d1(?:Execute|Query)\b(?!\s*\()/u.test(
          source,
        )
      ) {
        violations.push(`${file}:indirect D1 wrapper binding`);
      }
      if (/\bsqlText\b/u.test(source)) {
        violations.push(`${file}:local sqlText encoder`);
      }
      if (
        file !== "tests/e2e/creator-session.mjs" &&
        /\.replaceAll\(\s*["']'["']\s*,\s*["']''["']\s*\)/u.test(source)
      ) {
        violations.push(`${file}:local apostrophe encoder`);
      }
    }

    const harness = readFileSync("tests/e2e/creator-session.mjs", "utf8");
    expect(
      /function d1Execute\(statement\)[\s\S]{0,300}requireSqlStatement\(statement\)/u.test(
        harness,
      ),
    ).toBe(true);
    expect(
      /function d1Query\(statement\)[\s\S]{0,300}requireSqlStatement\(statement\)/u.test(
        harness,
      ),
    ).toBe(true);

    expect(violations).toEqual([]);
  });
});
