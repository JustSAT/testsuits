import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { apiErrorMessage } from "../lib/apiError";
import { Button } from "./ui/Button";

const LOGO_SIZE = 256;

/** Draw the picked image into a 256px square (cover) and return it as a PNG data URL. */
async function toLogoDataUrl(file: File): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("LOGO_UNREADABLE"));
    el.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const side = Math.min(img.width, img.height);
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);
  return canvas.toDataURL("image/png");
}

/** Company name and avatar (logo), shown in the sidebar for everyone in the company. */
export function CompanyProfileCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const updateUser = useAuth((s) => s.updateUser);
  const user = useAuth((s) => s.user);
  const { data: company } = useQuery<{ name: string; logo: string | null }>({
    queryKey: ["company"],
    queryFn: async () => (await api.get("/companies/current")).data,
  });
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (company) {
      setName(company.name);
      setLogo(company.logo);
    }
  }, [company]);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/companies/current", { name: name.trim(), logo }, { silent: true })).data,
    onSuccess: (saved) => {
      logger.info("company profile saved", { hasLogo: !!saved.logo });
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["company"] });
      if (user?.company) updateUser({ company: { ...user.company, name: saved.name } });
    },
    onError: (e) => {
      logger.warn("company profile save failed", { err: String(e) });
      toast.error(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setLogo(await toLogoDataUrl(file));
    } catch (err) {
      logger.warn("company logo unreadable", { err: String(err) });
      toast.error(t("company.logo_unreadable"));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error(t("company.name_required"));
    save.mutate();
  }

  const initials = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const dirty = company && (name.trim() !== company.name || logo !== company.logo);
  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <h2 className="font-semibold">{t("company.profile_title")}</h2>
      <div className="flex items-center gap-4">
        {logo ? (
          <img src={logo} alt={t("company.logo")} className="h-16 w-16 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">{initials}</div>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer">
            <ImagePlus size={16} /> {logo ? t("company.change_logo") : t("company.upload_logo")}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} />
          </label>
          {logo && (
            <button type="button" className="btn-secondary text-red-600" onClick={() => setLogo(null)}>
              <Trash2 size={16} /> {t("company.remove_logo")}
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="company-name">{t("company.name")}</label>
        <input id="company-name" className="input max-w-md" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? t("common.please_wait") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
