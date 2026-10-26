import ExcelJS from "exceljs";
import { createInflateRaw } from "zlib";

/**
 * Excel import/export for the test-case catalogue.
 *
 * The workbook is the *standard template*: admins/managers download it from
 * `GET /api/imports/cases/template.xlsx`, fill it in, and upload it back. Two
 * data sheets joined on a caller-supplied `Case ID`:
 *
 *   "Test Cases"  one row per case (suite path, title, priority, ...)
 *   "Test Steps"  one row per step, linked to a case via `Case ID`
 *
 * Splitting steps onto their own sheet means a case can have any number of
 * steps without the template needing Step1/Step2/... column pairs, and it maps
 * 1:1 onto `TestCase.steps` (a JSON array of { action, expected }).
 *
 * Every validation failure is reported as a machine key (never English prose)
 * plus the sheet/row it came from, so the frontend can translate it — see
 * `import.row_errors.*` in en.json / fr.json.
 */

export const CASES_SHEET = "Test Cases";
export const STEPS_SHEET = "Test Steps";
export const INSTRUCTIONS_SHEET = "Instructions";

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const TEST_LEVELS = ["SMOKE", "SANITY", "REGRESSION", "ADVANCED", "EXPLORATORY"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type TestLevel = (typeof TEST_LEVELS)[number];

/** Nested suites are written as a single cell: "LMS > Assignments > Search". */
export const SUITE_PATH_SEPARATOR = ">";

/** Guardrails so a hostile or accidental upload can't exhaust memory/DB. */
export const LIMITS = {
  maxCases: 1000,
  maxSteps: 10000,
  maxSuiteDepth: 6,
  maxTitleLength: 500,
  maxTextLength: 10000,
  maxTags: 30,
  maxRequirements: 50,
  // `TestCase.estimatedMinutes` is a Prisma Int (signed 32-bit). Anything above
  // this would pass validation and then fail at INSERT time, so it is rejected
  // during parsing where the row number is still available to the user.
  maxEstimatedMinutes: 100_000,
  /**
   * Total *measured* inflated size allowed across all entries of the .xlsx zip.
   * The multer limit only caps the compressed upload — XML compresses well
   * enough that a few MB can inflate to gigabytes, and ExcelJS expands the
   * whole archive before any row limit here applies. A workbook at the case and
   * step limits above lands in the low tens of MB, so this leaves ample room
   * while bounding how much a hostile file can make us decompress.
   */
  maxUncompressedBytes: 64 * 1024 * 1024,
  /** A legitimate workbook has a handful of parts, not tens of thousands. */
  maxArchiveEntries: 512,
};

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

const CASE_COLUMNS = [
  { header: "Case ID", key: "caseId", width: 14 },
  { header: "Suite Path", key: "suitePath", width: 34 },
  { header: "Title", key: "title", width: 52 },
  { header: "Priority", key: "priority", width: 12 },
  { header: "Test Level", key: "testLevel", width: 14 },
  { header: "Preconditions", key: "preconditions", width: 40 },
  { header: "Tags", key: "tags", width: 24 },
  { header: "Estimated Minutes", key: "estimatedMinutes", width: 18 },
  { header: "Requirements", key: "requirements", width: 28 },
];

const STEP_COLUMNS = [
  { header: "Case ID", key: "caseId", width: 14 },
  { header: "Step", key: "step", width: 8 },
  { header: "Action", key: "action", width: 60 },
  { header: "Expected Result", key: "expected", width: 60 },
];

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E293B" },
};

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", horizontal: "left" };
  row.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * Attach a dropdown to a whole column so the person filling the template can't
 * invent a priority. Applied to a generous row range — Excel keeps the rule
 * when rows are inserted inside it.
 */
function addListValidation(sheet: ExcelJS.Worksheet, column: string, values: readonly string[], lastRow = 500) {
  for (let r = 2; r <= lastRow; r++) {
    sheet.getCell(`${column}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${values.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "warning",
    };
  }
}

/** Example rows shipped in the template so the expected shape is obvious. */
const SAMPLE_CASES = [
  {
    caseId: "TC-001",
    suitePath: "LMS > Assignments",
    title: "Start assessment directly from an assignment card",
    priority: "HIGH",
    testLevel: "REGRESSION",
    preconditions: "Trainee is signed in and has at least one open assignment.",
    tags: "lms, assignments",
    estimatedMinutes: 5,
    requirements: "REQ-114",
  },
  {
    caseId: "TC-002",
    suitePath: "LMS > Training Proof",
    title: "Certificate opens and downloads with the correct data",
    priority: "HIGH",
    testLevel: "SMOKE",
    preconditions: "At least one completed training with an issued certificate.",
    tags: "lms, certificates",
    estimatedMinutes: 4,
    requirements: "",
  },
];

const SAMPLE_STEPS = [
  { caseId: "TC-001", step: 1, action: "Open My Assignments", expected: "The assignment list is displayed" },
  { caseId: "TC-001", step: 2, action: "Click \"Start assessment\" on an assignment card", expected: "The evaluation flow opens on step 1" },
  { caseId: "TC-002", step: 1, action: "Open the Training Proof tab", expected: "Each row shows a certificate code" },
  { caseId: "TC-002", step: 2, action: "Click a certificate code", expected: "The certificate opens with the trainee name, skill, and issue date" },
];

const INSTRUCTIONS: Array<[string, string]> = [
  ["Case ID", "Required. Any identifier unique within this file (e.g. TC-001). It joins a case to its rows on the \"Test Steps\" sheet — it is NOT stored in the app. If two rows share an ID, both are rejected: their steps cannot be told apart."],
  ["Suite Path", `Required. The suite to file the case under. Use "${SUITE_PATH_SEPARATOR}" to nest, e.g. "LMS ${SUITE_PATH_SEPARATOR} Assignments". Missing suites are created automatically (max ${LIMITS.maxSuiteDepth} levels).`],
  ["Title", "Required. Short description of what the case verifies."],
  ["Priority", `Optional. One of: ${PRIORITIES.join(", ")}. Defaults to MEDIUM.`],
  ["Test Level", `Optional. One of: ${TEST_LEVELS.join(", ")}. Defaults to REGRESSION.`],
  ["Preconditions", "Optional. State the system must be in before the steps run."],
  ["Tags", `Optional. Comma-separated, e.g. "lms, regression". Max ${LIMITS.maxTags} per case.`],
  ["Estimated Minutes", `Optional. Whole number from 1 to ${LIMITS.maxEstimatedMinutes}.`],
  ["Requirements", `Optional. One reference per line, or separated by ";". Max ${LIMITS.maxRequirements} per case.`],
  ["Test Steps sheet", "Optional. One row per step. \"Case ID\" must match a row on the \"Test Cases\" sheet. \"Step\" sets the order; if left blank, sheet order is used. Action and Expected Result are both required on any non-empty step row."],
  ["Limits", `Max ${LIMITS.maxCases} cases and ${LIMITS.maxSteps} steps per file.`],
  ["Duplicates", "A case is a duplicate when a case with the same title already exists in the resolved suite. Choose Skip or Update at import time."],
  ["Sample rows", "The two sample cases shipped in this template are examples — delete them before importing."],
];

/** Build the standard, fill-in-me workbook and return it as an xlsx buffer. */
export async function buildCaseTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TestSuits";
  // No Date.now() — a fixed timestamp keeps the generated file byte-stable,
  // which makes it cacheable and its tests deterministic.
  wb.created = new Date(0);
  wb.modified = new Date(0);

  const cases = wb.addWorksheet(CASES_SHEET);
  cases.columns = CASE_COLUMNS;
  styleHeader(cases);
  SAMPLE_CASES.forEach((row) => cases.addRow(row));
  addListValidation(cases, "D", PRIORITIES);
  addListValidation(cases, "E", TEST_LEVELS);
  cases.getColumn("preconditions").alignment = { wrapText: true, vertical: "top" };
  cases.getColumn("title").alignment = { wrapText: true, vertical: "top" };

  const steps = wb.addWorksheet(STEPS_SHEET);
  steps.columns = STEP_COLUMNS;
  styleHeader(steps);
  SAMPLE_STEPS.forEach((row) => steps.addRow(row));
  steps.getColumn("action").alignment = { wrapText: true, vertical: "top" };
  steps.getColumn("expected").alignment = { wrapText: true, vertical: "top" };

  const info = wb.addWorksheet(INSTRUCTIONS_SHEET);
  info.columns = [
    { header: "Column", key: "column", width: 22 },
    { header: "How to fill it", key: "help", width: 110 },
  ];
  styleHeader(info);
  INSTRUCTIONS.forEach(([column, help]) => info.addRow({ column, help }));
  info.getColumn("help").alignment = { wrapText: true, vertical: "top" };

  const buffer = await wb.xlsx.writeBuffer();
  return pinZipTimestamps(Buffer.from(buffer));
}

/**
 * ExcelJS zips the workbook with JSZip, which stamps every entry with the
 * current time, so two builds a second apart differ byte for byte. Rewrite
 * each entry's DOS time/date — in its local header and in the central
 * directory — to 1980-01-01 00:00 (the zip epoch) so the template is stable.
 */
function pinZipTimestamps(buf: Buffer): Buffer {
  const EOCD_SIG = 0x06054b50;
  const CENTRAL_SIG = 0x02014b50;
  const LOCAL_SIG = 0x04034b50;
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return buf;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === CENTRAL_SIG; n++) {
    buf.writeUInt16LE(DOS_TIME, p + 12);
    buf.writeUInt16LE(DOS_DATE, p + 14);
    const local = buf.readUInt32LE(p + 42);
    if (local + 30 <= buf.length && buf.readUInt32LE(local) === LOCAL_SIG) {
      buf.writeUInt16LE(DOS_TIME, local + 10);
      buf.writeUInt16LE(DOS_DATE, local + 12);
    }
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type RowIssue = {
  sheet: string;
  row: number;
  /** Machine key — translated by the frontend under `import.row_errors.*`. */
  code: string;
  /** Header of the offending column, for display next to the row number. */
  column?: string;
  /** Interpolation values for the translated message. */
  value?: string;
};

export type ParsedStep = { action: string; expected: string };

export type ParsedCase = {
  /** In-file identifier; used only to join steps and to detect in-file dupes. */
  externalId: string;
  suitePath: string[];
  title: string;
  priority: Priority;
  testLevel: TestLevel;
  preconditions: string | null;
  tags: string[];
  estimatedMinutes: number | null;
  requirements: string[];
  steps: ParsedStep[];
  /** 1-based row on the "Test Cases" sheet, for error reporting. */
  row: number;
};

export type ParseResult = {
  cases: ParsedCase[];
  issues: RowIssue[];
  /** Rows that were entirely blank and silently skipped. */
  skippedBlankRows: number;
};

/** Thrown for problems that make the whole file unusable (vs. per-row issues). */
export class WorkbookError extends Error {}

/** Normalise a header so "Expected Result", "expected_result", "EXPECTED" all match. */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Accepted spellings per logical column. The first entry of each list is the
 * canonical template header; the rest let a hand-rolled sheet import cleanly.
 */
const CASE_HEADER_ALIASES: Record<string, string[]> = {
  caseId: ["caseid", "id", "ref", "reference", "testcaseid"],
  suitePath: ["suitepath", "suite", "module", "area", "feature", "component"],
  title: ["title", "case", "testcase", "summary", "name", "scenario"],
  priority: ["priority", "severity"],
  testLevel: ["testlevel", "level", "type", "testtype"],
  preconditions: ["preconditions", "precondition", "prerequisites", "prerequisite", "setup", "notes", "rationale", "description"],
  tags: ["tags", "labels", "tag"],
  estimatedMinutes: ["estimatedminutes", "estimate", "estimatedtime", "duration", "minutes"],
  requirements: ["requirements", "requirement", "requirementids", "reqs", "traceability"],
};

const STEP_HEADER_ALIASES: Record<string, string[]> = {
  caseId: ["caseid", "id", "ref", "reference", "testcaseid"],
  step: ["step", "stepnumber", "stepno", "order", "no", "num"],
  action: ["action", "stepaction", "steps", "description", "instruction"],
  expected: ["expectedresult", "expected", "expectedresults", "result", "expectedoutcome"],
};

type ColumnMap = Record<string, number | undefined>;

/**
 * Map logical field -> column index by reading the header row. Unknown columns
 * are ignored so callers can keep their own extra bookkeeping columns.
 */
function mapColumns(sheet: ExcelJS.Worksheet, aliases: Record<string, string[]>): { map: ColumnMap; headers: Record<number, string> } {
  const map: ColumnMap = {};
  const headers: Record<number, string> = {};
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = cellText(cell.value);
    if (!raw) return;
    headers[colNumber] = raw;
    const norm = normalizeHeader(raw);
    for (const [field, names] of Object.entries(aliases)) {
      // First match wins, so a sheet with both "Notes" and "Preconditions"
      // keeps whichever appears first rather than silently overwriting.
      if (map[field] === undefined && names.includes(norm)) {
        map[field] = colNumber;
        return;
      }
    }
  });
  return { map, headers };
}

/** Flatten any ExcelJS cell value (rich text, formula, hyperlink, date) to text. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
    }
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v && v.result !== undefined && v.result !== null) return cellText(v.result as ExcelJS.CellValue);
    if ("hyperlink" in v && typeof v.hyperlink === "string") return v.hyperlink.trim();
    if ("error" in v) return "";
  }
  return String(value).trim();
}

function readCell(row: ExcelJS.Row, col: number | undefined): string {
  if (!col) return "";
  return cellText(row.getCell(col).value);
}

/** True when every mapped cell on the row is blank — such rows are skipped. */
function isBlankRow(row: ExcelJS.Row, map: ColumnMap): boolean {
  return Object.values(map).every((col) => !readCell(row, col));
}

function splitList(raw: string, extraSeparator: RegExp): string[] {
  return raw
    .split(extraSeparator)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSuitePath(raw: string): string[] {
  return raw
    .split(SUITE_PATH_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Archive safety -------------------------------------------------------
//
// An .xlsx is a zip. Capping the upload size only caps the *compressed* bytes,
// and ExcelJS inflates every entry into memory before we get to look at a
// single row — so a few-MB "zip bomb" could exhaust the API process and take
// down the whole tenant. The zip central directory declares each entry's
// uncompressed size up front, so we can total it and refuse before inflating.

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CD_ENTRY_SIG = 0x02014b50;
const LOCAL_HEADER_SIG = 0x04034b50;
const UINT32_MAX = 0xffffffff;

/** Locate the End Of Central Directory record (it sits at the tail of a zip). */
function findEocd(buf: Buffer): number {
  // The trailing comment can be up to 64 KiB, so the record starts at most
  // 22 + 65535 bytes from the end.
  const start = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

type CdEntry = {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

/** Parse the central directory into entry records. Throws WorkbookError. */
function readCentralDirectory(buffer: Buffer): { entries: CdEntry[]; cdOffset: number } {
  if (buffer.length < 22) throw new WorkbookError("IMPORT_FILE_UNREADABLE");

  const eocd = findEocd(buffer);
  if (eocd < 0) throw new WorkbookError("IMPORT_FILE_UNREADABLE");

  let count = buffer.readUInt16LE(eocd + 10);
  let cdOffset = buffer.readUInt32LE(eocd + 16);

  // Zip64: the 32-bit fields saturate and the real values live in a separate
  // record pointed at by a locator immediately before the EOCD.
  if (count === 0xffff || cdOffset === UINT32_MAX) {
    const locator = eocd - 20;
    if (locator < 0 || buffer.readUInt32LE(locator) !== ZIP64_LOCATOR_SIG) {
      throw new WorkbookError("IMPORT_FILE_UNREADABLE");
    }
    const z64 = Number(buffer.readBigUInt64LE(locator + 8));
    if (!Number.isSafeInteger(z64) || z64 < 0 || z64 + 56 > buffer.length) {
      throw new WorkbookError("IMPORT_FILE_UNREADABLE");
    }
    if (buffer.readUInt32LE(z64) !== ZIP64_EOCD_SIG) throw new WorkbookError("IMPORT_FILE_UNREADABLE");
    count = Number(buffer.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buffer.readBigUInt64LE(z64 + 48));
  }

  if (!Number.isSafeInteger(count) || count < 0 || count > LIMITS.maxArchiveEntries) {
    throw new WorkbookError("IMPORT_ARCHIVE_TOO_LARGE");
  }

  const entries: CdEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CD_ENTRY_SIG) {
      throw new WorkbookError("IMPORT_FILE_UNREADABLE");
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);

    entries.push({ method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return { entries, cdOffset };
}

/**
 * Inflate `slice`, counting output bytes and aborting the moment the running
 * total exceeds `budget`. Output is discarded as it arrives, so peak memory is
 * a single zlib chunk regardless of how large the entry claims — or turns out —
 * to be.
 */
function countInflatedBytes(slice: Buffer, budget: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    let total = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      inflate.removeAllListeners();
      inflate.destroy();
      fn();
    };

    inflate.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > budget) finish(() => reject(new WorkbookError("IMPORT_ARCHIVE_TOO_LARGE")));
    });
    inflate.on("end", () => finish(() => resolve(total)));
    // A truncated or corrupt deflate stream means the file is malformed — but
    // if we already blew the budget the rejection above has priority.
    inflate.on("error", () => finish(() => reject(new WorkbookError("IMPORT_FILE_UNREADABLE"))));
    inflate.end(slice);
  });
}

/**
 * Reject archives that inflate past the limit, BEFORE handing bytes to ExcelJS.
 *
 * The sizes declared in the central directory are attacker-controlled — a zip
 * can claim one byte and inflate to gigabytes — so they are treated only as a
 * cheap early reject. The real check decompresses each entry ourselves and
 * counts the bytes that actually come out, aborting the stream at the cap.
 */
export async function assertSafeArchive(buffer: Buffer): Promise<void> {
  const { entries, cdOffset } = readCentralDirectory(buffer);

  let total = 0;
  for (const entry of entries) {
    const lho = entry.localHeaderOffset;
    if (lho + 30 > buffer.length || buffer.readUInt32LE(lho) !== LOCAL_HEADER_SIG) {
      throw new WorkbookError("IMPORT_FILE_UNREADABLE");
    }
    // The local header's extra field can differ in length from the central
    // one's, so the data offset must be derived from the local record.
    const nameLen = buffer.readUInt16LE(lho + 26);
    const extraLen = buffer.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + nameLen + extraLen;
    if (dataStart > buffer.length) throw new WorkbookError("IMPORT_FILE_UNREADABLE");

    // Trust the declared compressed size only to bound the slice, and clamp it
    // to the start of the central directory. A wrong value can only make the
    // deflate stream fail to parse — it cannot smuggle extra output past the
    // counter below.
    const declared = entry.compressedSize;
    const end =
      declared > 0 && declared !== UINT32_MAX && dataStart + declared <= buffer.length
        ? dataStart + declared
        : Math.max(dataStart, Math.min(cdOffset, buffer.length));

    const budget = LIMITS.maxUncompressedBytes - total;
    if (budget <= 0) throw new WorkbookError("IMPORT_ARCHIVE_TOO_LARGE");

    if (entry.method === 0) {
      // Stored: output size == input size, already bounded by the upload cap.
      total += end - dataStart;
      if (total > LIMITS.maxUncompressedBytes) throw new WorkbookError("IMPORT_ARCHIVE_TOO_LARGE");
      continue;
    }

    total += await countInflatedBytes(buffer.subarray(dataStart, end), budget);
  }
}

/**
 * Parse an uploaded workbook into cases + per-row issues. Never throws for bad
 * data — only for a file that isn't a readable workbook with a "Test Cases"
 * sheet, or one that would inflate past the archive limit (WorkbookError).
 */
export async function parseCaseWorkbook(buffer: Buffer): Promise<ParseResult> {
  // Must run before ExcelJS touches the bytes — see assertSafeArchive.
  await assertSafeArchive(buffer);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new WorkbookError("IMPORT_FILE_UNREADABLE");
  }

  // Prefer the template's sheet name; fall back to the first sheet so a
  // renamed-but-otherwise-correct file still imports.
  const casesSheet =
    wb.worksheets.find((s) => normalizeHeader(s.name) === normalizeHeader(CASES_SHEET)) ?? wb.worksheets[0];
  if (!casesSheet) throw new WorkbookError("IMPORT_NO_SHEETS");

  const { map: caseMap, headers: caseHeaders } = mapColumns(casesSheet, CASE_HEADER_ALIASES);
  if (caseMap.title === undefined) throw new WorkbookError("IMPORT_TITLE_COLUMN_MISSING");
  if (caseMap.suitePath === undefined) throw new WorkbookError("IMPORT_SUITE_COLUMN_MISSING");
  if (caseMap.caseId === undefined) throw new WorkbookError("IMPORT_CASE_ID_COLUMN_MISSING");

  const issues: RowIssue[] = [];
  const cases: ParsedCase[] = [];
  const byExternalId = new Map<string, ParsedCase>();
  let skippedBlankRows = 0;

  const pushIssue = (sheet: string, row: number, code: string, column?: string, value?: string) => {
    issues.push({ sheet, row, code, ...(column ? { column } : {}), ...(value ? { value } : {}) });
  };

  // Pre-pass: find Case IDs used by more than one row. A repeated ID makes
  // every row that uses it ambiguous — not just the second one — because there
  // is no way to tell which of them a step row was meant for. Rejecting only
  // the later row would silently graft the other's steps onto the survivor, so
  // all of them are rejected and their steps are reported rather than guessed.
  const idRowCount = new Map<string, number>();
  casesSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = readCell(row, caseMap.caseId);
    if (id) idRowCount.set(id, (idRowCount.get(id) ?? 0) + 1);
  });
  const ambiguousIds = new Set(
    [...idRowCount.entries()].filter(([, n]) => n > 1).map(([id]) => id),
  );

  casesSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    if (isBlankRow(row, caseMap)) {
      skippedBlankRows++;
      return;
    }
    if (cases.length >= LIMITS.maxCases) {
      // Report once, then stop collecting — no point validating 50k rows.
      if (!issues.some((i) => i.code === "IMPORT_TOO_MANY_CASES")) {
        pushIssue(CASES_SHEET, rowNumber, "IMPORT_TOO_MANY_CASES", undefined, String(LIMITS.maxCases));
      }
      return;
    }

    const externalId = readCell(row, caseMap.caseId);
    const suitePathRaw = readCell(row, caseMap.suitePath);
    const title = readCell(row, caseMap.title);

    let rowFailed = false;
    if (!externalId) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_CASE_ID_REQUIRED", caseHeaders[caseMap.caseId!]);
      rowFailed = true;
    } else if (ambiguousIds.has(externalId)) {
      // Reported on every row sharing the ID, including the first.
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_CASE_ID_DUPLICATE", caseHeaders[caseMap.caseId!], externalId);
      rowFailed = true;
    }
    if (!title) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_TITLE_REQUIRED", caseHeaders[caseMap.title!]);
      rowFailed = true;
    } else if (title.length > LIMITS.maxTitleLength) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_TITLE_TOO_LONG", caseHeaders[caseMap.title!], String(LIMITS.maxTitleLength));
      rowFailed = true;
    }

    const suitePath = parseSuitePath(suitePathRaw);
    if (suitePath.length === 0) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_SUITE_REQUIRED", caseHeaders[caseMap.suitePath!]);
      rowFailed = true;
    } else if (suitePath.length > LIMITS.maxSuiteDepth) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_SUITE_TOO_DEEP", caseHeaders[caseMap.suitePath!], String(LIMITS.maxSuiteDepth));
      rowFailed = true;
    }

    const priorityRaw = readCell(row, caseMap.priority).toUpperCase();
    let priority: Priority = "MEDIUM";
    if (priorityRaw) {
      if ((PRIORITIES as readonly string[]).includes(priorityRaw)) {
        priority = priorityRaw as Priority;
      } else {
        pushIssue(CASES_SHEET, rowNumber, "IMPORT_PRIORITY_INVALID", caseHeaders[caseMap.priority!], priorityRaw);
        rowFailed = true;
      }
    }

    const levelRaw = readCell(row, caseMap.testLevel).toUpperCase();
    let testLevel: TestLevel = "REGRESSION";
    if (levelRaw) {
      if ((TEST_LEVELS as readonly string[]).includes(levelRaw)) {
        testLevel = levelRaw as TestLevel;
      } else {
        pushIssue(CASES_SHEET, rowNumber, "IMPORT_TEST_LEVEL_INVALID", caseHeaders[caseMap.testLevel!], levelRaw);
        rowFailed = true;
      }
    }

    const minutesRaw = readCell(row, caseMap.estimatedMinutes);
    let estimatedMinutes: number | null = null;
    if (minutesRaw) {
      const n = Number(minutesRaw);
      if (!Number.isInteger(n) || n <= 0) {
        pushIssue(CASES_SHEET, rowNumber, "IMPORT_ESTIMATE_INVALID", caseHeaders[caseMap.estimatedMinutes!], minutesRaw);
        rowFailed = true;
      } else if (n > LIMITS.maxEstimatedMinutes) {
        // `TestCase.estimatedMinutes` is a Prisma Int (32-bit). Without this
        // bound a value like 2147483648 previews clean and then blows up at
        // commit time, after the user has been told the file is fine.
        pushIssue(
          CASES_SHEET,
          rowNumber,
          "IMPORT_ESTIMATE_TOO_LARGE",
          caseHeaders[caseMap.estimatedMinutes!],
          String(LIMITS.maxEstimatedMinutes),
        );
        rowFailed = true;
      } else {
        estimatedMinutes = n;
      }
    }

    const preconditionsRaw = readCell(row, caseMap.preconditions);
    if (preconditionsRaw.length > LIMITS.maxTextLength) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_TEXT_TOO_LONG", caseHeaders[caseMap.preconditions!], String(LIMITS.maxTextLength));
      rowFailed = true;
    }

    // Report rather than truncate: silently dropping tag 31 looks like a
    // successful import that quietly lost data.
    const tags = splitList(readCell(row, caseMap.tags), /[,\n]/);
    if (tags.length > LIMITS.maxTags) {
      pushIssue(CASES_SHEET, rowNumber, "IMPORT_TOO_MANY_TAGS", caseHeaders[caseMap.tags!], String(LIMITS.maxTags));
      rowFailed = true;
    }
    const requirements = splitList(readCell(row, caseMap.requirements), /[;\n]/);
    if (requirements.length > LIMITS.maxRequirements) {
      pushIssue(
        CASES_SHEET,
        rowNumber,
        "IMPORT_TOO_MANY_REQUIREMENTS",
        caseHeaders[caseMap.requirements!],
        String(LIMITS.maxRequirements),
      );
      rowFailed = true;
    }

    if (rowFailed) return;

    const parsed: ParsedCase = {
      externalId,
      suitePath,
      title,
      priority,
      testLevel,
      preconditions: preconditionsRaw || null,
      tags,
      estimatedMinutes,
      requirements,
      steps: [],
      row: rowNumber,
    };
    cases.push(parsed);
    byExternalId.set(externalId, parsed);
  });

  // -- Steps sheet (optional) ------------------------------------------------
  const stepsSheet = wb.worksheets.find((s) => normalizeHeader(s.name) === normalizeHeader(STEPS_SHEET));
  if (stepsSheet) {
    const { map: stepMap, headers: stepHeaders } = mapColumns(stepsSheet, STEP_HEADER_ALIASES);
    if (stepMap.caseId === undefined || stepMap.action === undefined || stepMap.expected === undefined) {
      issues.push({ sheet: STEPS_SHEET, row: 1, code: "IMPORT_STEP_COLUMNS_MISSING" });
    } else {
      // Collected per case first so an explicit "Step" column can reorder them
      // without disturbing cases that leave it blank.
      const collected = new Map<string, Array<{ order: number; seq: number; step: ParsedStep }>>();
      let seq = 0;
      let stepCount = 0;

      stepsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        if (isBlankRow(row, stepMap)) {
          skippedBlankRows++;
          return;
        }
        if (stepCount >= LIMITS.maxSteps) {
          if (!issues.some((i) => i.code === "IMPORT_TOO_MANY_STEPS")) {
            pushIssue(STEPS_SHEET, rowNumber, "IMPORT_TOO_MANY_STEPS", undefined, String(LIMITS.maxSteps));
          }
          return;
        }

        const caseId = readCell(row, stepMap.caseId);
        const action = readCell(row, stepMap.action);
        const expected = readCell(row, stepMap.expected);
        const orderRaw = readCell(row, stepMap.step);

        if (!caseId) {
          pushIssue(STEPS_SHEET, rowNumber, "IMPORT_STEP_CASE_ID_REQUIRED", stepHeaders[stepMap.caseId!]);
          return;
        }
        if (!byExternalId.has(caseId)) {
          // Either a typo, an ambiguous (repeated) ID, or a case row that
          // failed validation. All are worth surfacing — silently dropping or
          // misattaching steps loses or corrupts user work.
          pushIssue(
            STEPS_SHEET,
            rowNumber,
            ambiguousIds.has(caseId) ? "IMPORT_STEP_AMBIGUOUS_CASE_ID" : "IMPORT_STEP_UNKNOWN_CASE_ID",
            stepHeaders[stepMap.caseId!],
            caseId,
          );
          return;
        }
        if (!action) {
          pushIssue(STEPS_SHEET, rowNumber, "IMPORT_STEP_ACTION_REQUIRED", stepHeaders[stepMap.action!]);
          return;
        }
        if (!expected) {
          pushIssue(STEPS_SHEET, rowNumber, "IMPORT_STEP_EXPECTED_REQUIRED", stepHeaders[stepMap.expected!]);
          return;
        }
        if (action.length > LIMITS.maxTextLength || expected.length > LIMITS.maxTextLength) {
          pushIssue(STEPS_SHEET, rowNumber, "IMPORT_TEXT_TOO_LONG", stepHeaders[stepMap.action!], String(LIMITS.maxTextLength));
          return;
        }

        const orderNum = Number(orderRaw);
        const order = orderRaw && Number.isFinite(orderNum) ? orderNum : Number.MAX_SAFE_INTEGER;
        const list = collected.get(caseId) ?? [];
        list.push({ order, seq: seq++, step: { action, expected } });
        collected.set(caseId, list);
        stepCount++;
      });

      for (const [caseId, entries] of collected) {
        // Stable sort: explicit Step numbers first, ties broken by sheet order.
        entries.sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order));
        byExternalId.get(caseId)!.steps = entries.map((e) => e.step);
      }
    }
  }

  return { cases, issues, skippedBlankRows };
}
