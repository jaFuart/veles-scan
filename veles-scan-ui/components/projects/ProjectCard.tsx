"use client";

import { useTransition } from "react";
import { MdAdd } from "react-icons/md";
import { Badge } from "@/components/ui/Badge";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { createDraftProjectAction } from "@/lib/actions";
import { ProjectView } from "@/lib/types";
import { useRouter } from "next/navigation";

const statusBadge = {
  new: { label: "Новый", color: "yellow" as const },
  working: { label: "В работе", color: "blue" as const },
  done: { label: "Выполнен", color: "green" as const },
  error: { label: "Ошибка", color: "red" as const },
};

export function CreateProjectCard() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const createProject = () => {
    startTransition(async () => {
      const result = await createDraftProjectAction();
      if (!result.ok) {
        if (result.redirectTo) {
          router.push(result.redirectTo);
        }
        return;
      }

      router.push(`/projects/${result.projectId}`);
    });
  };

  return (
    <button
      type="button"
      onClick={createProject}
      disabled={isPending}
      className="flex h-[180px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--background)] text-[#7a7a7a] hover:bg-[#f0f0f0]"
    >
      <MdAdd className="text-[48px]" />
      <span className="text-[20px] font-medium">{isPending ? "Создаём проект..." : "Создать проект"}</span>
    </button>
  );
}

type ProjectCardProps = {
  project: ProjectView;
};

export function ProjectCard({ project }: ProjectCardProps) {
  const data = statusBadge[project.status];

  return (
    <ClientNavButton
      href={`/projects/${project.id}`}
      className="flex h-[180px] w-full flex-col rounded-xl border border-black bg-white p-4 text-left hover:bg-[#f7f7f7]"
    >
      <p className="line-clamp-3 text-[20px] font-semibold leading-[1.2]">{project.title}</p>
      <div className="mt-auto flex items-center gap-3">
        <Badge color={data.color}>{data.label}</Badge>
        <span className="text-[12px] text-[#8f8f8f]">{project.updatedText}</span>
      </div>
    </ClientNavButton>
  );
}
