import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "./lib/auth";
import { useTheme } from "./lib/theme";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotFound } from "./pages/NotFound";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Milestones } from "./pages/Milestones";
import { Matrix } from "./pages/Matrix";
import { SuiteDetail } from "./pages/SuiteDetail";
import { CaseDetail } from "./pages/CaseDetail";
import { Runs } from "./pages/Runs";
import { RunDetail } from "./pages/RunDetail";
import { Team } from "./pages/Team";
import { CompanySettings } from "./pages/CompanySettings";
import { SsoSettings } from "./pages/SsoSettings";
import { Audit } from "./pages/Audit";
import { ProjectSettings } from "./pages/ProjectSettings";
import { Tokens } from "./pages/Tokens";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Requirements } from "./pages/Requirements";
import { ImportCases } from "./pages/ImportCases";
import { Profile } from "./pages/Profile";
import { VerifyEmail } from "./pages/VerifyEmail";
import { Environments } from "./pages/Environments";
import { ProjectRedirect } from "./components/ProjectRedirect";

function Protected({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  // Users stored before the multi-tenant migration have no .company — force a fresh login.
  if (user && !user.company) {
    logout();
    return <Navigate to="/login" replace />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </Layout>
  );
}

export function App() {
  const theme = useTheme((s) => s.theme);
  // Top-right toasts collide with the mobile hamburger; drop them to
  // bottom-center on narrow screens where they're easier to thumb-reach.
  const [toastPos, setToastPos] = useState<"top-right" | "bottom-center">(
    () => (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches ? "top-right" : "bottom-center"),
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setToastPos(e.matches ? "top-right" : "bottom-center");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <>
    <Toaster position={toastPos} richColors closeButton theme={theme} />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/" element={<Protected><ProjectRedirect page="dashboard" /></Protected>} />
      <Route path="/projects" element={<Protected><Projects /></Protected>} />
      <Route path="/projects/:id" element={<Protected><ProjectDetail /></Protected>} />
      <Route path="/projects/:id/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/projects/:id/runs" element={<Protected><Runs /></Protected>} />
      <Route path="/projects/:id/matrix" element={<Protected><Matrix /></Protected>} />
      <Route path="/projects/:id/environments" element={<Protected><Environments /></Protected>} />
      <Route path="/projects/:id/milestones" element={<Protected><Milestones /></Protected>} />
      <Route path="/projects/:id/settings" element={<Protected><ProjectSettings /></Protected>} />
      <Route path="/projects/:id/requirements" element={<Protected><Requirements /></Protected>} />
      <Route path="/projects/:id/import" element={<Protected><ImportCases /></Protected>} />
      <Route path="/suites/:id" element={<Protected><SuiteDetail /></Protected>} />
      <Route path="/cases/:id" element={<Protected><CaseDetail /></Protected>} />
      <Route path="/runs" element={<Protected><ProjectRedirect page="runs" /></Protected>} />
      <Route path="/runs/:id" element={<Protected><RunDetail /></Protected>} />
      <Route path="/matrix" element={<Protected><ProjectRedirect page="matrix" /></Protected>} />
      <Route path="/team" element={<Protected><Team /></Protected>} />
      <Route path="/tokens" element={<Protected><Tokens /></Protected>} />
      <Route path="/company" element={<Protected><CompanySettings /></Protected>} />
      <Route path="/sso" element={<Protected><SsoSettings /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Protected><NotFound /></Protected>} />
    </Routes>
    </>
  );
}
