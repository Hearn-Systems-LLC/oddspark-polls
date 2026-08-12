import { describe, expect, it } from "vitest";
import { parseVoterCodeForm } from "../../src/lib/voter-code-form";

function makeFormData(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [key, value] of entries) {
    fd.append(key, value);
  }
  return fd;
}

describe("parseVoterCodeForm", () => {
  const validEntries: [string, string][] = [
    ["csrf_token", "test-csrf"],
    ["intent", "generate"],
    ["count", "25"],
    ["batch_id", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
  ];

  it("parses a valid form", () => {
    const result = parseVoterCodeForm(makeFormData(validEntries));
    expect("code" in result).toBe(false);
    if (!("code" in result)) {
      expect(result.csrfToken).toBe("test-csrf");
      expect(result.intent).toBe("generate");
      expect(result.count).toBe(25);
      expect(result.batchId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }
  });

  it("rejects unknown keys", () => {
    const entries: [string, string][] = [...validEntries, ["unknown", "value"]];
    const result = parseVoterCodeForm(makeFormData(entries));
    expect("code" in result).toBe(true);
  });

  it("rejects non-canonical batch IDs", () => {
    const entries: [string, string][] = [...validEntries.filter(([k]) => k !== "batch_id") as [string, string][], ["batch_id", "NOT-A-UUID"]];
    const result = parseVoterCodeForm(makeFormData(entries));
    expect("code" in result).toBe(true);
  });

  it("rejects uppercase UUID batch IDs", () => {
    const entries: [string, string][] = [...validEntries.filter(([k]) => k !== "batch_id") as [string, string][], ["batch_id", "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"]];
    const result = parseVoterCodeForm(makeFormData(entries));
    expect("code" in result).toBe(true);
  });

  it("rejects invalid count values", () => {
    for (const badCount of ["0", "-1", "1.5", "101", "abc", ""]) {
      const entries: [string, string][] = [...validEntries.filter(([k]) => k !== "count") as [string, string][], ["count", badCount]];
      const result = parseVoterCodeForm(makeFormData(entries));
      expect("code" in result).toBe(true);
      if ("code" in result) {
        expect(result.code).toBe("voter_code_count_invalid");
      }
    }
  });

  it("rejects wrong intent", () => {
    const entries: [string, string][] = [...validEntries.filter(([k]) => k !== "intent") as [string, string][], ["intent", "delete"]];
    const result = parseVoterCodeForm(makeFormData(entries));
    expect("code" in result).toBe(true);
  });

  it("rejects missing CSRF token", () => {
    const entries = validEntries.filter(([k]) => k !== "csrf_token");
    const result = parseVoterCodeForm(makeFormData(entries));
    expect("code" in result).toBe(true);
  });

  it("rejects duplicate keys", () => {
    const fd = makeFormData(validEntries);
    fd.append("count", "50");
    const result = parseVoterCodeForm(fd);
    expect("code" in result).toBe(true);
  });
});
