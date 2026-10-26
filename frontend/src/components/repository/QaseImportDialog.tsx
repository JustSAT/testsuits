import { ChangeEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import { logger } from "../../lib/logger";
import { apiErrorMessage } from "../../lib/apiError";
import { Button } from "../ui/Button";

type Summary = {
  suites: number;
  cases: number;
  suitesCreated: number;
  suitesUpdated: number;
  casesCreated: number;
  casesUpdated: number;
  casesUnchanged: number;
};

const ROWS: (keyof Summary)[] = ["suitesCreated", "suitesUpdated", "casesCreated", "casesUpdated", "casesUnchanged"];

/**
 * Import a Qase JSON export into a project. Choosing the file runs a preview
 * first, so the dialog says what will be created and updated before anything
 * is written. Importing a newer export later updates in place.
 */
export function QaseImportDialog({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function send(path: string, f: File): Promise<Summary> {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", f);
    return (await api.post(path, form, { silent: true })).data;
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setSummary(null);
    setDone(false);
    setError(null);
    setBusy(true);
    try {
      setSummary(await send("/imports/qase/preview", f));
      logger.info("qase import previewed", { projectId, filename: f.name });
    } catch (err) {
      logger.warn("qase import preview failed", { projectId, err: String(err) });
      setError(apiErrorMessage(err, t("common.something_went_wrong")));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await send("/imports/qase", file);
      setSummary(result);
      setDone(true);
      logger.info("qase import committed", { projectId, ...result });
      toast.success(t("qase.imported"));
      onImported();
    } catch (err) {
      logger.error("qase import failed", { projectId, err: String(err) });
      setError(apiErrorMessage(err, t("common.something_went_wrong")));
    } finally {
      setBusy(false);
    }
  }

  const changes = summary ? summary.suitesCreated + summary.suitesUpdated + summary.casesCreated + summary.casesUpdated : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="qase-import-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3">
          <h2 id="qase-import-title" className="text-lg font-semibold">{t("qase.import_title")}</h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </header>
        <p className="text-sm text-slate-500">{t("qase.import_hint")}</p>
        <input type="file" accept=".json,application/json" onChange={onFile} disabled={busy} />
        {busy && !summary && <p className="text-sm text-slate-500">{t("common.please_wait")}</p>}
        {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
        {summary && (
          <div className="space-y-2">
            <p className="text-sm">{t("qase.file_counts", { suites: summary.suites, cases: summary.cases })}</p>
            <table className="w-full text-sm">
              <tbody>
                {ROWS.map((k) => (
                  <tr key={k}>
                    <td className="py-1">{t(`qase.${done ? "done" : "preview"}.${k}`)}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{summary[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!done && changes === 0 && <p className="text-sm text-slate-500">{t("qase.up_to_date")}</p>}
          </div>
        )}
        <footer className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{done ? t("common.close") : t("common.cancel")}</Button>
          {!done && (
            <Button variant="primary" onClick={onImport} disabled={busy || !summary || changes === 0}>
              {busy && summary ? t("common.please_wait") : t("qase.import_button")}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Download the project's repository as a Qase JSON export. */
export async function downloadQaseExport(projectId: string, projectKey: string) {
  const res = await api.get("/imports/qase/export", { params: { projectId }, responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectKey}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  logger.info("qase export downloaded", { projectId });
}
