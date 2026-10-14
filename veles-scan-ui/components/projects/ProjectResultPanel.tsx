import { MdCheckCircleOutline, MdErrorOutline, MdFileDownload, MdSmartToy } from "react-icons/md";
import { Button } from "@/components/ui/Button";
import { ProjectStatus } from "@/lib/types";

type ProjectResultPanelProps = {
  projectId: string;
  status: ProjectStatus;
  resultFile?: string;
  errorMessage?: string | null;
  isAdminView?: boolean;
};

const statusUi = {
  done: {
    icon: MdCheckCircleOutline,
    title: "Результат выполнения",
    text: "",
    iconColor: "text-[#41b944]",
  },
  error: {
    icon: MdErrorOutline,
    title: "Результат выполнения",
    text: "Работа программы завершилась с системной ошибкой. Пожалуйста, сообщите в поддержку о данной проблеме.",
    iconColor: "text-[#ff5f5f]",
  },
  working: {
    icon: MdSmartToy,
    title: "Алгоритм работает",
    text: "Загляните позже, чтобы получить результат выполнения задачи",
    iconColor: "text-[#3186ff]",
  },
  new: null,
};

function toDisplayResultName(resultFile?: string): string | null {
  const value = (resultFile ?? "").trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "result.xlsx";
    } catch {
      return "result.xlsx";
    }
  }
  const parts = value.split("/").filter(Boolean);
  return parts[parts.length - 1] || value;
}

export function ProjectResultPanel({ projectId, status, resultFile, errorMessage, isAdminView = false }: ProjectResultPanelProps) {
  const data = statusUi[status];
  const displayResultName = toDisplayResultName(resultFile);

  if (!data) {
    return null;
  }

  const Icon = data.icon;

  return (
    <section className="mb-5 rounded-md border border-black bg-white p-3 md:p-4">
      <h3 className="mb-2 flex items-center gap-2 text-[24px] font-bold md:text-[32px]">
        <Icon className={data.iconColor} />
        {data.title}
      </h3>
      {displayResultName ? <p className="mb-2 text-[13px] text-[#8d8d8d]">{displayResultName}</p> : null}
      {status === "error" ? (
        <p className="max-w-[700px] text-[14px] leading-5 text-[#4f4f4f] md:text-[15px] md:leading-6">
          {isAdminView
            ? "Работа программы завершилась с системной ошибкой. Ниже приведена техническая информация из системы."
            : "Работа программы завершилась с ошибкой. Пожалуйста, сообщите в поддержку о данной проблеме."}
        </p>
      ) : data.text ? (
        <p className="max-w-[700px] text-[14px] leading-5 text-[#4f4f4f] md:text-[15px] md:leading-6">{data.text}</p>
      ) : null}
      {status === "error" && errorMessage ? (
        <div className="mt-3 rounded-md border border-[#e5b0b0] bg-[#fff3f3] px-3 py-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8c3a3a]">Текст ошибки</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[#6f2f2f]">{errorMessage}</p>
        </div>
      ) : null}
      {status === "done" ? (
        resultFile ? (
          <Button
            className="mt-2 w-fit px-4 text-[14px]"
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open(`/api/projects/${projectId}/result-file`, "_blank", "noopener,noreferrer");
              }
            }}
          >
            <MdFileDownload /> Скачать файл
          </Button>
        ) : (
          <Button className="mt-2 w-fit px-4 text-[14px]" type="button" disabled>
            <MdFileDownload /> Файл недоступен
          </Button>
        )
      ) : null}
    </section>
  );
}
