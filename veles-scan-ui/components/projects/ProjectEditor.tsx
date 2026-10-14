"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MdCheck,
  MdCloudDone,
  MdClose,
  MdDelete,
  MdHelpOutline,
  MdMoreVert,
  MdWest,
} from "react-icons/md";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonFeedbackState } from "@/components/ui/Button";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { Input, TextArea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import {
  adminTransferProjectAction,
  deleteProjectAction,
  duplicateProjectAction,
  startProjectAction,
  stopProjectAction,
  updateProjectAction,
} from "@/lib/actions";
import { OFFER_URL, PRIVACY_POLICY_URL } from "@/lib/legal";
import { ProjectStatus, ProjectView } from "@/lib/types";
import { ProjectResultPanel } from "@/components/projects/ProjectResultPanel";
import { QueryExamplesModal } from "@/components/projects/QueryExamplesModal";
import { AdminProjectLogsPanel } from "@/components/projects/AdminProjectLogsPanel";
import { OutputFieldOptionsModal } from "@/components/projects/OutputFieldOptionsModal";

type ProjectEditorProps = {
  project: ProjectView;
  viewStatus?: ProjectStatus;
  backHref?: string;
  isAdminView?: boolean;
};

const statusBadge = {
  new: { label: "Новый", color: "yellow" as const },
  working: { label: "В работе", color: "blue" as const },
  done: { label: "Выполнен", color: "green" as const },
  error: { label: "Ошибка", color: "red" as const },
};

function formatEta(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "нет данных";
  }
  const total = Math.max(0, Math.trunc(seconds));
  if (total <= 0) {
    return "~меньше минуты";
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `~${hours} ч ${minutes} мин`;
  }
  if (minutes > 0) {
    return `~${minutes} мин`;
  }
  return "~меньше минуты";
}

export function ProjectEditor({ project, viewStatus, backHref = "/projects", isAdminView = false }: ProjectEditorProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOutputFieldsModalOpen, setIsOutputFieldsModalOpen] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [actionError, setActionError] = useState("");
  const [consentChecked, setConsentChecked] = useState(project.hasOwnerConsent ?? false);
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [columns, setColumns] = useState(project.columns);
  const [displayPriceRub, setDisplayPriceRub] = useState(project.projectPriceRub);
  const [displayPriceHint, setDisplayPriceHint] = useState(project.priceHint ?? null);
  const [displayPriceHintDetails, setDisplayPriceHintDetails] = useState(project.priceHintDetails ?? []);
  const [pricePending, setPricePending] = useState(project.pricePending ?? false);
  const [transferUserIdentity, setTransferUserIdentity] = useState("");
  const saveTimerRef = useRef<number | null>(null);
  const saveDebounceRef = useRef<number | null>(null);
  const priceRecalcDebounceRef = useRef<number | null>(null);
  const feedbackTimersRef = useRef<Record<string, number | null>>({});
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, ButtonFeedbackState>>({});
  const currentStatus = viewStatus ?? project.status;
  const isEditable = currentStatus === "new";
  const hasPriceCalculationError = pricePending && Boolean(String(displayPriceHint ?? "").trim());
  const badge = statusBadge[currentStatus];
  const processedSites = Math.max(0, project.pipelineProcessedSites ?? 0);
  const totalSites = Math.max(processedSites, project.pipelineTotalSites ?? 0);
  const progressPercent =
    project.pipelineProgressPercent != null
      ? Math.max(0, Math.min(100, project.pipelineProgressPercent))
      : totalSites > 0
        ? Math.max(0, Math.min(100, Math.trunc((processedSites / totalSites) * 100)))
        : 0;

  const historyItems = useMemo(
    () =>
      project.statusHistory.map((entry) => {
        const match = entry.match(/^(.*)\s\((.*)\)$/);
        if (!match) {
          return { label: entry, date: "" };
        }

        return {
          label: match[1],
          date: match[2],
        };
      }),
    [project.statusHistory],
  );

  useEffect(() => {
    setConsentChecked(project.hasOwnerConsent ?? false);
    setDisplayPriceRub(project.projectPriceRub);
    setDisplayPriceHint(project.priceHint ?? null);
    setDisplayPriceHintDetails(project.priceHintDetails ?? []);
    setPricePending(project.pricePending ?? false);
  }, [project.hasOwnerConsent, project.priceHint, project.priceHintDetails, project.pricePending, project.projectPriceRub]);

  useEffect(() => {
    const feedbackTimers = feedbackTimersRef.current;

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
      }
      if (priceRecalcDebounceRef.current) {
        window.clearTimeout(priceRecalcDebounceRef.current);
      }

      Object.values(feedbackTimers).forEach((timer) => {
        if (timer) {
          window.clearTimeout(timer);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (currentStatus !== "working") {
      return;
    }
    const timer = window.setInterval(() => {
      router.refresh();
    }, 7000);
    return () => {
      window.clearInterval(timer);
    };
  }, [currentStatus, router, project.pipelineJobId]);

  const setFeedback = (key: string, value: ButtonFeedbackState) => {
    setButtonFeedback((prev) => ({ ...prev, [key]: value }));
  };

  const completeFeedback = (key: string, isSuccess: boolean) => {
    setFeedback(key, isSuccess ? "success" : "error");
    if (feedbackTimersRef.current[key]) {
      window.clearTimeout(feedbackTimersRef.current[key]!);
    }

    feedbackTimersRef.current[key] = window.setTimeout(() => {
      setFeedback(key, "idle");
    }, 1400);
  };

  const triggerSaveState = async (nextTitle: string, nextDescription: string, nextColumns: string) => {
    if (!isEditable) {
      return;
    }

    setActionError("");
    setSaveState("saving");
    setPricePending(true);
    setDisplayPriceHint(null);
    setDisplayPriceHintDetails([]);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current);
    }
    if (priceRecalcDebounceRef.current) {
      window.clearTimeout(priceRecalcDebounceRef.current);
    }

    saveDebounceRef.current = window.setTimeout(async () => {
      try {
        const response = await updateProjectAction(project.id, {
          title: nextTitle,
          description: nextDescription,
          columns: nextColumns,
        }, {
          recalculatePrice: false,
        });

        if (!response.ok) {
          throw new Error("Сохранение недоступно");
        }
      } catch {
        setSaveState("saved");
        setActionError("Не удалось сохранить изменения");
      }
    }, 250);

    priceRecalcDebounceRef.current = window.setTimeout(async () => {
      try {
        const response = await updateProjectAction(
          project.id,
          {
            title: nextTitle,
            description: nextDescription,
            columns: nextColumns,
          },
          { recalculatePrice: true },
        );
        if (!response.ok) {
          throw new Error("Пересчёт недоступен");
        }
        if (response.pricing) {
          setDisplayPriceRub(response.pricing.projectPriceRub);
          setDisplayPriceHint(response.pricing.priceHint ?? null);
          setDisplayPriceHintDetails(response.pricing.priceHintDetails ?? []);
          setPricePending(response.pricing.pricePending);
        }
        saveTimerRef.current = window.setTimeout(() => {
          setSaveState("saved");
          router.refresh();
        }, 150);
      } catch {
        setSaveState("saved");
        setActionError("Не удалось пересчитать стоимость");
        setPricePending(false);
      }
    }, 1800);
  };

  const onTitleChange = (value: string) => {
    setTitle(value);
    void triggerSaveState(value, description, columns);
  };

  const onDescriptionChange = (value: string) => {
    setDescription(value);
    void triggerSaveState(title, value, columns);
  };

  const onColumnsChange = (value: string) => {
    setColumns(value);
    void triggerSaveState(title, description, value);
  };

  const resetToInitial = () => {
    setTitle(project.title);
    setDescription(project.description);
    setColumns(project.columns);
    setSaveState("saved");
    setShowActions(false);
    setActionError("");
  };

  const startCurrentProject = async () => {
    if (!isEditable) {
      return;
    }

    if (pricePending) {
      const message = "Стоимость проекта ещё рассчитывается. Дождитесь обновления цены перед запуском.";
      setActionError(message);
      showToast({ title: "Цена ещё не зафиксирована", description: message, tone: "error" });
      completeFeedback("start", false);
      return;
    }

    if (!consentChecked) {
      const message = "Нужно подтвердить согласие с политикой конфиденциальности и офертой";
      setActionError(message);
      showToast({ title: "Согласие не подтверждено", description: message, tone: "error" });
      completeFeedback("start", false);
      return;
    }

    setFeedback("start", "loading");
    setActionError("");
    const response = await startProjectAction(project.id, "paid", consentChecked);

    if (!response.ok) {
      const message = response.error ?? "Не удалось запустить проект";
      setActionError(message);
      showToast({ title: "Ошибка запуска", description: message, tone: "error" });
      completeFeedback("start", false);
      return;
    }

    showToast({ title: "Проект запущен", tone: "success" });
    if (response.warning) {
      showToast({ title: "Предупреждение", description: response.warning, tone: "info", durationMs: 7000 });
    }
    completeFeedback("start", true);
    router.refresh();
  };

  const deleteCurrentProject = async () => {
    if (!confirm("Удалить проект без возможности восстановления?")) {
      return;
    }

    setFeedback("delete", "loading");
    setActionError("");
    const response = await deleteProjectAction(project.id);

    if (!response.ok) {
      const message = "Не удалось удалить проект";
      setActionError(message);
      showToast({ title: "Ошибка удаления", description: message, tone: "error" });
      completeFeedback("delete", false);
      return;
    }

    showToast({ title: "Проект удалён", tone: "success" });
    completeFeedback("delete", true);
    router.push(isAdminView ? backHref : "/projects");
    router.refresh();
  };

  const adminStartProjectForFree = async () => {
    if (pricePending) {
      const message = "Стоимость проекта ещё рассчитывается. Дождитесь обновления цены перед запуском.";
      setActionError(message);
      showToast({ title: "Цена ещё не зафиксирована", description: message, tone: "error" });
      completeFeedback("startFree", false);
      return;
    }

    setFeedback("startFree", "loading");
    setActionError("");
    const response = await startProjectAction(project.id, "free");

    if (!response.ok) {
      const message = response.error ?? "Не удалось запустить проект бесплатно";
      setActionError(message);
      showToast({ title: "Ошибка запуска", description: message, tone: "error" });
      completeFeedback("startFree", false);
      return;
    }

    showToast({ title: "Проект запущен бесплатно", tone: "success" });
    if (response.warning) {
      showToast({ title: "Предупреждение", description: response.warning, tone: "info", durationMs: 7000 });
    }
    completeFeedback("startFree", true);
    router.refresh();
  };

  const adminStartProjectPaid = async () => {
    if (pricePending) {
      const message = "Стоимость проекта ещё рассчитывается. Дождитесь обновления цены перед запуском.";
      setActionError(message);
      showToast({ title: "Цена ещё не зафиксирована", description: message, tone: "error" });
      completeFeedback("startPaid", false);
      return;
    }

    setFeedback("startPaid", "loading");
    setActionError("");
    const response = await startProjectAction(project.id, "paid");

    if (!response.ok) {
      const message = response.error ?? "Не удалось запустить проект платно";
      setActionError(message);
      showToast({ title: "Ошибка запуска", description: message, tone: "error" });
      completeFeedback("startPaid", false);
      return;
    }

    showToast({ title: "Проект запущен", tone: "success" });
    if (response.warning) {
      showToast({ title: "Предупреждение", description: response.warning, tone: "info", durationMs: 7000 });
    }
    completeFeedback("startPaid", true);
    router.refresh();
  };

  const stopCurrentProject = async () => {
    if (!confirm("Остановить проект? Он перейдёт в статус ошибки.")) {
      return;
    }

    setFeedback("stop", "loading");
    setActionError("");
    const response = await stopProjectAction(project.id);
    if (!response.ok) {
      const message = "Не удалось остановить проект";
      setActionError(message);
      showToast({ title: "Ошибка остановки", description: message, tone: "error" });
      completeFeedback("stop", false);
      return;
    }

    showToast({ title: "Проект остановлен", tone: "success" });
    completeFeedback("stop", true);
    router.refresh();
  };

  const transferCurrentProject = async () => {
    if (!transferUserIdentity.trim()) {
      setActionError("Укажите email или ID пользователя для передачи");
      completeFeedback("transfer", false);
      return;
    }

    setFeedback("transfer", "loading");
    setActionError("");
    const response = await adminTransferProjectAction(project.id, transferUserIdentity);
    if (!response.ok) {
      const message = response.error ?? "Не удалось передать проект";
      setActionError(message);
      showToast({ title: "Ошибка передачи", description: message, tone: "error" });
      completeFeedback("transfer", false);
      return;
    }

    showToast({ title: "Проект передан", tone: "success" });
    completeFeedback("transfer", true);
    const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
    if (response.targetUserId) {
      nextParams.set("user", response.targetUserId);
    }
    router.push(`${pathname}?${nextParams.toString()}`);
    router.refresh();
  };

  const duplicateCurrentProject = async () => {
    setFeedback("duplicate", "loading");
    setActionError("");
    setShowActions(false);

    const response = await duplicateProjectAction(project.id, isAdminView ? project.ownerId : undefined);
    if (!response.ok) {
      const message = response.error ?? "Не удалось дублировать проект";
      setActionError(message);
      showToast({ title: "Ошибка дублирования", description: message, tone: "error" });
      completeFeedback("duplicate", false);
      return;
    }

    showToast({ title: "Проект продублирован", tone: "success" });
    completeFeedback("duplicate", true);

    if (isAdminView) {
      const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
      const ownerId = response.ownerId ?? project.ownerId;
      if (ownerId) {
        nextParams.set("user", ownerId);
      }
      router.push(`/admin/projects/${response.newProjectId}?${nextParams.toString()}`);
    } else {
      router.push(`/projects/${response.newProjectId}`);
    }
    router.refresh();
  };

  const cardClass = "rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5";

  return (
    <>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ClientNavButton href={backHref} className="mt-1 rounded-md p-1 text-[24px] hover:bg-black/5" aria-label="Назад">
            <MdWest />
          </ClientNavButton>
          <div>
            <h1 className="text-[28px] font-extrabold leading-tight md:text-[36px]">Редактирование проекта</h1>
            <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#5e5e5e]">
              <MdCloudDone className="text-[18px] text-[#5e5e5e]" />
              {saveState === "saving" ? "Сохраняем изменения..." : "Сохранено на сервере"}
            </p>
          </div>
        </div>
        <div className="relative flex items-center gap-1 text-[24px] md:text-[26px]">
          {currentStatus !== "working" ? (
            <button
              aria-label="Удалить"
              className={`rounded-md p-1 ${
                buttonFeedback.delete === "success"
                  ? "bg-[#baf3df] text-[#184a39]"
                  : buttonFeedback.delete === "error"
                    ? "bg-[#ffb9b9] text-[#6f2d2d]"
                    : "hover:bg-black/5"
              }`}
              onClick={deleteCurrentProject}
              disabled={buttonFeedback.delete === "loading"}
            >
              {buttonFeedback.delete === "loading" ? (
                <span className="button-spinner inline-block" aria-hidden="true" />
              ) : buttonFeedback.delete === "success" ? (
                <MdCheck />
              ) : buttonFeedback.delete === "error" ? (
                <MdClose />
              ) : (
                <MdDelete />
              )}
            </button>
          ) : null}
          <button
            aria-label="Ещё"
            className="rounded-md p-1 hover:bg-black/5"
            onClick={() => setShowActions((prev) => !prev)}
          >
            <MdMoreVert />
          </button>
          {showActions ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-[var(--line)] bg-[var(--panel)] p-1 text-[13px] shadow">
              <button
                className="block w-full rounded px-3 py-2 text-left hover:bg-black/5"
                onClick={() => {
                  setIsModalOpen(true);
                  setShowActions(false);
                }}
              >
                Открыть примеры запросов
              </button>
              <button
                className="block w-full rounded px-3 py-2 text-left hover:bg-black/5"
                onClick={duplicateCurrentProject}
                disabled={buttonFeedback.duplicate === "loading"}
              >
                {buttonFeedback.duplicate === "loading" ? "Дублируем..." : "Дублировать проект"}
              </button>
              <button className="block w-full rounded px-3 py-2 text-left hover:bg-black/5" onClick={resetToInitial}>
                Сбросить изменения формы
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p className="mb-4 rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[13px] text-[#8c3a3a]">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-8 2xl:grid-cols-[minmax(0,1fr)_500px]">
        <section className="space-y-4 xl:max-w-[980px]">
          <ProjectResultPanel
            projectId={project.id}
            status={currentStatus}
            resultFile={project.resultFile}
            errorMessage={isAdminView ? project.errorMessage : undefined}
            isAdminView={isAdminView}
          />

          <div className={cardClass}>
            <h2 className="mb-2 text-[20px] font-semibold md:text-[22px]">Название проекта</h2>
            <Input value={title} onChange={(event) => onTitleChange(event.target.value)} disabled={!isEditable} />
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-[20px] font-semibold md:text-[22px]">Описание данных</h2>
            <TextArea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={6}
              disabled={!isEditable}
            />
            <button
              className="mt-2 flex items-center gap-2 text-[12px] text-[#8f8f8f] hover:text-[#6f6f6f]"
              onClick={() => setIsModalOpen(true)}
            >
              <MdHelpOutline /> Примеры заполнения
            </button>
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-[20px] font-semibold md:text-[22px]">Формат ответа (столбцы таблицы)</h2>
            <Input value={columns} onChange={(event) => onColumnsChange(event.target.value)} disabled={!isEditable} />
            <button
              className="mt-2 flex items-center gap-2 text-[12px] text-[#8f8f8f] hover:text-[#6f6f6f]"
              onClick={() => setIsOutputFieldsModalOpen(true)}
            >
              <MdHelpOutline /> Варианты заполнения
            </button>
          </div>

          {isAdminView ? <AdminProjectLogsPanel projectId={project.id} /> : null}
        </section>

        <aside className="mt-6 space-y-5 xl:mt-0">
          <section className={cardClass}>
            <h3 className="mb-2 text-[18px] font-semibold md:text-[20px]">Текущий статус</h3>
            <Badge color={badge.color}>{badge.label}</Badge>
            {currentStatus === "working" ? (
              <div className="mt-3 rounded-md border border-[var(--line)] bg-white px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[12px] text-[#666]">
                  <span>Прогресс выполнения</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-[#ececec]">
                  <div
                    className="h-full bg-[#3d8cff] transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-[12px] text-[#555]">{`Обработано сайтов: ${processedSites} из ${totalSites}`}</p>
                <p className="mt-1 text-[12px] text-[#555]">Осталось примерно: {formatEta(project.pipelineEtaSeconds)}</p>
                {project.pipelineCurrentSiteUrl ? (
                  <p className="mt-1 truncate text-[11px] text-[#777]" title={project.pipelineCurrentSiteUrl}>
                    Сейчас обрабатывается: {project.pipelineCurrentSiteUrl}
                  </p>
                ) : null}
              </div>
            ) : null}
            {isAdminView && project.ownerEmail ? (
              <p className="mt-3 text-[12px] text-[#666]">
                Владелец: {project.ownerName ?? "Пользователь"} · {project.ownerEmail}
              </p>
            ) : null}
          </section>

          <section className={cardClass}>
            <h3 className="mb-2 text-[18px] font-semibold md:text-[20px]">История статусов</h3>
            <ol className="space-y-0.5">
              {historyItems.map((item, index) => {
                const isLast = index === historyItems.length - 1;

                return (
                  <li key={`${item.label}-${item.date}-${index}`} className="grid grid-cols-[18px_1fr] gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-3 w-3 rounded-full border-2 border-black bg-[var(--panel)]" />
                      {!isLast ? <span className="mt-1 h-full min-h-7 border-l border-dashed border-[#8d8d8d]" /> : null}
                    </div>
                    <div className="pb-2">
                      <p className="text-[14px] font-semibold leading-5 md:text-[15px]">{item.label}</p>
                      {item.date ? <p className="text-[12px] text-[#7a7a7a]">{item.date}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[18px] font-semibold md:text-[20px]">Стоимость</h3>
              {project.status === "new" ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    pricePending || saveState === "saving"
                      ? "border-[#d8c27a] bg-[#fff6da] text-[#7b6422]"
                      : "border-[#b7d9c4] bg-[#e8f8ee] text-[#2f6a43]"
                  }`}
                >
                  {pricePending || saveState === "saving"
                    ? hasPriceCalculationError
                      ? "Требуется уточнение"
                      : "Рассчитывается"
                    : "Зафиксировано"}
                </span>
              ) : null}
            </div>
            {project.status === "new" && project.oldProjectPriceRub && project.pricePromoMessage ? (
              <div className="mt-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] text-[#444]">
                {project.pricePromoMessage}
              </div>
            ) : null}
            {project.status === "new" && project.oldProjectPriceRub ? (
              <p className="mt-2 text-[16px] text-[#888] line-through">
                {project.oldProjectPriceRub.toLocaleString("ru-RU")} руб.
              </p>
            ) : null}
            <p className="mt-1 text-[30px] font-bold md:text-[34px]">{displayPriceRub.toLocaleString("ru-RU")} руб.</p>
            {project.status === "new" && pricePending && !hasPriceCalculationError ? (
              <div className="mt-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] text-[#4d4d4d]">
                Стоимость пересчитывается по текущему описанию проекта. До завершения расчёта запуск недоступен.
              </div>
            ) : null}
            {project.status === "new" && displayPriceHint ? (
              <div className="mt-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] text-[#4d4d4d]">
                <p>{displayPriceHint}</p>
                {displayPriceHintDetails.length > 0 ? (
                  <p className="mt-1 text-[#777]">{displayPriceHintDetails.join(" | ")}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          {!isAdminView ? (
            <section className={cardClass}>
              <label
                className={`flex items-center gap-2 text-[12px] text-[#5d5d5d] md:text-[13px] ${!isEditable ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="size-4"
                  disabled={!isEditable}
                  checked={consentChecked}
                  onChange={(event) => setConsentChecked(event.target.checked)}
                />
                Даю согласие с <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="text-[#3d8cff] hover:underline">политикой конфиденциальности</a> и{" "}
                <a href={OFFER_URL} target="_blank" rel="noopener noreferrer" className="text-[#3d8cff] hover:underline">офертой</a>
              </label>

              <Button
                fullWidth
                className="mt-3 text-[14px]"
                disabled={!isEditable || !consentChecked || pricePending || saveState === "saving"}
                onClick={startCurrentProject}
                feedbackState={buttonFeedback.start ?? "idle"}
                showFeedbackIcon
              >
                Начать работу
              </Button>
            </section>
          ) : null}

          {isAdminView ? (
            <section className={cardClass}>
              <h3 className="mb-3 text-[18px] font-semibold md:text-[20px]">Действия администратора</h3>

              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[12px] text-[#666]">Передача проекта другому пользователю</p>
                  <Input
                    value={transferUserIdentity}
                    onChange={(event) => setTransferUserIdentity(event.target.value)}
                    placeholder="Email или ID пользователя"
                  />
                  <Button
                    fullWidth
                    className="mt-2 text-[14px]"
                    onClick={transferCurrentProject}
                    feedbackState={buttonFeedback.transfer ?? "idle"}
                    showFeedbackIcon
                  >
                    Передать проект
                  </Button>
                </div>

                {currentStatus === "new" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {!project.hasOwnerConsent ? (
                      <p className="rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[12px] text-[#8c3a3a] sm:col-span-2">
                        Запуск недоступен: у владельца проекта нет согласия с <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="underline">политикой конфиденциальности</a> и <a href={OFFER_URL} target="_blank" rel="noopener noreferrer" className="underline">офертой</a>.
                      </p>
                    ) : null}
                    <Button
                      fullWidth
                      className="text-[14px]"
                      onClick={adminStartProjectForFree}
                      disabled={!project.hasOwnerConsent || pricePending || saveState === "saving"}
                      feedbackState={buttonFeedback.startFree ?? "idle"}
                      showFeedbackIcon
                    >
                      Запустить бесплатно
                    </Button>
                    <Button
                      fullWidth
                      className="text-[14px]"
                      onClick={adminStartProjectPaid}
                      disabled={!project.hasOwnerConsent || pricePending || saveState === "saving"}
                      feedbackState={buttonFeedback.startPaid ?? "idle"}
                      showFeedbackIcon
                    >
                      Запустить платно
                    </Button>
                  </div>
                ) : null}

                {currentStatus === "working" ? (
                  <Button
                    fullWidth
                    className="text-[14px]"
                    onClick={stopCurrentProject}
                    feedbackState={buttonFeedback.stop ?? "idle"}
                    showFeedbackIcon
                  >
                    Остановить проект
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <QueryExamplesModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <OutputFieldOptionsModal open={isOutputFieldsModalOpen} onClose={() => setIsOutputFieldsModalOpen(false)} />
    </>
  );
}
