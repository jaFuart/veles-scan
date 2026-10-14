"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectDebugLogView } from "@/lib/types";

type AdminProjectLogsPanelProps = {
  projectId: string;
};

type LogsApiResponse = {
  jobId: string | null;
  logs: ProjectDebugLogView[];
  lastId: number | null;
  storageHint?: Record<string, unknown>;
};

function toneByLevel(level: string) {
  const normalized = (level || "").toUpperCase();
  if (normalized === "ERROR" || normalized === "CRITICAL") {
    return "text-[#a53b3b]";
  }
  if (normalized === "WARNING" || normalized === "WARN") {
    return "text-[#8a6b00]";
  }
  if (normalized === "DEBUG") {
    return "text-[#5b5b5b]";
  }
  return "text-[#2a2a2a]";
}

export function AdminProjectLogsPanel({ projectId }: AdminProjectLogsPanelProps) {
  const [logs, setLogs] = useState<ProjectDebugLogView[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  const [storageHint, setStorageHint] = useState<Record<string, unknown> | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const fetchLogs = async (sinceId?: number | null) => {
    const params = new URLSearchParams();
    params.set("limit", "250");
    if (sinceId) {
      params.set("sinceId", String(sinceId));
    }
    const response = await fetch(`/api/admin/projects/${projectId}/debug-logs?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Не удалось загрузить backend-логи");
    }
    const payload = (await response.json()) as LogsApiResponse;
    setJobId(payload.jobId ?? null);
    setStorageHint(payload.storageHint);
    if (sinceId) {
      if (payload.logs.length > 0) {
        setLogs((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of payload.logs) {
            if (!seen.has(item.id)) {
              merged.push(item);
              seen.add(item.id);
            }
          }
          return merged.slice(-2000);
        });
      }
    } else {
      setLogs(payload.logs);
    }
    setLastId(payload.lastId ?? sinceId ?? null);
  };

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        setIsLoading(true);
        await fetchLogs(null);
        if (!alive) {
          return;
        }
        setErrorText("");
      } catch {
        if (alive) {
          setErrorText("Логи временно недоступны");
        }
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!jobId) {
      return;
    }
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        await fetchLogs(lastId);
      } catch {
        if (!stopped) {
          setErrorText("Логи временно недоступны");
        }
      }
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [jobId, lastId, projectId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const nearBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 80;
    if (nearBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [logs]);

  const storageText = useMemo(() => {
    if (!storageHint) {
      return "";
    }
    const parts: string[] = [];
    const stream = storageHint.container_log_stream;
    const dir = storageHint.runtime_log_dir;
    if (typeof stream === "string" && stream.trim()) {
      parts.push(`stream: ${stream}`);
    }
    if (typeof dir === "string" && dir.trim()) {
      parts.push(`files: ${dir}`);
    }
    return parts.join(" · ");
  }, [storageHint]);

  const availableLevels = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((item) => set.add((item.level || "INFO").toUpperCase()));
    return Array.from(set).sort();
  }, [logs]);

  const availableServices = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((item) => set.add(item.service || "unknown"));
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return logs.filter((entry) => {
      const levelOk = levelFilter === "all" || (entry.level || "").toUpperCase() === levelFilter;
      const serviceOk = serviceFilter === "all" || entry.service === serviceFilter;
      if (!levelOk || !serviceOk) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const payloadText = entry.payload ? JSON.stringify(entry.payload) : "";
      return `${entry.message} ${payloadText}`.toLowerCase().includes(needle);
    });
  }, [logs, levelFilter, serviceFilter, searchText]);

  const downloadLogs = (scope: "filtered" | "all") => {
    const source = scope === "filtered" ? filteredLogs : logs;
    if (source.length === 0) {
      return;
    }
    const rows = source.map((entry) => {
      const payloadText =
        entry.payload && Object.keys(entry.payload).length > 0 ? ` ${JSON.stringify(entry.payload, null, 0)}` : "";
      return `[${new Date(entry.createdAt).toISOString()}] ${entry.service} ${entry.level} ${entry.message}${payloadText}`;
    });
    const blob = new Blob([rows.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `project-${projectId}-job-${jobId ?? "none"}-${scope}-logs-${ts}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
      <h2 className="mb-2 text-[20px] font-semibold md:text-[22px]">Подробные backend-логи (admin)</h2>
      <p className="text-[12px] text-[#666]">
        {jobId ? `pipeline_job_id: ${jobId}` : "Для проекта пока не привязан backend job"}
      </p>
      {storageText ? <p className="mt-1 text-[11px] text-[#777]">{storageText}</p> : null}
      {errorText ? <p className="mt-2 text-[12px] text-[#8c3a3a]">{errorText}</p> : null}

      <div className="mt-3 grid gap-2 rounded-md border border-[var(--line)] bg-white p-2 md:grid-cols-4">
        <select
          className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[12px]"
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
        >
          <option value="all">Все уровни</option>
          {availableLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[12px]"
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value)}
        >
          <option value="all">Все сервисы</option>
          {availableServices.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Поиск по сообщению"
          className="rounded border border-[var(--line)] px-2 py-1 text-[12px]"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[11px] hover:bg-black/5"
            onClick={() => {
              setLevelFilter("all");
              setServiceFilter("all");
              setSearchText("");
            }}
          >
            Сбросить
          </button>
          <button
            type="button"
            className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[11px] hover:bg-black/5"
            onClick={() => downloadLogs("filtered")}
            disabled={filteredLogs.length === 0}
          >
            Скачать
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="mt-3 h-[320px] overflow-y-auto rounded-md border border-[var(--line)] bg-white p-2 font-mono text-[11px] leading-5"
      >
        {isLoading && logs.length === 0 ? <p className="text-[#777]">Загружаем логи...</p> : null}
        {!isLoading && logs.length === 0 ? <p className="text-[#777]">Пока нет записей.</p> : null}
        {logs.length > 0 && filteredLogs.length === 0 ? <p className="text-[#777]">По текущим фильтрам ничего не найдено.</p> : null}
        {filteredLogs.map((entry) => (
          <div key={entry.id} className={`${toneByLevel(entry.level)} border-b border-[#f1f1f1] py-1 last:border-b-0`}>
            <span className="text-[#888]">[{new Date(entry.createdAt).toLocaleString("ru-RU")}]</span>{" "}
            <span className="text-[#555]">{entry.service}</span>{" "}
            <span className="font-semibold">{entry.level}</span>{" "}
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#777]">
        Показано: {filteredLogs.length} из {logs.length}
      </p>
    </div>
  );
}
