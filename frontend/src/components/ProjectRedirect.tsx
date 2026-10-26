import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { forgetProject, rememberedProjectId } from "../lib/currentProject";
import { PageLoader } from "./Spinner";

/**
 * Global entry points (/, /runs, /matrix) open the matching page of the
 * current project: the last one opened, else the first one; with no project
 * at all, the projects list.
 */
export function ProjectRedirect({ page }: { page: "dashboard" | "runs" | "matrix" }) {
  const { data: projects, isLoading } = useQuery<{ id: string }[]>({
    queryKey: ["projects"],
    queryFn: async () => (await api.get("/projects")).data,
  });
  if (isLoading || !projects) return <PageLoader />;
  const remembered = rememberedProjectId();
  if (remembered && !projects.some((p) => p.id === remembered)) forgetProject(remembered);
  const target = projects.find((p) => p.id === remembered) ?? projects[0];
  if (!target) return <Navigate to="/projects" replace />;
  const search = typeof window !== "undefined" ? window.location.search : "";
  return <Navigate to={`/projects/${target.id}/${page}${search}`} replace />;
}
