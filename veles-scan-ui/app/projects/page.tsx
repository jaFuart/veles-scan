import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CreateProjectCard, ProjectCard } from "@/components/projects/ProjectCard";
import { requireViewer } from "@/lib/auth";
import { listProjectsByUser } from "@/lib/repositories";

export default async function ProjectsPage() {
  const viewer = await requireViewer();
  const projects = await listProjectsByUser(viewer.id);

  return (
    <DashboardLayout viewer={viewer}>
      <h1 className="mb-5 text-[40px] font-extrabold md:text-[52px]">Мои проекты</h1>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CreateProjectCard />
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </section>
    </DashboardLayout>
  );
}
