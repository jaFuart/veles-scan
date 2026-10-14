import { notFound } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProjectEditor } from "@/components/projects/ProjectEditor";
import { requireViewer } from "@/lib/auth";
import { getProjectByIdForUser } from "@/lib/repositories";
import { ProjectStatus } from "@/lib/types";

type ProjectDetailsPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
};

const validStatuses: ProjectStatus[] = ["new", "working", "done", "error"];

export default async function ProjectDetailsPage({
  params,
  searchParams,
}: ProjectDetailsPageProps) {
  const viewer = await requireViewer();
  const { id } = await params;
  const query = await searchParams;

  const project = await getProjectByIdForUser(viewer.id, id);
  if (!project) {
    notFound();
  }

  const currentView = validStatuses.includes(query.view as ProjectStatus)
    ? (query.view as ProjectStatus)
    : undefined;

  return (
    <DashboardLayout viewer={viewer}>
      <ProjectEditor project={project} viewStatus={currentView} />
    </DashboardLayout>
  );
}
