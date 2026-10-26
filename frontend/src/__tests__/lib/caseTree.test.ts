import { describe, it, expect } from "vitest";
import { buildCaseTree, matchCases, suiteState, toggleCases, type CaseTreeData } from "../../lib/caseTree";

// Gallery
// ├── Shotisize (c1, c2)
// │   └── Localization (c3)
// └── Filters (c4)
// Auth (c5)
const data: CaseTreeData = {
  suites: [
    { id: "gallery", parentId: null, name: "Gallery" },
    { id: "shot", parentId: "gallery", name: "Shotisize" },
    { id: "loc", parentId: "shot", name: "Localization" },
    { id: "filters", parentId: "gallery", name: "Filters" },
    { id: "auth", parentId: null, name: "Auth" },
  ],
  cases: [
    { id: "c1", suiteId: "shot", title: "Shots open", priority: "HIGH", testLevel: "SMOKE" },
    { id: "c2", suiteId: "shot", title: "Shots play", priority: "MEDIUM", testLevel: "REGRESSION" },
    { id: "c3", suiteId: "loc", title: "French labels", priority: "LOW", testLevel: "REGRESSION" },
    { id: "c4", suiteId: "filters", title: "Filter by date", priority: "MEDIUM", testLevel: "SMOKE" },
    { id: "c5", suiteId: "auth", title: "Sign in", priority: "CRITICAL", testLevel: "SMOKE" },
  ],
};

describe("buildCaseTree", () => {
  const tree = buildCaseTree(data);

  it("keeps root suites in order and nests children", () => {
    expect(tree.roots.map((s) => s.id)).toEqual(["gallery", "auth"]);
    expect(tree.byId.get("gallery")!.children.map((s) => s.id)).toEqual(["shot", "filters"]);
  });

  it("lists every case under a suite at any depth, its own first", () => {
    expect(tree.byId.get("gallery")!.allCaseIds).toEqual(["c1", "c2", "c3", "c4"]);
    expect(tree.byId.get("shot")!.allCaseIds).toEqual(["c1", "c2", "c3"]);
    expect(tree.byId.get("shot")!.cases.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("gives each suite its path from the root for the breadcrumb", () => {
    expect(tree.byId.get("loc")!.path.map((s) => s.name)).toEqual(["Gallery", "Shotisize", "Localization"]);
  });
});

describe("suiteState", () => {
  const tree = buildCaseTree(data);

  it("counts selected cases in the subtree and says whether all, some or none are picked", () => {
    expect(suiteState(tree.byId.get("gallery")!, new Set())).toEqual({ selected: 0, total: 4, state: "none" });
    expect(suiteState(tree.byId.get("gallery")!, new Set(["c3"]))).toEqual({ selected: 1, total: 4, state: "some" });
    expect(suiteState(tree.byId.get("shot")!, new Set(["c1", "c2", "c3", "c5"]))).toEqual({ selected: 3, total: 3, state: "all" });
  });

  it("an empty suite is never 'all'", () => {
    const empty = buildCaseTree({ suites: [{ id: "e", parentId: null, name: "Empty" }], cases: [] });
    expect(suiteState(empty.byId.get("e")!, new Set())).toEqual({ selected: 0, total: 0, state: "none" });
  });
});

describe("toggleCases", () => {
  it("selects all the given cases when any of them is unselected", () => {
    expect([...toggleCases(new Set(["c1"]), ["c1", "c2"])].sort()).toEqual(["c1", "c2"]);
  });

  it("clears them when all are already selected, keeping the rest", () => {
    expect([...toggleCases(new Set(["c1", "c2", "c5"]), ["c1", "c2"])]).toEqual(["c5"]);
  });

  it("does not mutate the input", () => {
    const before = new Set(["c1"]);
    toggleCases(before, ["c2"]);
    expect([...before]).toEqual(["c1"]);
  });
});

describe("matchCases", () => {
  const tree = buildCaseTree(data);

  it("matches titles case-insensitively, ignoring surrounding spaces", () => {
    expect(matchCases(tree, "  SHOTS ").map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("returns nothing for an empty query", () => {
    expect(matchCases(tree, "   ")).toEqual([]);
  });
});
