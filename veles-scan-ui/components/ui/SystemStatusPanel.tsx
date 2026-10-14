"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrowserDateTime } from "@/components/ui/BrowserDateTime";
import type { SystemWorkersSnapshot } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

function workerStatusLabel(status: string): string {
  if (status === "busy") return "Занят";
  if (status === "idle") return "Свободен";
  if (status === "offline") return "Оффлайн";
  return "Неизвестно";
}

function workerStatusClass(status: string): string {
  if (status === "busy") return "bg-[#eef4ff] text-[#1d4ed8]";
  if (status === "idle") return "bg-[#f1f1f1] text-[#666]";
  if (status === "offline") return "bg-[#fee2e2] text-[#991b1b]";
  return "bg-[#fff4e5] text-[#9a5800]";
}

type Props = {
  initialData: SystemWorkersSnapshot | null;
};

export function SystemStatusPanel({ initialData }: Props) {
  const [data, setData] = useState<SystemWorkersSnapshot | null>(initialData);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/system-status", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as SystemWorkersSnapshot;
        setData(json);
      }
    } catch {
      // silently keep old data on fetch failure
    }
  }

  useEffect(() => {
    timerRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <section className="space-y-5">
      <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[28px] font-extrabold md:text-[36px]">Статус системы</h2>
            <p className="mt-2 max-w-[760px] text-[14px] text-[#666] md:text-[15px]">
              Мониторинг построен на live heartbeat событиях воркеров и глубине очередей RabbitMQ.
              Обновляется автоматически каждые {POLL_INTERVAL_MS / 1000} сек.
            </p>
          </div>
          <div className="rounded-full border border-black/15 bg-white px-4 py-2 text-[12px] font-semibold text-[#666]">
            Обновлено{" "}
            {data?.updatedAt ? <BrowserDateTime value={data.updatedAt} /> : "—"}
          </div>
        </div>
      </article>

      {data && !data.backendAvailable ? (
        <article className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel)] p-4 text-[13px] text-[#666]">
          Сервис статусов временно недоступен. Проверьте, что backend запущен, и обновите страницу через минуту.
        </article>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["Всего воркеров", data?.workersTotal ?? 0],
            ["Заняты сейчас", data?.workersBusy ?? 0],
            ["Свободны", data?.workersIdle ?? 0],
            ["В очередях", data?.queueSize ?? 0],
          ] as [string, number][]
        ).map(([label, value]) => (
          <article
            key={label}
            className="rounded-2xl border border-black bg-[var(--panel)] p-4"
          >
            <p className="text-[12px] uppercase tracking-[0.16em] text-[#666]">{label}</p>
            <p className="mt-2 text-[30px] font-extrabold">{value}</p>
          </article>
        ))}
      </div>

      <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[22px] font-extrabold">Состояние воркеров</h3>
            <p className="mt-1 text-[13px] text-[#666]">
              Живые статусы, сообщения и текущие задачи.
            </p>
          </div>
          <div className="rounded-2xl border border-black/15 bg-white px-3 py-2 text-center">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#666]">Очереди RabbitMQ</p>
            <p className="mt-1 text-[20px] font-extrabold">
              {Object.keys(data?.queueDepths ?? {}).length}
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-2 rounded-2xl border border-black/15 bg-white p-3 text-[12px] text-[#555]">
          {(Object.entries(data?.queueDepths ?? {}) as [string, number][]).map(([queue, depth]) => (
            <div key={queue} className="flex items-center justify-between gap-3">
              <span className="truncate font-semibold">{queue}</span>
              <span>{depth >= 0 ? depth : "n/a"}</span>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {(data?.workers ?? []).map((worker) => (
            <div
              key={worker.workerId}
              className="rounded-2xl border border-black/15 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[15px] font-bold">{worker.workerId}</p>
                  <p className="mt-1 text-[13px] text-[#666]">
                    {worker.message || "Без сообщения"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold ${workerStatusClass(worker.status)}`}
                  >
                    {workerStatusLabel(worker.status)}
                  </span>
                  <span className="rounded-full border border-black/15 bg-[#fafafa] px-3 py-1 text-[12px] text-[#666]">
                    {worker.workerRole}
                  </span>
                  {worker.currentJobId ? (
                    <span className="text-[12px] text-[#666]">
                      job:{" "}
                      {worker.projectId ? (
                        <Link
                          href={`/admin/projects/${worker.projectId}`}
                          className="font-semibold text-[#1d4ed8] hover:underline"
                        >
                          {worker.projectTitle?.trim() ? worker.projectTitle : worker.projectId}
                        </Link>
                      ) : (
                        worker.currentJobId
                      )}
                    </span>
                  ) : null}
                  <span className="text-[12px] text-[#666]">
                    <BrowserDateTime value={worker.updatedAt} />
                  </span>
                </div>
              </div>
            </div>
          ))}
          {(data?.workers ?? []).length === 0 ? (
            <p className="text-[13px] text-[#666]">Heartbeat-события пока не поступали.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}
