import { describe, it, expect } from "vitest";
import { caseChanges, parameterRows, type CaseSnapshot } from "../../lib/caseModel";

describe("parameterRows", () => {
  it("puts the n-th value of every parameter in row n", () => {
    expect(parameterRows([
      { title: "Lang", values: ["English", "French"] },
      { title: "Expected", values: ["EN shown", "FR shown"] },
    ])).toEqual([["English", "EN shown"], ["French", "FR shown"]]);
  });

  it("fills a parameter that has fewer values with blanks", () => {
    expect(parameterRows([{ title: "A", values: ["1", "2"] }, { title: "B", values: ["x"] }])).toEqual([["1", "x"], ["2", ""]]);
  });

  it("has no rows without parameters", () => {
    expect(parameterRows([])).toEqual([]);
  });
});

const base: CaseSnapshot = {
  title: "Send a card", description: null, preconditions: "Signed in", postconditions: null, priority: "MEDIUM",
  testLevel: "REGRESSION", tags: [], parameters: [], steps: [], estimatedMinutes: null, requirements: [],
};

describe("caseChanges", () => {
  const revisions = [
    // Newest first, as the API returns them. Each is the state *before* that edit.
    { id: "r2", version: 2, createdAt: "2026-10-22T10:43:58Z", author: { id: "u1", name: "Yevhen" }, ...base, title: "Send a card to Pulse" },
    { id: "r1", version: 1, createdAt: "2026-10-22T09:28:25Z", author: { id: "u1", name: "Yevhen" }, ...base },
  ];
  const current: CaseSnapshot = { ...base, title: "Send a Dope card", priority: "HIGH" };

  it("lists each edit newest first with the fields it changed, before and after", () => {
    expect(caseChanges(revisions, current)).toEqual([
      {
        id: "r2", version: 2, at: "2026-10-22T10:43:58Z", author: "Yevhen",
        changes: [
          { field: "title", before: "Send a card to Pulse", after: "Send a Dope card" },
          { field: "priority", before: "MEDIUM", after: "HIGH" },
        ],
      },
      {
        id: "r1", version: 1, at: "2026-10-22T09:28:25Z", author: "Yevhen",
        changes: [{ field: "title", before: "Send a card", after: "Send a card to Pulse" }],
      },
    ]);
  });

  it("leaves out edits that changed none of the tracked fields", () => {
    expect(caseChanges([{ ...revisions[1] }], base)).toEqual([]);
  });

  it("compares lists and steps by content", () => {
    const steps = [{ action: "Open", expected: "Opened" }];
    const out = caseChanges([{ ...revisions[1], tags: ["a"], steps }], { ...base, tags: ["a"], steps: [{ action: "Open", expected: "Shown" }] });
    expect(out[0].changes).toEqual([{ field: "steps", before: steps, after: [{ action: "Open", expected: "Shown" }] }]);
  });
});
