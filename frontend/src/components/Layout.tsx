import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, PlayCircle, Grid3x3, Users,
  Building2, LogOut, ChevronLeft, ChevronRight, Globe, KeyRound,
  ShieldCheck, FileSearch, Menu, X, UserCircle, ListTree, Boxes,
  Flag, ListChecks, Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useCurrentProjectId } from "../lib/currentProject";
import { SUPPORTED_LANGUAGES } from "../i18n";
import { logger } from "../lib/logger";
import { Logo } from "./Logo";
import { Badge } from "./ui/Badge";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatar } from "./UserAvatar";
import clsx from "clsx";

const COLLAPSE_KEY = "ts_nav_collapsed";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();

  // Desktop: collapsed narrow rail vs wide sidebar. Persisted.
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Mobile: off-canvas drawer toggled by the hamburger. Not persisted — always
  // starts closed on page load and closes whenever the route changes or the
  // viewport crosses back to desktop.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    // Close the drawer if the window grows past the md breakpoint; otherwise
    // a user resizing from phone → tablet ends up with a stuck overlay.
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setMobileOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Close on Escape while the drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const isManager = user?.role === "MANAGER" || user?.role === "ADMIN";
  const isAdmin = user?.role === "ADMIN";

  // Projects listed under "Projects" in the sidebar, Qase style.
  const { data: projects = [] } = useQuery<{ id: string; key: string; name: string }[]>({
    queryKey: ["projects"],
    queryFn: async () => (await api.get("/projects")).data,
    enabled: !!user,
  });
  // The project being worked in: the one in the URL, else the last one opened
  // (so a run page, which lives under /runs/:id, keeps its project open).
  const activeProjectId = useCurrentProjectId();
  const { data: company } = useQuery<{ logo: string | null }>({
    queryKey: ["company"],
    queryFn: async () => (await api.get("/companies/current")).data,
    enabled: !!user,
  });

  const nav = [{ to: "/projects", icon: FolderKanban, label: t("nav.projects") }];
  // Every page of a project lives under it, Qase style.
  const projectNav = (id: string) => [
    { to: `/projects/${id}/dashboard`, icon: LayoutDashboard, label: t("nav.dashboard"), end: true },
    { to: `/projects/${id}`, icon: ListTree, label: t("nav.repository"), end: true },
    { to: `/projects/${id}/runs`, icon: PlayCircle, label: t("nav.runs"), end: false },
    { to: `/projects/${id}/environments`, icon: Boxes, label: t("environments.title"), end: true },
    { to: `/projects/${id}/milestones`, icon: Flag, label: t("projects.milestones"), end: true },
    { to: `/projects/${id}/requirements`, icon: ListChecks, label: t("requirements.title"), end: true },
    { to: `/projects/${id}/matrix`, icon: Grid3x3, label: t("matrix.title"), end: true },
    ...(isManager ? [{ to: `/projects/${id}/settings`, icon: Settings, label: t("projects.settings"), end: true }] : []),
  ];
  const onRunPage = /^\/runs\/[^/]+/.test(location.pathname);
  const adminNav = [
    ...(isManager ? [{ to: "/team", icon: Users, label: t("team.title") }] : []),
    ...(isManager ? [{ to: "/audit", icon: FileSearch, label: t("audit.title") }] : []),
    ...(isManager ? [{ to: "/tokens", icon: KeyRound, label: t("tokens.title") }] : []),
    ...(isManager ? [{ to: "/company", icon: Building2, label: t("company.settings_title") }] : []),
    ...(isAdmin ? [{ to: "/sso", icon: ShieldCheck, label: t("sso.title") }] : []),
  ];

  function changeLang(code: string) {
    i18n.changeLanguage(code).then(() => {
      document.documentElement.lang = code;
      logger.info("language changed", { code });
    });
  }

  const companyInitials = user?.company?.name
    ?.split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "?";

  // The sidebar renders in two modes: fixed off-canvas on mobile, static on
  // desktop. `asideMobileVisible` controls only the mobile transform; desktop
  // collapsing is handled by the existing `collapsed` state + width classes.
  const asideBase =
    "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col";

  return (
    <div className="md:flex md:h-screen">
      {/* Mobile top app bar. md:hidden so desktop is untouched. */}
      <header className="md:hidden sticky top-0 z-30 h-14 flex items-center justify-between px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t("nav.open_menu")}
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
        >
          <Menu size={20} />
        </button>
        <Link to="/" aria-label={t("app.name")}>
          <Logo size={24} withWordmark />
        </Link>
        <div className="w-8" aria-hidden /> {/* symmetry */}
      </header>

      {/* Backdrop — only rendered on mobile when the drawer is open. */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={clsx(
          asideBase,
          // Mobile: off-canvas, fixed, full-height, transforms in/out.
          "fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, reset transforms + fixed positioning, collapse/expand width.
          "md:static md:translate-x-0 md:max-w-none md:transition-[width]",
          collapsed ? "md:w-16" : "md:w-64",
        )}
        aria-label={t("nav.admin")}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-slate-200 dark:border-slate-800">
          {/* Mobile: show logo + close. Desktop: honour collapsed. */}
          <Link to="/" className="px-1 md:hidden" aria-label={t("app.name")}>
            <Logo size={26} withWordmark />
          </Link>
          <Link
            to="/"
            className={clsx("px-1 hidden md:block", collapsed && "md:hidden")}
            aria-label={t("app.name")}
          >
            <Logo size={26} withWordmark />
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden md:block p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            aria-label={collapsed ? t("common.expand") : t("common.collapse")}
            title={collapsed ? t("common.expand") : t("common.collapse")}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {user?.company && (
          <div
            className={clsx(
              "border-b border-slate-100 dark:border-slate-800 px-3 py-3 flex items-center gap-3",
              collapsed && "md:justify-center",
            )}
            title={user.company.name}
          >
            {company?.logo ? (
              <img src={company.logo} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-md bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                {companyInitials}
              </div>
            )}
            <div className={clsx("min-w-0 flex-1", collapsed && "md:hidden")}>
              <div className="text-[0.625rem] uppercase tracking-wide text-slate-500">{t("nav.company")}</div>
              <div className="text-sm font-semibold truncate">{user.company.name}</div>
            </div>
          </div>
        )}

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <Fragment key={to}>
            <NavLink
              to={to}
              end={to === "/" || to === "/projects"}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                  collapsed && "md:justify-center md:px-2",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                )
              }
            >
              <Icon size={18} />
              <span className={clsx("truncate", collapsed && "md:hidden")}>{label}</span>
            </NavLink>
            {to === "/projects" && projects.length > 0 && (
              <div className={clsx("ml-5 border-l border-slate-200 pl-2 dark:border-slate-700 space-y-0.5", collapsed && "md:ml-0 md:border-0 md:pl-0")}>
                {projects.map((p) => (
                  <Fragment key={p.id}>
                    <Link
                      to={`/projects/${p.id}/dashboard`}
                      title={p.name}
                      className={clsx(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                        collapsed && "md:hidden",
                        p.id === activeProjectId
                          ? "font-semibold text-slate-900 dark:text-slate-100"
                          : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-200 text-[0.625rem] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                        {p.key.slice(0, 2)}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </Link>
                    {p.id === activeProjectId && (
                      <div className={clsx("ml-3 space-y-0.5", collapsed && "md:ml-0")}>
                        {projectNav(p.id).map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            title={collapsed ? item.label : undefined}
                            className={({ isActive }) =>
                              clsx(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                                collapsed && "md:justify-center",
                                isActive || (onRunPage && item.to.endsWith("/runs"))
                                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                              )
                            }
                          >
                            <item.icon size={16} className="shrink-0" />
                            <span className={clsx("truncate", collapsed && "md:hidden")}>{item.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
            </Fragment>
          ))}

          {adminNav.length > 0 && (
            <div className={clsx("text-[0.625rem] uppercase tracking-wide text-slate-400 mt-4 mb-1 px-3", collapsed && "md:hidden")}>
              {t("nav.admin")}
            </div>
          )}
          {adminNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                  collapsed && "md:justify-center md:px-2",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                )
              }
            >
              <Icon size={18} />
              <span className={clsx("truncate", collapsed && "md:hidden")}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-2 space-y-2">
          <ThemeToggle collapsed={collapsed} />
          <label className={clsx("flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 px-2", collapsed && "md:hidden")}>
            <Globe size={14} />
            <select
              className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs flex-1 dark:text-slate-200"
              value={i18n.resolvedLanguage}
              onChange={(e) => changeLang(e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          {collapsed && (
            <button
              onClick={() => changeLang(i18n.resolvedLanguage === "fr" ? "en" : "fr")}
              className="hidden md:flex w-full items-center justify-center p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
              title={t("nav.language")}
            >
              <Globe size={16} />
            </button>
          )}

          <div className={clsx("px-2", collapsed && "md:hidden")}>
            <div className="text-[0.625rem] uppercase tracking-wide text-slate-400">{t("nav.signed_in_as")}</div>
            <Link to="/profile" className="block text-sm font-medium mt-0.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              <div className="flex items-center gap-2">
                <UserAvatar userId={user?.id ?? ""} name={user?.name ?? ""} hasAvatar={user?.hasAvatar} size="w-6 h-6 text-xs" />
                <span className="truncate flex-1">{user?.name}</span>
                {user?.role && (
                  <Badge tone={user.role === "MANAGER" ? "violet" : "neutral"} size="xs">
                    {t(`team.${user.role.toLowerCase()}`)}
                  </Badge>
                )}
              </div>
            </Link>
            <button
              onClick={() => {
                logger.info("user logout", { userId: user?.id });
                logout();
                navigate("/login");
              }}
              className="btn-secondary w-full mt-2"
            >
              <LogOut size={14} /> {t("nav.logout")}
            </button>
          </div>
          {collapsed && (
            <Link
              to="/profile"
              className="hidden md:flex w-full items-center justify-center p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              title={t("profile.title")}
            >
              <UserAvatar userId={user?.id ?? ""} name={user?.name ?? ""} hasAvatar={user?.hasAvatar} size="w-7 h-7 text-xs" />
            </Link>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
