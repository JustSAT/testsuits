import { describe, it, expect } from "vitest";
import { buildQaseExport, parseQaseExport, QaseFormatError } from "../../lib/qase";

const qaseCase = {
  id: 82173,
  title: "Send a Dope card to Pulse Pro",
  description: "[Spec](https://example.com)",
  preconditions: "1. Signed in<br/>2. Dope cards open",
  postconditions: null,
  priority: "high",
  severity: "major",
  type: "functional",
  behavior: "undefined",
  automation: "is-not-automated",
  status: "actual",
  is_flaky: "no",
  layer: "e2e",
  milestone: null,
  custom_fields: [{ id: 2, title: "Platform", type: 3, value: ["Any"] }],
  steps_type: "classic",
  steps: [
    {
      position: 1, action: "Tap a card", expected_result: "Card screen opens", data: "",
      steps: [{ position: 1, action: "Check the Send button", expected_result: "", data: "Pulse off", steps: [] }],
    },
    { position: 2, action: "Tap Send to pulse", expected_result: "", data: "", steps: [] },
  ],
  tags: ["features:dope"],
  params: [{ title: "Connect_pulse", values: ["off", "on"] }],
  is_muted: "no",
};

const exportFile = {
  cases: [],
  suites: [
    {
      id: 6083, title: "Settings", description: "App settings", preconditions: null, cases: [],
      suites: [{ id: 6120, title: "DOPE Cards", description: null, preconditions: null, suites: [], cases: [qaseCase] }],
    },
  ],
};

describe("parseQaseExport", () => {
  const plan = parseQaseExport(exportFile);

  it("lists suites parent first with their Qase ids", () => {
    expect(plan.suites).toEqual([
      { externalRef: "6083", parentRef: null, name: "Settings", description: "App settings" },
      { externalRef: "6120", parentRef: "6083", name: "DOPE Cards", description: null },
    ]);
  });

  it("maps a case's texts, priority and parameters", () => {
    expect(plan.cases[0]).toMatchObject({
      externalRef: "82173",
      suiteRef: "6120",
      title: "Send a Dope card to Pulse Pro",
      description: "[Spec](https://example.com)",
      preconditions: "1. Signed in\n2. Dope cards open",
      postconditions: null,
      priority: "HIGH",
      parameters: [{ title: "Connect_pulse", values: ["off", "on"] }],
    });
  });

  it("keeps Qase attributes SuitesGlobal has no field for as prefixed tags", () => {
    expect(plan.cases[0].tags).toEqual([
      "features:dope", "severity:major", "type:functional", "layer:e2e", "platform:any",
    ]);
  });

  it("keeps substeps and input data, and fills a missing expected result of a step", () => {
    expect(plan.cases[0].steps).toEqual([
      {
        action: "Tap a card", expected: "Card screen opens",
        substeps: [{ action: "Check the Send button", data: "Pulse off" }],
      },
      { action: "Tap Send to pulse", expected: "—" },
    ]);
  });

  it("puts cases exported outside any suite into a synthetic suite", () => {
    const loose = parseQaseExport({ cases: [{ ...qaseCase, id: 1 }], suites: [] });
    expect(loose.suites).toEqual([{ externalRef: "none", parentRef: null, name: "Without suite", description: null }]);
    expect(loose.cases[0].suiteRef).toBe("none");
  });

  it("rejects anything that is not a Qase export", () => {
    expect(() => parseQaseExport({ foo: 1 })).toThrow(QaseFormatError);
    expect(() => parseQaseExport({ suites: [{ title: "No id" }] })).toThrow(QaseFormatError);
  });
});

describe("buildQaseExport", () => {
  it("round-trips what parseQaseExport read", () => {
    const plan = parseQaseExport(exportFile);
    const built = buildQaseExport(
      plan.suites.map((s) => ({ id: `db-${s.externalRef}`, parentId: s.parentRef ? `db-${s.parentRef}` : null, name: s.name, description: s.description, externalRef: s.externalRef })),
      plan.cases.map((c) => ({ ...c, id: `db-${c.externalRef}`, suiteId: `db-${c.suiteRef}`, testLevel: "REGRESSION" })),
    );

    const out = built.suites[0].suites[0].cases[0];
    expect(built.suites[0]).toMatchObject({ id: 6083, title: "Settings", description: "App settings" });
    expect(out).toMatchObject({
      id: 82173,
      title: qaseCase.title,
      priority: "high",
      severity: "major",
      type: "functional",
      behavior: "undefined",
      layer: "e2e",
      tags: ["features:dope", "platform:any"],
      params: qaseCase.params,
      custom_fields: [],
    });
    expect(out.steps).toEqual([
      {
        position: 1, action: "Tap a card", expected_result: "Card screen opens", data: "",
        steps: [{ position: 1, action: "Check the Send button", expected_result: "", data: "Pulse off", steps: [] }],
      },
      { position: 2, action: "Tap Send to pulse", expected_result: "", data: "", steps: [] },
    ]);
  });

  it("gives suites and cases made in SuitesGlobal fresh numeric ids", () => {
    const built = buildQaseExport(
      [{ id: "s1", parentId: null, name: "New", description: null, externalRef: null }],
      [{ id: "c1", suiteId: "s1", externalRef: null, title: "T", description: null, preconditions: null, postconditions: null, priority: "CRITICAL", testLevel: "SMOKE", tags: [], parameters: [], steps: [] }],
    );
    expect(typeof built.suites[0].id).toBe("number");
    expect(typeof built.suites[0].cases[0].id).toBe("number");
    expect(built.suites[0].cases[0].priority).toBe("high");
  });
});
