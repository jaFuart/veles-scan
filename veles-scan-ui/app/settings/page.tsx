import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SettingsView } from "@/components/settings/SettingsView";
import { requireViewer } from "@/lib/auth";

type SettingsPageProps = {
  searchParams: Promise<{ error?: string; success?: string }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const viewer = await requireViewer();
  const query = await searchParams;

  return (
    <DashboardLayout viewer={viewer}>
      <SettingsView viewer={viewer} error={query.error} success={query.success} />
    </DashboardLayout>
  );
}
