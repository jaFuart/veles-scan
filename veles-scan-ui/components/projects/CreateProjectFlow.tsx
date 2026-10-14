"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftProjectAction } from "@/lib/actions";
import { Skeleton } from "@/components/ui/Skeleton";

export function CreateProjectFlow() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    startTransition(async () => {
      const result = await createDraftProjectAction();
      if (!result.ok) {
        setError(result.error ?? "Не удалось создать проект");
        return;
      }

      router.replace(`/projects/${result.projectId}`);
    });
  }, [router]);

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-black bg-[var(--panel)] p-5 md:p-6">
      {error ? (
        <div>
          <h1 className="text-[24px] font-extrabold md:text-[30px]">Не удалось создать проект</h1>
          <p className="mt-3 rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[13px] text-[#8c3a3a]">
            {error}
          </p>
        </div>
      ) : (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#666]">Подготовка</p>
          <h1 className="mt-2 text-[24px] font-extrabold md:text-[30px]">
            {isPending ? "Создаём новый проект..." : "Инициализируем рабочую область..."}
          </h1>
          <p className="mt-2 text-[14px] text-[#666]">Черновик создаётся без полной перезагрузки страницы.</p>
          <div className="mt-6 space-y-3">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-12 w-2/3 rounded-xl" />
          </div>
        </div>
      )}
    </section>
  );
}
