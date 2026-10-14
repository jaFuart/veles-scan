import { notFound } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProjectEditor } from "@/components/projects/ProjectEditor";
import { requireAdminViewer } from "@/lib/auth";
import { getProjectByIdForAdmin } from "@/lib/repositories";
import { ProjectStatus } from "@/lib/types";

type AdminProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    view?: string;
    user?: string;
    q?: string;
    userRole?: string;
    userActive?: string;
    projectQ?: string;
    projectStatus?: string;
    projectPage?: string;
    opQ?: string;
    opType?: string;
    opPage?: string;
    page?: string;
  }>;
};

const validStatuses: ProjectStatus[] = ["new", "working", "done", "error"];

export default async function AdminProjectPage({ params, searchParams }: AdminProjectPageProps) {
  const viewer = await requireAdminViewer();
  const { id } = await params;
  const query = await searchParams;

  const project = await getProjectByIdForAdmin(id);
  if (!project) {
    notFound();
  }

  const currentView = validStatuses.includes(query.view as ProjectStatus)
    ? (query.view as ProjectStatus)
    : undefined;

  const backParams = new URLSearchParams();
  backParams.set("tab", "users");
  if (query.user) {
    backParams.set("user", query.user);
  }
  if (query.q) {
    backParams.set("q", query.q);
  }
  if (query.userRole) {
    backParams.set("userRole", query.userRole);
  }
  if (query.userActive) {
    backParams.set("userActive", query.userActive);
  }
  if (query.projectQ) {
    backParams.set("projectQ", query.projectQ);
  }
  if (query.projectStatus) {
    backParams.set("projectStatus", query.projectStatus);
  }
  if (query.projectPage) {
    backParams.set("projectPage", query.projectPage);
  }
  if (query.opQ) {
    backParams.set("opQ", query.opQ);
  }
  if (query.opType) {
    backParams.set("opType", query.opType);
  }
  if (query.opPage) {
    backParams.set("opPage", query.opPage);
  }
  if (query.page) {
    backParams.set("page", query.page);
  }

  const backHref = `/admin?${backParams.toString()}`;

  return (
    <DashboardLayout viewer={viewer}>
      <ProjectEditor project={project} viewStatus={currentView} backHref={backHref} isAdminView />
    </DashboardLayout>
  );
}
