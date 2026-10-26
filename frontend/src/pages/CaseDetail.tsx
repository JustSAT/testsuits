import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageLoader } from "../components/Spinner";

/**
 * Cases open in their project's repository, in the case panel; old
 * /cases/:id links land there with the case and its suite selected.
 */
export function CaseDetail() {
  const { id } = useParams();
  const { data: testCase, isLoading, isError } = useQuery({
    queryKey: ["case", id],
    queryFn: async () => (await api.get(`/cases/${id}`)).data,
    enabled: !!id,
  });
  if (isError) return <Navigate to="/projects" replace />;
  if (isLoading || !testCase) return <PageLoader />;
  return <Navigate to={`/projects/${testCase.suite.project.id}?suite=${testCase.suiteId}&case=${testCase.id}`} replace />;
}
