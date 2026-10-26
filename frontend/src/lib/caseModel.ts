// Case shapes and DOM-free helpers for the case panel (parameter table, history).

export type Substep = { action: string; expected?: string; data?: string };
export type Step = { action: string; expected: string; data?: string; sharedStepId?: string | null; substeps?: Substep[] };
export type Parameter = { title: string; values: string[] };

/** The case fields a revision snapshots and the History tab compares. */
export const TRACKED_FIELDS = [
  "title",
  "description",
  "preconditions",
  "postconditions",
  "priority",
  "testLevel",
  "tags",
  "parameters",
  "steps",
  "estimatedMinutes",
  "requirements",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];
export type CaseSnapshot = Record<TrackedField, unknown>;

export type Revision = CaseSnapshot & {
  id: string;
  version: number;
  createdAt: string;
  author?: { id: string; name: string } | null;
};
export type FieldChange = { field: TrackedField; before: unknown; after: unknown };
export type HistoryEntry = { id: string; version: number; at: string; author: string | null; changes: FieldChange[] };

/** Rows of a parameter table: row n holds the n-th value of every parameter. */
export function parameterRows(params: Parameter[]): string[][] {
  const rows = Math.max(0, ...params.map((p) => p.values.length));
  return Array.from({ length: rows }, (_, i) => params.map((p) => p.values[i] ?? ""));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What each edit changed, newest first. A revision is the case as it was
 * *before* an edit, so that edit's result is the next newer revision, or the
 * case itself for the latest one.
 */
export function caseChanges(revisions: Revision[], current: CaseSnapshot): HistoryEntry[] {
  return revisions
    .map((rev, i) => {
      const after: CaseSnapshot = i === 0 ? current : revisions[i - 1];
      const changes = TRACKED_FIELDS.filter((f) => !same(rev[f], after[f])).map((f) => ({ field: f, before: rev[f], after: after[f] }));
      return { id: rev.id, version: rev.version, at: rev.createdAt, author: rev.author?.name ?? null, changes };
    })
    .filter((e) => e.changes.length > 0);
}
