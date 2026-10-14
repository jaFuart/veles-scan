import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SupportView } from "@/components/support/SupportView";
import { requireViewer } from "@/lib/auth";

export default async function SupportPage() {
  const viewer = await requireViewer();

  return (
    <DashboardLayout viewer={viewer}>
      <SupportView />
    </DashboardLayout>
  );
}
