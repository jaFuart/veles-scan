import { requireViewer } from "@/lib/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CreateProjectFlow } from "@/components/projects/CreateProjectFlow";

export default async function NewProjectPage() {
  const viewer = await requireViewer();

  return (
    <DashboardLayout viewer={viewer}>
      <CreateProjectFlow />
    </DashboardLayout>
  );
}
