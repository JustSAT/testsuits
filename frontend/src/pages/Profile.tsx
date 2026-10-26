import { useRef, useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { LogOut, Camera, Trash2, ShieldCheck, ShieldOff, Search, X, Bug } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useZodForm } from "../lib/useZodForm";
import { PasswordInput } from "../components/PasswordInput";
import { nonEmpty, passwordPolicyWithMessages } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";
import { logger } from "../lib/logger";
import { PageHeader } from "../components/ui/PageHeader";
import { Field } from "../components/Field";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { UserAvatar } from "../components/UserAvatar";

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function PasswordStrength({ value }: { value: string }) {
  const { t } = useTranslation();
  const strength = useMemo(() => {
    if (!value) return 0;
    let score = 0;
    if (value.length >= 10) score++;
    if (value.length >= 14) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^a-zA-Z0-9]/.test(value)) score++;
    return Math.min(score, 4);
  }, [value]);

  if (!value) return null;

  const labels = [
    t("profile.strength_weak"),
    t("profile.strength_weak"),
    t("profile.strength_fair"),
    t("profile.strength_good"),
    t("profile.strength_strong"),
  ];
  const colors = [
    "bg-red-500",
    "bg-red-500",
    "bg-yellow-500",
    "bg-blue-500",
    "bg-green-500",
  ];

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= strength - 1 ? colors[strength] : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{labels[strength]}</p>
    </div>
  );
}

// --- Profile form -----------------------------------------------------------

const profileSchema = z.object({ name: nonEmpty("Name") });
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileSection() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Bumped after upload/delete to force <img> cache-bust.
  const [avatarVer, setAvatarVer] = useState(0);

  const form = useZodForm<ProfileValues>(profileSchema, {
    defaultValues: { name: user?.name ?? "" },
  });

  const save = useMutation({
    mutationFn: async (values: ProfileValues) =>
      (await api.patch("/users/me", values, { silent: true })).data,
    onSuccess: (data: { name: string }) => {
      updateUser({ name: data.name });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      logger.info("profile updated");
    },
    onError: (e) => {
      setSaved(false);
      setError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post("/users/me/avatar", fd, { silent: true })).data;
    },
    onSuccess: () => {
      updateUser({ hasAvatar: true });
      setAvatarVer((v) => v + 1);
      logger.info("avatar uploaded");
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const removeAvatar = useMutation({
    mutationFn: async () => (await api.delete("/users/me/avatar", { silent: true })).data,
    onSuccess: () => {
      updateUser({ hasAvatar: false });
      setAvatarVer((v) => v + 1);
      logger.info("avatar removed");
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-base font-semibold mb-4">{t("profile.details")}</h2>

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-5">
        <UserAvatar
          key={avatarVer}
          userId={user?.id ?? ""}
          name={user?.name ?? ""}
          hasAvatar={user?.hasAvatar}
          size="w-16 h-16 text-2xl"
        />
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAvatar.mutate(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Camera size={14} />}
            loading={uploadAvatar.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {t("profile.upload_avatar")}
          </Button>
          {user?.hasAvatar && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Trash2 size={14} />}
              loading={removeAvatar.isPending}
              onClick={() => removeAvatar.mutate()}
            >
              {t("profile.remove_avatar")}
            </Button>
          )}
          <span className="text-xs text-slate-400">{t("profile.avatar_hint")}</span>
        </div>
      </div>

      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4 max-w-md">
        <div>
          <label className="label">{t("auth.email")}</label>
          <p className="text-sm text-slate-700 dark:text-slate-300">{user?.email}</p>
        </div>
        <Field name="name" label={t("auth.name")} error={form.formState.errors.name?.message}>
          <input className="input" {...form.register("name")} />
        </Field>
        <div>
          <label className="label">{t("profile.role")}</label>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{titleCase(user?.role ?? "")}</p>
        </div>
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="success">{t("profile.saved")}</Alert>}
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!form.formState.isDirty}>{t("common.save")}</Button>
      </form>
    </section>
  );
}

// --- Password form ----------------------------------------------------------

type PasswordValues = { currentPassword: string; newPassword: string; confirmPassword: string };

function PasswordSection() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const passwordSchema = useMemo(() => z
    .object({
      currentPassword: z.string().min(1, t("validation.current_password_required")),
      newPassword: passwordPolicyWithMessages(t),
      confirmPassword: z.string().min(1, t("validation.confirm_password_required")),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t("validation.passwords_no_match"),
      path: ["confirmPassword"],
    }), [t]);

  const form = useZodForm<PasswordValues>(passwordSchema, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const change = useMutation({
    mutationFn: async (values: PasswordValues) =>
      (await api.put("/users/me/password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }, { silent: true })).data,
    onSuccess: () => {
      form.reset();
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      logger.info("password changed");
    },
    onError: (e) => {
      setSaved(false);
      setError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  const newPasswordValue = form.watch("newPassword");

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-base font-semibold mb-4">{t("profile.change_password")}</h2>
      <form noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))} className="space-y-4 max-w-md">
        <Field name="currentPassword" label={t("profile.current_password")} error={form.formState.errors.currentPassword?.message}>
          <PasswordInput className="input" autoComplete="current-password" {...form.register("currentPassword")} />
        </Field>
        <div className="space-y-1">
          <Field name="newPassword" label={t("profile.new_password")} error={form.formState.errors.newPassword?.message}>
            <PasswordInput className="input" autoComplete="new-password" {...form.register("newPassword")} />
          </Field>
          <PasswordStrength value={newPasswordValue} />
        </div>
        <Field name="confirmPassword" label={t("profile.confirm_password")} error={form.formState.errors.confirmPassword?.message}>
          <PasswordInput className="input" autoComplete="new-password" {...form.register("confirmPassword")} />
        </Field>
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="success">{t("profile.password_saved")}</Alert>}
        <Button type="submit" variant="primary" loading={change.isPending}>{t("profile.change_password")}</Button>
      </form>
    </section>
  );
}

// --- Jira reporter link -----------------------------------------------------

type JiraUser = { accountId: string; displayName: string; email: string | null };

function JiraLinkSection() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const [query, setQuery] = useState(user?.email ?? "");
  const [results, setResults] = useState<JiraUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useMutation({
    mutationFn: async (q: string) =>
      (await api.get("/jira/discover/users", { params: { q }, silent: true })).data as JiraUser[],
    onSuccess: (data) => {
      setResults(data);
      setSearched(true);
      setError(null);
      logger.info("jira user search", { resultCount: data.length });
    },
    onError: (e) => {
      setResults(null);
      setError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  const saveLink = useMutation({
    mutationFn: async (u: JiraUser | null) =>
      (await api.patch(
        "/users/me",
        {
          jiraAccountId: u?.accountId ?? null,
          jiraDisplayName: u?.displayName ?? null,
        },
        { silent: true },
      )).data,
    onSuccess: (_data, variables) => {
      updateUser({
        jiraAccountId: variables?.accountId ?? null,
        jiraDisplayName: variables?.displayName ?? null,
      });
      setError(null);
      logger.info("jira profile link updated", { linked: !!variables });
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const linked = !!user?.jiraAccountId;

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
        <Bug size={16} /> {t("profile.jira.title")}
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("profile.jira.subtitle")}</p>

      {linked ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="min-w-0">
            <div className="text-sm font-medium">{user?.jiraDisplayName}</div>
            <div className="text-[0.6875rem] text-slate-500 font-mono truncate">{user?.jiraAccountId}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<X size={14} />}
            loading={saveLink.isPending}
            onClick={() => saveLink.mutate(null)}
          >
            {t("profile.jira.unlink")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 max-w-md">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder={t("profile.jira.search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) {
                  e.preventDefault();
                  search.mutate(query.trim());
                }
              }}
            />
            <Button
              size="md"
              variant="secondary"
              leftIcon={<Search size={14} />}
              loading={search.isPending}
              disabled={!query.trim()}
              onClick={() => search.mutate(query.trim())}
            >
              {t("common.search")}
            </Button>
          </div>

          {searched && results && results.length === 0 && (
            <p className="text-xs text-slate-500">{t("profile.jira.no_results")}</p>
          )}

          {results && results.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-700">
              {results.map((u) => (
                <li key={u.accountId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{u.displayName}</div>
                    <div className="text-xs text-slate-500 truncate">{u.email ?? "—"}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={saveLink.isPending && saveLink.variables?.accountId === u.accountId}
                    onClick={() => saveLink.mutate(u)}
                  >
                    {t("profile.jira.pick")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </section>
  );
}

// --- Two-factor authentication -----------------------------------------------

function TwoFactorSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disablePassword, setDisablePassword] = useState("");

  useEffect(() => {
    api.get("/2fa/status").then(({ data }) => setEnabled(data.enabled)).catch((err) => {
      logger.warn("failed to load 2fa status", { err });
    });
  }, []);

  const setup = useMutation({
    mutationFn: async () => (await api.post("/2fa/setup", {}, { silent: true })).data,
    onSuccess: (data: { qrDataUrl: string; secret: string }) => {
      setSetupData(data);
      setCode("");
      setError(null);
      logger.info("2fa setup initiated");
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const confirmSetup = useMutation({
    mutationFn: async (totp: string) => (await api.post("/2fa/confirm-setup", { code: totp }, { silent: true })).data,
    onSuccess: () => {
      setEnabled(true);
      setSetupData(null);
      setCode("");
      setError(null);
      logger.info("2fa enabled");
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const disable = useMutation({
    mutationFn: async (password: string) => (await api.post("/2fa/disable", { password }, { silent: true })).data,
    onSuccess: () => {
      setEnabled(false);
      setDisablePassword("");
      setError(null);
      logger.info("2fa disabled");
    },
    onError: (e) => setError(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  if (enabled === null) return null;

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-base font-semibold mb-1">{t("twofa.title")}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("twofa.subtitle")}</p>

      {enabled && !setupData ? (
        <div className="space-y-4 max-w-md">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <ShieldCheck size={18} />
            <span className="text-sm font-medium">{t("twofa.enabled")}</span>
          </div>
          <div className="space-y-2">
            <Field name="disablePassword" label={t("twofa.disable_password_label")} error={error ?? undefined}>
              <PasswordInput
                className="input"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword((e.target as HTMLInputElement).value)}
              />
            </Field>
            <Button
              variant="danger"
              leftIcon={<ShieldOff size={14} />}
              loading={disable.isPending}
              disabled={!disablePassword}
              onClick={() => { setError(null); disable.mutate(disablePassword); }}
            >
              {t("twofa.disable")}
            </Button>
          </div>
        </div>
      ) : setupData ? (
        <div className="space-y-4 max-w-md">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("twofa.scan_help")}</p>
          <div className="flex justify-center">
            <img src={setupData.qrDataUrl} alt="TOTP QR code" className="w-48 h-48 rounded-lg border border-slate-200 dark:border-slate-700" />
          </div>
          <div>
            <label className="label">{t("twofa.manual_key")}</label>
            <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded select-all break-all">{setupData.secret}</code>
          </div>
          <Field name="totp-confirm" label={t("twofa.code_label")} error={error ?? undefined}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input text-center text-lg tracking-widest font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={confirmSetup.isPending}
              disabled={code.length !== 6}
              onClick={() => { setError(null); confirmSetup.mutate(code); }}
            >
              {t("twofa.verify")}
            </Button>
            <Button variant="secondary" onClick={() => { setSetupData(null); setCode(""); setError(null); }}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          leftIcon={<ShieldCheck size={14} />}
          loading={setup.isPending}
          onClick={() => setup.mutate()}
        >
          {t("twofa.enable")}
        </Button>
      )}
    </section>
  );
}

// --- Page -------------------------------------------------------------------

export function Profile() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        eyebrow={user?.company?.name}
      />
      <div className="space-y-4 mt-6 max-w-2xl">
        <ProfileSection />
        <JiraLinkSection />
        <PasswordSection />
        <TwoFactorSection />
        <section className="rounded-lg border border-red-200 dark:border-red-900/40 p-5">
          <h2 className="text-base font-semibold mb-2">{t("profile.session")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("profile.logout_hint")}</p>
          <Button
            variant="danger"
            leftIcon={<LogOut size={14} />}
            onClick={() => {
              logger.info("user logout from profile", { userId: user?.id });
              logout();
              navigate("/login");
            }}
          >
            {t("nav.logout")}
          </Button>
        </section>
      </div>
    </>
  );
}
