import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import { deflateRawSync } from "zlib";
import {
  assertSafeArchive,
  buildCaseTemplate,
  parseCaseWorkbook,
  WorkbookError,
  CASES_SHEET,
  STEPS_SHEET,
  LIMITS,
} from "../../lib/excelCases";

type Rows = Array<Array<string | number | null>>;

/** Build an in-memory workbook from raw rows (row 0 is the header). */
async function workbook(sheets: Record<string, Rows>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = wb.addWorksheet(name);
    rows.forEach((r) => sheet.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const CASE_HEADER = [
  "Case ID", "Suite Path", "Title", "Priority", "Test Level",
  "Preconditions", "Tags", "Estimated Minutes", "Requirements",
];
const STEP_HEADER = ["Case ID", "Step", "Action", "Expected Result"];

function codes(issues: Array<{ code: string }>) {
  return issues.map((i) => i.code);
}

describe("buildCaseTemplate", () => {
  it("produces a workbook that parses back into its own sample rows", async () => {
    const buffer = await buildCaseTemplate();
    const parsed = await parseCaseWorkbook(buffer);

    expect(parsed.issues).toEqual([]);
    expect(parsed.cases).toHaveLength(2);

    const [first, second] = parsed.cases;
    expect(first.externalId).toBe("TC-001");
    expect(first.suitePath).toEqual(["LMS", "Assignments"]);
    expect(first.priority).toBe("HIGH");
    expect(first.testLevel).toBe("REGRESSION");
    expect(first.tags).toEqual(["lms", "assignments"]);
    expect(first.estimatedMinutes).toBe(5);
    expect(first.requirements).toEqual(["REQ-114"]);
    expect(first.steps).toHaveLength(2);
    expect(first.steps[0]).toEqual({
      action: "Open My Assignments",
      expected: "The assignment list is displayed",
    });
    expect(second.suitePath).toEqual(["LMS", "Training Proof"]);
  });

  it("ships the three documented sheets", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildCaseTemplate()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual([CASES_SHEET, STEPS_SHEET, "Instructions"]);
  });

  it("is byte-stable across builds so the download can be cached", async () => {
    const [a, b] = await Promise.all([buildCaseTemplate(), buildCaseTemplate()]);
    expect(a.equals(b)).toBe(true);
  });

  it("stays byte-stable when built at different times (zip entries carry no clock)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      const a = await buildCaseTemplate();
      vi.setSystemTime(new Date("2026-06-15T18:47:13Z"));
      const b = await buildCaseTemplate();
      expect(a.equals(b)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assertSafeArchive — decompression guard", () => {
  /**
   * Build a real, valid zip. `realBytes` is how much each entry ACTUALLY
   * inflates to; `declared` is what the headers claim. The two are deliberately
   * separate: the size fields are attacker-controlled, so the guard must not
   * believe them.
   */
  function craftZip(entries: Array<{ name: string; realBytes: number; declared?: number }>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const e of entries) {
      const name = Buffer.from(e.name, "utf8");
      const payload = deflateRawSync(Buffer.alloc(e.realBytes, 0x41), { level: 9 });
      const declared = e.declared ?? e.realBytes;

      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8); // deflate
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(declared, 22);
      local.writeUInt16LE(name.length, 26);
      name.copy(local, 30);
      locals.push(local, payload);

      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(payload.length, 20);
      central.writeUInt32LE(declared, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      name.copy(central, 46);
      centrals.push(central);

      offset += local.length + payload.length;
    }

    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, cd, eocd]);
  }

  const OVER_CAP = LIMITS.maxUncompressedBytes + 8 * 1024 * 1024;

  it("accepts the real template", async () => {
    // Sanity check that the guard doesn't reject legitimate workbooks.
    await expect(assertSafeArchive(await buildCaseTemplate())).resolves.toBeUndefined();
  });

  it("measures actual inflated bytes rather than trusting the declared size", async () => {
    // Regression: the declared size is attacker-controlled. A zip claiming one
    // byte per entry must still be caught when it really inflates past the cap.
    const bomb = craftZip([{ name: "xl/worksheets/sheet1.xml", realBytes: OVER_CAP, declared: 1 }]);
    expect(bomb.length).toBeLessThan(512 * 1024); // small on the wire...
    await expect(assertSafeArchive(bomb)).rejects.toThrow("IMPORT_ARCHIVE_TOO_LARGE"); // ...caught anyway
  });

  it("allows a lying declaration when the real content is within the cap", async () => {
    // The declaration being wrong is not itself an error — only the real size
    // matters, so honest-but-mislabelled files still import.
    const ok = craftZip([{ name: "sheet.xml", realBytes: 2 * 1024 * 1024, declared: 1 }]);
    await expect(assertSafeArchive(ok)).resolves.toBeUndefined();
  });

  it("rejects an archive whose entries sum past the limit", async () => {
    const chunk = Math.ceil(LIMITS.maxUncompressedBytes / 4);
    const bomb = craftZip(
      Array.from({ length: 5 }, (_, i) => ({ name: `part${i}.xml`, realBytes: chunk, declared: 1 })),
    );
    await expect(assertSafeArchive(bomb)).rejects.toThrow("IMPORT_ARCHIVE_TOO_LARGE");
  });

  it("rejects an archive with an absurd number of entries", async () => {
    const bomb = craftZip(
      Array.from({ length: LIMITS.maxArchiveEntries + 1 }, (_, i) => ({ name: `f${i}`, realBytes: 1 })),
    );
    await expect(assertSafeArchive(bomb)).rejects.toThrow("IMPORT_ARCHIVE_TOO_LARGE");
  });

  it("rejects a file with no zip end-of-central-directory record", async () => {
    await expect(assertSafeArchive(Buffer.alloc(200))).rejects.toThrow("IMPORT_FILE_UNREADABLE");
  });

  it("runs before ExcelJS inflates anything", async () => {
    const bomb = craftZip([{ name: "big.xml", realBytes: OVER_CAP, declared: 1 }]);
    await expect(parseCaseWorkbook(bomb)).rejects.toThrow("IMPORT_ARCHIVE_TOO_LARGE");
  });
});

describe("parseCaseWorkbook — structural failures", () => {
  it("rejects a file that is not a workbook", async () => {
    await expect(parseCaseWorkbook(Buffer.from("this is not xlsx"))).rejects.toBeInstanceOf(WorkbookError);
  });

  it("rejects a sheet with no Title column", async () => {
    const buffer = await workbook({ [CASES_SHEET]: [["Case ID", "Suite Path"], ["TC-1", "A"]] });
    await expect(parseCaseWorkbook(buffer)).rejects.toThrow("IMPORT_TITLE_COLUMN_MISSING");
  });

  it("rejects a sheet with no Suite Path column", async () => {
    const buffer = await workbook({ [CASES_SHEET]: [["Case ID", "Title"], ["TC-1", "x"]] });
    await expect(parseCaseWorkbook(buffer)).rejects.toThrow("IMPORT_SUITE_COLUMN_MISSING");
  });

  it("rejects a sheet with no Case ID column", async () => {
    const buffer = await workbook({ [CASES_SHEET]: [["Suite Path", "Title"], ["A", "x"]] });
    await expect(parseCaseWorkbook(buffer)).rejects.toThrow("IMPORT_CASE_ID_COLUMN_MISSING");
  });

  it("falls back to the first sheet when the template sheet was renamed", async () => {
    const buffer = await workbook({
      "My Cases": [CASE_HEADER, ["TC-1", "LMS", "Title here", "", "", "", "", "", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].title).toBe("Title here");
  });
});

describe("parseCaseWorkbook — case rows", () => {
  it("applies MEDIUM / REGRESSION defaults and parses nested suite paths", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", " LMS > Skills > Levels ", "My level indicator", "", "", "", "", "", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);

    expect(parsed.issues).toEqual([]);
    expect(parsed.cases[0].priority).toBe("MEDIUM");
    expect(parsed.cases[0].testLevel).toBe("REGRESSION");
    expect(parsed.cases[0].suitePath).toEqual(["LMS", "Skills", "Levels"]);
    expect(parsed.cases[0].preconditions).toBeNull();
  });

  it("accepts enum values in any case", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", "LMS", "t", "high", "smoke", "", "", "", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.cases[0].priority).toBe("HIGH");
    expect(parsed.cases[0].testLevel).toBe("SMOKE");
  });

  it("splits tags on commas and requirements on semicolons/newlines", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", "LMS", "t", "", "", "", " a , b ,, c ", "", "REQ-1;REQ-2\nREQ-3"]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.cases[0].tags).toEqual(["a", "b", "c"]);
    expect(parsed.cases[0].requirements).toEqual(["REQ-1", "REQ-2", "REQ-3"]);
  });

  it("reports invalid priority, test level, and estimate — and drops the row", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "bad priority", "URGENT", "", "", "", "", ""],
        ["TC-2", "LMS", "bad level", "", "NIGHTLY", "", "", "", ""],
        ["TC-3", "LMS", "bad estimate", "", "", "", "", "-4", ""],
        ["TC-4", "LMS", "good", "LOW", "SANITY", "", "", "7", ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);

    expect(codes(parsed.issues)).toEqual([
      "IMPORT_PRIORITY_INVALID",
      "IMPORT_TEST_LEVEL_INVALID",
      "IMPORT_ESTIMATE_INVALID",
    ]);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].externalId).toBe("TC-4");
    // Row numbers are 1-based sheet rows so the user can jump straight to them.
    expect(parsed.issues[0].row).toBe(2);
    expect(parsed.issues[2].row).toBe(4);
  });

  it("requires Case ID, Title, and Suite Path", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["", "LMS", "no id", "", "", "", "", "", ""],
        ["TC-2", "LMS", "", "", "", "", "", "", ""],
        ["TC-3", "", "no suite", "", "", "", "", "", ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual([
      "IMPORT_CASE_ID_REQUIRED",
      "IMPORT_TITLE_REQUIRED",
      "IMPORT_SUITE_REQUIRED",
    ]);
    expect(parsed.cases).toEqual([]);
  });

  it("rejects every row sharing a duplicated Case ID, not just the later one", async () => {
    // Keeping the first row would silently adopt the other's steps.
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "first", "", "", "", "", "", ""],
        ["TC-1", "LMS", "second", "", "", "", "", "", ""],
        ["TC-2", "LMS", "untouched", "", "", "", "", "", ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_CASE_ID_DUPLICATE", "IMPORT_CASE_ID_DUPLICATE"]);
    expect(parsed.issues.map((i) => i.row)).toEqual([2, 3]);
    expect(parsed.cases.map((c) => c.externalId)).toEqual(["TC-2"]);
  });

  it("does not attach steps to a case whose ID was ambiguous", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "first", "", "", "", "", "", ""],
        ["TC-1", "LMS", "second", "", "", "", "", "", ""],
      ],
      [STEPS_SHEET]: [STEP_HEADER, ["TC-1", 1, "who do I belong to?", "nobody knows"]],
    });
    const parsed = await parseCaseWorkbook(buffer);

    expect(parsed.cases).toEqual([]);
    expect(codes(parsed.issues)).toEqual([
      "IMPORT_CASE_ID_DUPLICATE",
      "IMPORT_CASE_ID_DUPLICATE",
      "IMPORT_STEP_AMBIGUOUS_CASE_ID",
    ]);
    expect(parsed.issues[2]).toMatchObject({ sheet: STEPS_SHEET, row: 2, value: "TC-1" });
  });

  it("rejects an estimate above the 32-bit column bound", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "int overflow", "", "", "", "", 2147483648, ""],
        ["TC-2", "LMS", "at the limit", "", "", "", "", LIMITS.maxEstimatedMinutes, ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_ESTIMATE_TOO_LARGE"]);
    expect(parsed.issues[0].value).toBe(String(LIMITS.maxEstimatedMinutes));
    expect(parsed.cases.map((c) => c.externalId)).toEqual(["TC-2"]);
  });

  it("reports too many tags instead of silently dropping them", async () => {
    const tags = Array.from({ length: LIMITS.maxTags + 1 }, (_, i) => `t${i}`).join(",");
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", "LMS", "tag flood", "", "", "", tags, "", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_TOO_MANY_TAGS"]);
    expect(parsed.issues[0].value).toBe(String(LIMITS.maxTags));
    expect(parsed.cases).toEqual([]);
  });

  it("reports too many requirements instead of silently dropping them", async () => {
    const reqs = Array.from({ length: LIMITS.maxRequirements + 1 }, (_, i) => `REQ-${i}`).join(";");
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", "LMS", "req flood", "", "", "", "", "", reqs]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_TOO_MANY_REQUIREMENTS"]);
    expect(parsed.cases).toEqual([]);
  });

  it("rejects a suite path deeper than the limit", async () => {
    const deep = Array.from({ length: LIMITS.maxSuiteDepth + 1 }, (_, i) => `L${i}`).join(" > ");
    const buffer = await workbook({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", deep, "t", "", "", "", "", "", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_SUITE_TOO_DEEP"]);
  });

  it("ignores fully empty rows between cases", async () => {
    // ExcelJS never emits a row with no cells at all, so these cost nothing —
    // what matters is that a gap in the middle doesn't stop parsing.
    const buffer = await workbook({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "first", "", "", "", "", "", ""],
        [null, null, null, null, null, null, null, null, null],
        ["TC-2", "LMS", "second", "", "", "", "", "", ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.cases.map((c) => c.externalId)).toEqual(["TC-1", "TC-2"]);
  });

  it("skips a row whose mapped columns are all blank without erroring on it", async () => {
    // A row that still exists in the sheet (something lingers in an unmapped
    // column) but carries no case data — a very common state after someone
    // clears rows by hand. It must be skipped silently, not flagged.
    const buffer = await workbook({
      [CASES_SHEET]: [
        [...CASE_HEADER, "Internal note"],
        ["TC-1", "LMS", "first", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "leftover"],
        ["TC-2", "LMS", "second", "", "", "", "", "", "", ""],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.cases).toHaveLength(2);
    expect(parsed.skippedBlankRows).toBe(1);
  });

  it("maps alias headers so a hand-rolled sheet still imports", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: [
        ["Ref", "Module", "Summary", "Severity", "Level", "Notes"],
        ["R1", "LMS > Skills", "Sort the My Skills list", "LOW", "EXPLORATORY", "Sliders icon opens sort options"],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.cases[0]).toMatchObject({
      externalId: "R1",
      suitePath: ["LMS", "Skills"],
      title: "Sort the My Skills list",
      priority: "LOW",
      testLevel: "EXPLORATORY",
      preconditions: "Sliders icon opens sort options",
    });
  });
});

describe("parseCaseWorkbook — step rows", () => {
  const oneCase: Rows = [CASE_HEADER, ["TC-1", "LMS", "t", "", "", "", "", "", ""]];

  it("orders steps by the Step column, not sheet order", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: oneCase,
      [STEPS_SHEET]: [
        STEP_HEADER,
        ["TC-1", 3, "third", "3rd"],
        ["TC-1", 1, "first", "1st"],
        ["TC-1", 2, "second", "2nd"],
      ],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.cases[0].steps.map((s) => s.action)).toEqual(["first", "second", "third"]);
  });

  it("falls back to sheet order when the Step column is blank", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: oneCase,
      [STEPS_SHEET]: [STEP_HEADER, ["TC-1", "", "alpha", "a"], ["TC-1", "", "beta", "b"]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.cases[0].steps.map((s) => s.action)).toEqual(["alpha", "beta"]);
  });

  it("reports steps pointing at an unknown Case ID", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: oneCase,
      [STEPS_SHEET]: [STEP_HEADER, ["TC-999", 1, "orphan", "nothing"]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_STEP_UNKNOWN_CASE_ID"]);
    expect(parsed.issues[0].value).toBe("TC-999");
    expect(parsed.cases[0].steps).toEqual([]);
  });

  it("requires both action and expected result on a non-empty step row", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: oneCase,
      [STEPS_SHEET]: [STEP_HEADER, ["TC-1", 1, "", "expected only"], ["TC-1", 2, "action only", ""]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual([
      "IMPORT_STEP_ACTION_REQUIRED",
      "IMPORT_STEP_EXPECTED_REQUIRED",
    ]);
    expect(parsed.cases[0].steps).toEqual([]);
  });

  it("reports a Test Steps sheet that is missing required columns", async () => {
    const buffer = await workbook({
      [CASES_SHEET]: oneCase,
      [STEPS_SHEET]: [["Case ID", "Step"], ["TC-1", 1]],
    });
    const parsed = await parseCaseWorkbook(buffer);
    expect(codes(parsed.issues)).toEqual(["IMPORT_STEP_COLUMNS_MISSING"]);
  });

  it("treats a missing Test Steps sheet as cases with no steps", async () => {
    const buffer = await workbook({ [CASES_SHEET]: oneCase });
    const parsed = await parseCaseWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.cases[0].steps).toEqual([]);
  });
});
