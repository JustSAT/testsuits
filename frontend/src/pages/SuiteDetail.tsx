import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageLoader } from "../components/Spinner";

/**
 * Suites are browsed in their project's repository now; old /suites/:id links
 * open the repository with that suite selected.
 */
export function SuiteDetail() {
  const { id } = useParams();
  const { data: suite, isLoading, isError } = useQuery({
    queryKey: ["suite", id],
    queryFn: async () => (await api.get(`/suites/${id}`)).data,
    enabled: !!id,
  });
  if (isError) return <Navigate to="/projects" replace />;
  if (isLoading || !suite) return <PageLoader />;
  return <Navigate to={`/projects/${suite.projectId}?suite=${suite.id}`} replace />;
}
