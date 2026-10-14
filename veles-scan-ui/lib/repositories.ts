import { query, withTransaction } from "@/lib/db";
import { createHash } from "crypto";
import {
  FinanceOperationView,
  ProjectDebugLogView,
  ProjectStatus,
  ProjectView,
  PromoCodeView,
  SystemWorkersSnapshot,
  SystemWorkerView,
  Viewer,
} from "@/lib/types";

type ProjectRow = {
  id: string;
  user_id?: string;
  pipeline_job_id?: string | null;
  pipeline_job_status?: string | null;
  pipeline_job_progress?: number | null;
  pipeline_job_metadata?: Record<string, unknown> | null;
  pipeline_job_error?: string | null;
  title: string;
  status: ProjectStatus;
  description: string;
  project_price_rub: number;
  result_file: string | null;
  error_message?: string | null;
  updated_at: Date;
  owner_name?: string | null;
  owner_email?: string;
  has_owner_consent?: boolean;
  price_reasoning_short?: string | null;
  price_reasoning_details?: unknown;
  pricing_last_prompt?: string | null;
  pricing_last_prompt_hash?: string | null;
  pricing_last_model?: string | null;
  pricing_last_source?: string | null;
  pricing_last_input_signature?: string | null;
  pricing_resolved_okved_codes?: unknown;
  pricing_resolved_output_fields?: unknown;
  pricing_resolved_data_filters?: unknown;
};

type BackendJobResponse = {
  status?: unknown;
  progress?: unknown;
  metadata?: unknown;
  error_message?: unknown;
};

type BackendJobResultResponse = {
  status?: unknown;
  download_url?: unknown;
  result_key?: unknown;
};

type BackendCancelJobResponse = {
  status?: unknown;
  message?: unknown;
};

type BackendIntentPreviewResponse = {
  resolved_okved_codes?: string[];
  resolved_output_fields?: Array<{ key?: string; label?: string }>;
  resolved_data_filters?: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }>;
};

type BackendIntentPreviewResult = {
  preview: BackendIntentPreviewResponse | null;
  status: number | null;
  detail: string | null;
};

type BackendPriceEstimateResponse = {
  estimated_price_rub?: number;
  pricing_source?: string;
  pricing_model?: string | null;
  pricing_reason_short?: string;
  pricing_reason_details?: string[];
  pricing_prompt?: string;
  pricing_prompt_hash?: string;
  input_signature?: string;
};

type PricingResolvedOutputField = { key?: string; label?: string };
type PricingResolvedDataFilter = { column?: string; operator?: string; value?: unknown; value_type?: string };

type CachedPricingResolution = {
  resolvedOkvedCodes: string[];
  resolvedOutputFields: PricingResolvedOutputField[];
  resolvedDataFilters: PricingResolvedDataFilter[];
};

type DraftPricingState = {
  projectPriceRub: number;
  priceHint: string | null;
  priceHintDetails: string[];
  pricePending: boolean;
};

function mapPipelineRuntime(row: ProjectRow): Pick<
  ProjectView,
  | "pipelineJobId"
  | "pipelineJobStatus"
  | "pipelineProgressPercent"
  | "pipelineProcessedSites"
  | "pipelineTotalSites"
  | "pipelineEtaSeconds"
  | "pipelineCurrentSiteUrl"
> {
  const pipelineStatusRaw = typeof row.pipeline_job_status === "string" ? row.pipeline_job_status.toLowerCase() : "";
  const metadata = row.pipeline_job_metadata ?? {};
  const runtime = typeof metadata === "object" && metadata ? (metadata as Record<string, unknown>).runtime_progress : undefined;
  const runtimeObj = typeof runtime === "object" && runtime ? (runtime as Record<string, unknown>) : {};

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const processedSites = toNumber(runtimeObj.processed_sites);
  const totalSites = toNumber(runtimeObj.total_sites);
  const isPipelineCompleted = pipelineStatusRaw === "completed";
  const etaSecondsRaw = toNumber(runtimeObj.eta_seconds);
  const etaSeconds = isPipelineCompleted ? 0 : etaSecondsRaw != null && etaSecondsRaw >= 0 ? Math.trunc(etaSecondsRaw) : null;

  const baseProgress = row.pipeline_job_progress != null ? Math.trunc(row.pipeline_job_progress) : null;
  let runtimeProgress: number | null = null;
  const effectiveProcessedSites =
    isPipelineCompleted && totalSites != null && totalSites >= 0 ? totalSites : processedSites;
  if (effectiveProcessedSites != null && totalSites != null && totalSites > 0) {
    runtimeProgress = Math.trunc((effectiveProcessedSites / totalSites) * 100);
  }
  if (isPipelineCompleted) {
    runtimeProgress = 100;
  }

  const mergedProgress = runtimeProgress != null ? Math.max(baseProgress ?? 0, runtimeProgress) : baseProgress;
  const clampedProgress = mergedProgress != null ? Math.max(0, Math.min(100, mergedProgress)) : null;

  const currentSiteUrl =
    typeof runtimeObj.current_site_url === "string" && runtimeObj.current_site_url.trim()
      ? runtimeObj.current_site_url.trim()
      : null;

  return {
    pipelineJobId: row.pipeline_job_id ?? null,
    pipelineJobStatus: row.pipeline_job_status ?? null,
    pipelineProgressPercent: clampedProgress,
    pipelineProcessedSites: effectiveProcessedSites != null ? Math.trunc(effectiveProcessedSites) : null,
    pipelineTotalSites: totalSites != null ? Math.trunc(totalSites) : null,
    pipelineEtaSeconds: etaSeconds,
    pipelineCurrentSiteUrl: currentSiteUrl,
  };
}

function deriveProjectStatusFromPipeline(baseStatus: ProjectStatus, pipelineStatus: string | null | undefined): ProjectStatus {
  const status = (pipelineStatus ?? "").toLowerCase().trim();
  if (status === "completed") {
    return "done";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "running" || status === "queued") {
    return baseStatus === "new" ? "working" : baseStatus;
  }
  return baseStatus;
}

const NO_ROWS_AFTER_FILTERS_MARKER = "No rows left after applying intent filters.";
const NO_ROWS_AFTER_FILTERS_USER_MESSAGE =
  "Не удалось по имеющимся открытым базам найти интересующие компании. Попробуйте другой запрос.";
const SYSTEM_FAILURE_USER_MESSAGE =
  "Работа программы завершилась с системной ошибкой. Деньги возвращены на баланс. Попробуйте запустить проект повторно.";
const PRICE_CALCULATION_UNAVAILABLE_MESSAGE =
  "Пока не получилось рассчитать стоимость. Чаще всего это значит, что запрос слишком общий, для такой ниши у нас пока нет данных, или условия лучше разделить на несколько более простых запросов.";
const DYNAMIC_MODEL_SURCHARGE_RUB: Record<"nano" | "mini" | "full", number> = {
  nano: 0,
  mini: 120,
  full: 390,
};

type DynamicPricingContext = {
  basePriceRub: number;
  responseFormat: string;
  resolvedOutputFields: Array<{ key?: string; label?: string }> | null;
  resolvedDataFilters: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }> | null;
  resolvedOkvedCodes: string[];
};

function detectModelTier(): "nano" | "mini" | "full" {
  const rawTier = String(process.env.DYNAMIC_PRICE_MODEL_TIER ?? "").trim().toLowerCase();
  if (rawTier === "nano" || rawTier === "mini" || rawTier === "full") {
    return rawTier;
  }
  const model = String(process.env.OPENAI_MODEL ?? "").trim().toLowerCase();
  if (!model) {
    return "mini";
  }
  if (model.includes("nano")) {
    return "nano";
  }
  if (model.includes("mini")) {
    return "mini";
  }
  return "full";
}

function countRequestedOutputFields(
  responseFormat: string,
  resolvedOutputFields: Array<{ key?: string; label?: string }> | null,
): number {
  const fromResolved = (resolvedOutputFields ?? []).filter((field) => {
    const key = String(field?.key ?? "").trim();
    const label = String(field?.label ?? "").trim();
    return Boolean(key || label);
  }).length;
  if (fromResolved > 0) {
    return fromResolved;
  }
  return responseFormat
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function countResolvedFilterValues(
  resolvedDataFilters: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }> | null,
): number {
  let total = 0;
  for (const filter of resolvedDataFilters ?? []) {
    const value = filter?.value;
    if (Array.isArray(value)) {
      total += value.filter((item) => String(item ?? "").trim()).length;
      continue;
    }
    if (typeof value === "string") {
      const parts = value
        .split(/,|;|\||\sи\s/gi)
        .map((item) => item.trim())
        .filter(Boolean);
      total += parts.length > 0 ? parts.length : 1;
      continue;
    }
    if (value != null) {
      total += 1;
    }
  }
  return total;
}

function computeDynamicProjectPriceRub(context: DynamicPricingContext): number {
  const base = Math.max(0, Math.trunc(context.basePriceRub || 0));
  const outputFieldsCount = countRequestedOutputFields(context.responseFormat, context.resolvedOutputFields);
  const okvedCount = Math.max(0, context.resolvedOkvedCodes.length);
  const filtersCount = Math.max(0, (context.resolvedDataFilters ?? []).length);
  const filtersValuesCount = countResolvedFilterValues(context.resolvedDataFilters);

  let complexitySurcharge = 0;
  if (outputFieldsCount > 40) {
    complexitySurcharge = 390;
  } else if (outputFieldsCount > 25) {
    complexitySurcharge = 190;
  }

  // Proxy-like breadth surcharge by selected OKVED scope.
  let breadthSurcharge = 0;
  if (okvedCount > 20) {
    breadthSurcharge = 160;
  } else if (okvedCount > 10) {
    breadthSurcharge = 80;
  }

  // Slight surcharge for highly constrained requests (extra matching work in pipeline).
  const filtersSurcharge = filtersCount >= 3 ? 60 : 0;
  let geographySurcharge = 0;
  if (filtersValuesCount >= 5) {
    geographySurcharge = 90;
  } else if (filtersValuesCount >= 2) {
    geographySurcharge = 40;
  }
  const modelSurcharge = DYNAMIC_MODEL_SURCHARGE_RUB[detectModelTier()];

  return base + complexitySurcharge + breadthSurcharge + filtersSurcharge + geographySurcharge + modelSurcharge;
}

function computeDraftProjectPriceRub(basePriceRub: number, columnCount: number): number {
  const placeholders = Array.from({ length: Math.max(0, columnCount) }, (_, idx) => ({ key: String(idx + 1) }));
  return computeDynamicProjectPriceRub({
    basePriceRub,
    responseFormat: "",
    resolvedOutputFields: placeholders,
    resolvedDataFilters: [],
    resolvedOkvedCodes: [],
  });
}

function buildPriceHint(
  basePriceRub: number,
  finalPriceRub: number,
  context: DynamicPricingContext,
): { short: string; details: string[] } {
  const details: string[] = [];
  details.push(`База: ${Math.max(0, Math.trunc(basePriceRub)).toLocaleString("ru-RU")} ₽`);

  const outputFieldsCount = countRequestedOutputFields(context.responseFormat, context.resolvedOutputFields);
  if (outputFieldsCount > 40) {
    details.push("Сложность формата (41+ полей): +390 ₽");
  } else if (outputFieldsCount > 25) {
    details.push("Сложность формата (26-40 полей): +190 ₽");
  }

  const okvedCount = Math.max(0, context.resolvedOkvedCodes.length);
  if (okvedCount > 20) {
    details.push("Широкая ниша (21+ ОКВЭД): +160 ₽");
  } else if (okvedCount > 10) {
    details.push("Ниша средней ширины (11-20 ОКВЭД): +80 ₽");
  }

  const filtersCount = Math.max(0, (context.resolvedDataFilters ?? []).length);
  const filtersValuesCount = countResolvedFilterValues(context.resolvedDataFilters);
  if (filtersCount >= 3) {
    details.push("Сложные условия фильтрации (3+ фильтра): +60 ₽");
  }
  if (filtersValuesCount >= 5) {
    details.push("Широкий гео/фильтр-охват (5+ значений): +90 ₽");
  } else if (filtersValuesCount >= 2) {
    details.push("Расширенный гео/фильтр-охват (2-4 значения): +40 ₽");
  }

  const modelTier = detectModelTier();
  const modelSurcharge = DYNAMIC_MODEL_SURCHARGE_RUB[modelTier];
  if (modelSurcharge > 0) {
    details.push(`Модель (${modelTier}): +${modelSurcharge} ₽`);
  }

  const short = `Цена пересчитана по описанию, формату ответа и сложности поиска: ${finalPriceRub.toLocaleString("ru-RU")} ₽`;
  return { short, details };
}

function buildPricingInputSignature(input: { intent: string; responseFormat: string; basePriceRub: number; modelTier: string }): string {
  const canonical = JSON.stringify({
    intent: input.intent.trim().toLowerCase(),
    responseFormat: input.responseFormat.trim().toLowerCase(),
    basePriceRub: Math.max(0, Math.trunc(input.basePriceRub)),
    modelTier: input.modelTier,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function parseStringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function parseResolvedOutputFieldsJson(value: unknown): PricingResolvedOutputField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: PricingResolvedOutputField[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const key = String((item as Record<string, unknown>).key ?? "").trim();
    const label = String((item as Record<string, unknown>).label ?? "").trim();
    if (!key && !label) {
      continue;
    }
    items.push({ key: key || undefined, label: label || undefined });
  }
  return items;
}

function parseResolvedDataFiltersJson(value: unknown): PricingResolvedDataFilter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (item && typeof item === "object" ? (item as PricingResolvedDataFilter) : null))
    .filter((item): item is PricingResolvedDataFilter => Boolean(item));
}

function getCachedPricingResolution(row: ProjectRow): CachedPricingResolution | null {
  const resolvedOkvedCodes = parseStringArrayJson(row.pricing_resolved_okved_codes);
  const resolvedOutputFields = parseResolvedOutputFieldsJson(row.pricing_resolved_output_fields);
  const resolvedDataFilters = parseResolvedDataFiltersJson(row.pricing_resolved_data_filters);
  if (!resolvedOkvedCodes.length && !resolvedOutputFields.length && !resolvedDataFilters.length) {
    return null;
  }
  return { resolvedOkvedCodes, resolvedOutputFields, resolvedDataFilters };
}

function parsePriceHintDetails(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function buildPriceCalculationFailureMessage(detail: string | null | undefined): string {
  const normalized = String(detail ?? "").toLowerCase();
  if (!normalized) {
    return PRICE_CALCULATION_UNAVAILABLE_MESSAGE;
  }
  if (
    normalized.includes("не подготовлены данные")
    || normalized.includes("snapshot")
    || normalized.includes("no checko snapshots")
  ) {
    return "Пока не получилось рассчитать стоимость: для такого запроса у нас ещё нет достаточно подготовленных данных. Попробуйте позже или уточните нишу чуть уже.";
  }
  if (normalized.includes("unable to resolve okved") || normalized.includes("не удалось определить оквэд")) {
    return "Пока не получилось рассчитать стоимость: запрос пока слишком общий, и по нему трудно точно определить нишу. Поможет, если добавить регион, тип компаний или более конкретное направление деятельности.";
  }
  if (normalized.includes("запрос слишком общий") || normalized.includes("too broad")) {
    return "Пока не получилось рассчитать стоимость: запрос слишком общий. Если уточнить нишу, регион, размер бизнеса или тип компаний, расчёт станет точнее.";
  }
  if (
    normalized.includes("слишком разные")
    || normalized.includes("too diverse")
    || normalized.includes("разделите задачу")
  ) {
    return "Пока не получилось рассчитать стоимость: в одном запросе собралось слишком много разных или сложных условий. Лучше разделить его на несколько отдельных задач, и тогда расчёт пройдёт точнее.";
  }
  if (normalized.includes("price-estimate-failed")) {
    return "Пока не получилось рассчитать стоимость автоматически. Попробуйте немного уточнить запрос: например, добавить нишу, регион или убрать лишние сложные условия.";
  }
  return PRICE_CALCULATION_UNAVAILABLE_MESSAGE;
}

async function fetchIntentPreviewFromBackend(
  intent: string,
  responseFormat: string,
): Promise<BackendIntentPreviewResult> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      const response = await fetch(`${backendBase}/jobs/intent-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: intent.trim(),
          response_format: responseFormat,
          max_okved_codes: 30,
          max_output_fields: 30,
        }),
        cache: "no-store",
        next: { revalidate: 0 },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        let detail = "";
        try {
          const payload = (await response.json()) as { detail?: string };
          detail = String(payload.detail ?? "").trim();
        } catch {
          detail = "";
        }
        return { preview: null, status: response.status, detail: detail || null };
      }
      return {
        preview: (await response.json()) as BackendIntentPreviewResponse,
        status: response.status,
        detail: null,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { preview: null, status: null, detail: null };
  }
}

async function fetchPriceEstimateFromBackend(input: {
  basePriceRub: number;
  responseFormat: string;
  resolvedOutputFields: Array<{ key?: string; label?: string }>;
  resolvedDataFilters: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }>;
  resolvedOkvedCodes: string[];
  previousPriceRub?: number | null;
  previousPrompt?: string | null;
  previousReasoningShort?: string | null;
  previousReasoningDetails?: string[];
}): Promise<BackendPriceEstimateResponse | null> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${backendBase}/jobs/price-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_price_rub: Math.max(0, Math.trunc(input.basePriceRub)),
          response_format: input.responseFormat,
          resolved_output_fields: input.resolvedOutputFields,
          resolved_data_filters: input.resolvedDataFilters,
          resolved_okved_codes: input.resolvedOkvedCodes,
          previous_price_rub: input.previousPriceRub ?? null,
          previous_prompt: input.previousPrompt ?? null,
          previous_reasoning_short: input.previousReasoningShort ?? null,
          previous_reasoning_details: input.previousReasoningDetails ?? [],
          min_delta_rub: 25,
        }),
        cache: "no-store",
        next: { revalidate: 0 },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as BackendPriceEstimateResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return null;
  }
}

function isNoRowsAfterFiltersError(errorMessage: string | null | undefined): boolean {
  const text = (errorMessage ?? "").toLowerCase();
  if (!text) {
    return false;
  }
  return text.includes("no rows left after applying intent filters");
}

async function refundNoRowsFailure(projectId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const projectResult = await tx.query<{
      id: string;
      user_id: string;
      title: string;
      project_price_rub: number;
      started_at: Date | null;
    }>(
      `SELECT id, user_id, title, project_price_rub, started_at
       FROM projects
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [projectId],
    );
    const project = projectResult.rows[0];
    if (!project || project.project_price_rub <= 0) {
      return;
    }

    const refundNote = `Автовозврат: не найдено компаний по фильтрам (project_id=${project.id})`;
    const alreadyRefunded = await tx.query<{ id: number }>(
      `SELECT id
       FROM finance_operations
       WHERE user_id = $1
         AND operation_type = 'Пополнение'
         AND note = $2
       LIMIT 1`,
      [project.user_id, refundNote],
    );
    if ((alreadyRefunded.rowCount ?? 0) > 0) {
      return;
    }

    const startBoundary = project.started_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const debitNote = `Запуск проекта ${project.title}`;
    const debitExists = await tx.query<{ id: number }>(
      `SELECT id
       FROM finance_operations
       WHERE user_id = $1
         AND operation_type = 'Списание'
         AND amount_rub = $2
         AND COALESCE(note, '') = $3
         AND created_at >= $4
       ORDER BY id DESC
       LIMIT 1`,
      [project.user_id, project.project_price_rub, debitNote, startBoundary],
    );
    if ((debitExists.rowCount ?? 0) === 0) {
      return;
    }

    await tx.query(
      `UPDATE users
       SET balance_rub = balance_rub + $1
       WHERE id = $2`,
      [project.project_price_rub, project.user_id],
    );
    await tx.query(
      `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
       VALUES ($1, 'Пополнение', $2, $3)`,
      [project.user_id, project.project_price_rub, refundNote],
    );
  });
}

async function refundSystemFailure(projectId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const projectResult = await tx.query<{
      id: string;
      user_id: string;
      title: string;
      project_price_rub: number;
      started_at: Date | null;
    }>(
      `SELECT id, user_id, title, project_price_rub, started_at
       FROM projects
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [projectId],
    );
    const project = projectResult.rows[0];
    if (!project || project.project_price_rub <= 0) {
      return;
    }

    const refundNote = `Автовозврат: системная ошибка пайплайна (project_id=${project.id})`;
    const alreadyRefunded = await tx.query<{ id: number }>(
      `SELECT id
       FROM finance_operations
       WHERE user_id = $1
         AND operation_type = 'Пополнение'
         AND note = $2
       LIMIT 1`,
      [project.user_id, refundNote],
    );
    if ((alreadyRefunded.rowCount ?? 0) > 0) {
      return;
    }

    const startBoundary = project.started_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const debitNote = `Запуск проекта ${project.title}`;
    const debitExists = await tx.query<{ id: number }>(
      `SELECT id
       FROM finance_operations
       WHERE user_id = $1
         AND operation_type = 'Списание'
         AND amount_rub = $2
         AND COALESCE(note, '') = $3
         AND created_at >= $4
       ORDER BY id DESC
       LIMIT 1`,
      [project.user_id, project.project_price_rub, debitNote, startBoundary],
    );
    if ((debitExists.rowCount ?? 0) === 0) {
      return;
    }

    await tx.query(
      `UPDATE users
       SET balance_rub = balance_rub + $1
       WHERE id = $2`,
      [project.project_price_rub, project.user_id],
    );
    await tx.query(
      `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
       VALUES ($1, 'Пополнение', $2, $3)`,
      [project.user_id, project.project_price_rub, refundNote],
    );
  });
}

function isSystemPipelineFailure(errorMessage: string | null | undefined): boolean {
  const text = (errorMessage ?? "").toLowerCase();
  if (!text) {
    return false;
  }
  if (isNoRowsAfterFiltersError(errorMessage)) {
    return false;
  }
  if (text.includes("остановлен администратором")) {
    return false;
  }
  return (
    text.includes("traceback")
    || text.includes("stage_")
    || text.includes("attributeerror")
    || text.includes("indexerror")
    || text.includes("nameerror")
    || text.includes("typeerror")
    || text.includes("pipeline failed")
    || text.includes("returned non-zero exit status")
  );
}

async function syncProjectStatusFromPipeline(
  projectId: string,
  fromStatus: ProjectStatus,
  toStatus: ProjectStatus,
  pipelineErrorMessage?: string | null,
): Promise<void> {
  if (fromStatus === toStatus) {
    return;
  }
  if (toStatus !== "done" && toStatus !== "error") {
    return;
  }

  const updatedText = toStatus === "done" ? "Выполнено только что" : "Ошибка обновлена только что";
  const result = await query<{ id: string }>(
    `UPDATE projects
     SET status = $2::project_status,
         finished_at = NOW(),
         updated_text = $4
     WHERE id = $1 AND status = $3::project_status
     RETURNING id`,
    [projectId, toStatus, fromStatus, updatedText],
  );
  if ((result.rowCount ?? 0) === 0) {
    return;
  }

  if (toStatus === "done") {
    await query(
      `INSERT INTO project_status_history (project_id, status, title, text)
       VALUES ($1, 'done', 'Выполнен', 'Сборка завершена успешно')`,
      [projectId],
    );
    return;
  }

  if (isNoRowsAfterFiltersError(pipelineErrorMessage)) {
    await refundNoRowsFailure(projectId);
    await query(
      `UPDATE projects
       SET error_message = $2,
           updated_text = 'Ошибка обновлена только что'
       WHERE id = $1`,
      [projectId, NO_ROWS_AFTER_FILTERS_USER_MESSAGE],
    );
    await query(
      `INSERT INTO project_status_history (project_id, status, title, text)
       VALUES ($1, 'error', 'Нет подходящих компаний', $2)`,
      [projectId, NO_ROWS_AFTER_FILTERS_USER_MESSAGE],
    );
    return;
  }

  if (isSystemPipelineFailure(pipelineErrorMessage)) {
    await refundSystemFailure(projectId);
    await query(
      `UPDATE projects
       SET error_message = $2,
           updated_text = 'Ошибка обновлена только что'
       WHERE id = $1`,
      [projectId, SYSTEM_FAILURE_USER_MESSAGE],
    );
    await query(
      `INSERT INTO project_status_history (project_id, status, title, text)
       VALUES ($1, 'error', 'Системная ошибка', $2)`,
      [projectId, SYSTEM_FAILURE_USER_MESSAGE],
    );
    return;
  }

  await query(
    `INSERT INTO project_status_history (project_id, status, title, text)
     VALUES ($1, 'error', 'Ошибка', 'Сборка завершилась с ошибкой')`,
    [projectId],
  );
}

async function fetchPipelineRuntimeFromBackend(
  jobId: string,
): Promise<Pick<ProjectRow, "pipeline_job_status" | "pipeline_job_progress" | "pipeline_job_metadata" | "pipeline_job_error"> | null> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const response = await fetch(`${backendBase}/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as BackendJobResponse;
    const status = typeof payload.status === "string" ? payload.status : null;
    const progress =
      typeof payload.progress === "number" && Number.isFinite(payload.progress)
        ? payload.progress
        : typeof payload.progress === "string" && payload.progress.trim() && Number.isFinite(Number(payload.progress))
          ? Number(payload.progress)
          : null;
    const metadata =
      typeof payload.metadata === "object" && payload.metadata ? (payload.metadata as Record<string, unknown>) : null;
    const errorMessage = typeof payload.error_message === "string" ? payload.error_message.trim() : "";

    return {
      pipeline_job_status: status,
      pipeline_job_progress: progress,
      pipeline_job_metadata: metadata,
      pipeline_job_error: errorMessage || null,
    };
  } catch {
    return null;
  }
}

function isPresignedMinioUrl(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  return /^https?:\/\//i.test(text) && (text.includes("AWSAccessKeyId=") || text.includes("Signature="));
}

async function fetchPipelineResultKeyFromBackend(jobId: string): Promise<string | null> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const response = await fetch(`${backendBase}/jobs/${jobId}/result`, {
      method: "GET",
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as BackendJobResultResponse;
    const resultKey = typeof payload.result_key === "string" ? payload.result_key.trim() : "";
    return resultKey || null;
  } catch {
    return null;
  }
}

async function cancelPipelineJobInBackend(jobId: string): Promise<boolean> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    const response = await fetch(`${backendBase}/jobs/${jobId}/cancel`, {
      method: "POST",
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as BackendCancelJobResponse;
    const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
    return status === "failed";
  } catch {
    return false;
  }
}

async function enrichProjectRowWithPipelineRuntime(row: ProjectRow): Promise<ProjectRow> {
  const jobId = row.pipeline_job_id;
  if (!jobId) {
    return row;
  }
  const runtime = await fetchPipelineRuntimeFromBackend(jobId);
  if (!runtime) {
    return row;
  }
  return { ...row, ...runtime };
}

type SystemSettingsRow = {
  default_project_price_rub: number;
  default_project_old_price_rub: number | null;
  project_price_promo_message: string | null;
};

type HistoryRow = {
  title: string;
  created_at: Date;
};

type ColumnRow = {
  column_name: string;
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toIsoString(date: Date | null | undefined) {
  if (!date) {
    return null;
  }

  return date.toISOString();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseUtcOffsetMinutes(offset: string) {
  const trimmed = offset.trim();
  const match = /^([+-])(0\d|1\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const totalMinutes = sign * (hours * 60 + minutes);

  if (totalMinutes < -12 * 60 || totalMinutes > 14 * 60) {
    return null;
  }

  return totalMinutes;
}

function parseLocalDateTimeWithOffset(localDateTime: string, offset: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const offsetMinutes = parseUtcOffsetMinutes(offset);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    offsetMinutes === null
  ) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000;
  const date = new Date(utcMs);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeByOffset(date: Date, offset: string) {
  const offsetMinutes = parseUtcOffsetMinutes(offset);
  if (offsetMinutes === null) {
    return formatDateTime(date);
  }

  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return `${pad2(shifted.getUTCDate())}.${pad2(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()}, ${pad2(
    shifted.getUTCHours(),
  )}:${pad2(shifted.getUTCMinutes())}`;
}

function formatDateTimeInTimeZone(date: Date, timeZone?: string | null) {
  if (!timeZone) {
    return formatDateTime(date);
  }

  return formatDateTimeByOffset(date, timeZone);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatRelative(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

async function getColumns(projectId: string) {
  const result = await query<ColumnRow>(
    `SELECT column_name
     FROM project_columns
     WHERE project_id = $1
     ORDER BY position ASC`,
    [projectId],
  );

  return result.rows.map((row) => row.column_name);
}

async function getHistory(projectId: string) {
  const result = await query<HistoryRow>(
    `SELECT title, created_at
     FROM project_status_history
     WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId],
  );

  return result.rows.map((row) => `${row.title} (${formatDate(row.created_at)})`);
}

async function getDefaultProjectPrice() {
  const result = await query<SystemSettingsRow>(
    `SELECT default_project_price_rub
     FROM system_settings
     WHERE id = 1
     LIMIT 1`,
  );

  return result.rows[0]?.default_project_price_rub ?? 1488;
}

export async function getGlobalSettings() {
  const result = await query<SystemSettingsRow>(
    `SELECT default_project_price_rub, default_project_old_price_rub, project_price_promo_message
     FROM system_settings
     WHERE id = 1
     LIMIT 1`,
  );

  const row = result.rows[0];
  return {
    defaultProjectPriceRub: row?.default_project_price_rub ?? 1488,
    defaultProjectOldPriceRub: row?.default_project_old_price_rub ?? null,
    projectPricePromoMessage:
      row?.default_project_old_price_rub && row.project_price_promo_message ? row.project_price_promo_message : null,
  };
}

export async function updateGlobalSettings(payload: {
  defaultProjectPriceRub: number;
  defaultProjectOldPriceRub?: number | null;
  projectPricePromoMessage?: string | null;
}) {
  const defaultProjectPriceRub = Math.max(0, Math.trunc(payload.defaultProjectPriceRub));
  const defaultProjectOldPriceRub =
    payload.defaultProjectOldPriceRub == null || payload.defaultProjectOldPriceRub === undefined || Number.isNaN(payload.defaultProjectOldPriceRub)
      ? null
      : Math.max(0, Math.trunc(payload.defaultProjectOldPriceRub));
  const projectPricePromoMessage =
    defaultProjectOldPriceRub != null && payload.projectPricePromoMessage?.trim()
      ? payload.projectPricePromoMessage.trim()
      : null;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO system_settings (id, default_project_price_rub, default_project_old_price_rub, project_price_promo_message)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id)
       DO UPDATE SET default_project_price_rub = EXCLUDED.default_project_price_rub,
                     default_project_old_price_rub = EXCLUDED.default_project_old_price_rub,
                     project_price_promo_message = EXCLUDED.project_price_promo_message`,
      [defaultProjectPriceRub, defaultProjectOldPriceRub, projectPricePromoMessage],
    );

    const newProjects = await client.query<{ id: string; column_count: number }>(
      `SELECT p.id,
              COALESCE((
                SELECT COUNT(*)
                FROM project_columns pc
                WHERE pc.project_id = p.id
              ), 0)::int AS column_count
       FROM projects p
       WHERE p.status = 'new'`,
    );
    for (const project of newProjects.rows) {
      const dynamicPriceRub = computeDraftProjectPriceRub(defaultProjectPriceRub, project.column_count);
      await client.query(
        `UPDATE projects
         SET project_price_rub = $2,
             updated_text = 'Цена обновлена из глобальных настроек'
         WHERE id = $1`,
        [project.id, dynamicPriceRub],
      );
    }
  });
}

export async function listProjectsByUser(userId: string, options?: { search?: string }): Promise<ProjectView[]> {
  const search = options?.search?.trim() ?? "";
  const whereClause = search ? "WHERE user_id = $1 AND LOWER(title) LIKE $2" : "WHERE user_id = $1";
  const params = search ? [userId, `%${search.toLowerCase()}%`] : [userId];

  const result = await query<ProjectRow>(
    `SELECT p.id,
            p.title,
            p.status,
            p.description,
            p.project_price_rub,
            p.result_file,
            p.updated_at,
            EXISTS (
              SELECT 1
              FROM user_consents uc
              WHERE uc.user_id = p.user_id
            ) AS has_owner_consent
     FROM projects
     p ${whereClause}
     ORDER BY p.updated_at DESC`,
    params,
  );

  const projects = await Promise.all(
    result.rows.map(async (row) => {
      const columns = await getColumns(row.id);
      const statusHistory = await getHistory(row.id);

      return {
        id: row.id,
        title: row.title,
        status: row.status,
        updatedText: formatRelative(row.updated_at),
        description: row.description,
        columns: columns.join(", "),
        projectPriceRub: row.project_price_rub,
        resultFile: row.result_file ?? undefined,
        hasOwnerConsent: row.has_owner_consent ?? false,
        statusHistory,
      } satisfies ProjectView;
    }),
  );

  return projects;
}

export async function getProjectByIdForUser(userId: string, projectId: string): Promise<ProjectView | null> {
  const result = await query<ProjectRow>(
    `SELECT p.id,
            p.title,
            p.status,
            p.description,
            p.project_price_rub,
            p.result_file,
            p.error_message,
            p.updated_at,
            ppj.pipeline_job_id::text AS pipeline_job_id,
            EXISTS (
              SELECT 1
              FROM user_consents uc
              WHERE uc.user_id = p.user_id
            ) AS has_owner_consent,
            p.price_reasoning_short,
            p.price_reasoning_details,
            p.pricing_last_prompt,
            p.pricing_last_prompt_hash,
            p.pricing_last_model,
            p.pricing_last_source,
            p.pricing_last_input_signature,
            p.pricing_resolved_okved_codes,
            p.pricing_resolved_output_fields,
            p.pricing_resolved_data_filters
     FROM projects p
     LEFT JOIN project_pipeline_jobs ppj ON ppj.project_id = p.id
     WHERE p.id = $1 AND p.user_id = $2
     LIMIT 1`,
    [projectId, userId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const [columns, statusHistory, settings, runtimeRow] = await Promise.all([
    getColumns(row.id),
    getHistory(row.id),
    getGlobalSettings(),
    enrichProjectRowWithPipelineRuntime(row),
  ]);
  const resolvedStatus = deriveProjectStatusFromPipeline(row.status, runtimeRow.pipeline_job_status ?? null);
  await syncProjectStatusFromPipeline(row.id, row.status, resolvedStatus, runtimeRow.pipeline_job_error ?? null);
  let resolvedProjectPriceRub = row.project_price_rub;
  let priceHint: string | null = null;
  let priceHintDetails: string[] = [];
  let pricePending = false;
  if (resolvedStatus === "new") {
    const intentText = (row.description ?? "").trim() || (row.title ?? "").trim();
    const responseFormat = columns.join(", ");
    const modelTier = detectModelTier();
    const inputSignature = buildPricingInputSignature({
      intent: intentText,
      responseFormat,
      basePriceRub: settings.defaultProjectPriceRub,
      modelTier,
    });

    const cachedResolution = getCachedPricingResolution(row);
    const canUseCachedResolution =
      Boolean(row.pricing_last_input_signature) &&
      row.pricing_last_input_signature === inputSignature &&
      Boolean(cachedResolution);
    const parsedCachedHintDetails = parsePriceHintDetails(row.price_reasoning_details);

    if (canUseCachedResolution && cachedResolution) {
      const cachedContext: DynamicPricingContext = {
        basePriceRub: settings.defaultProjectPriceRub,
        responseFormat,
        resolvedOutputFields: cachedResolution.resolvedOutputFields,
        resolvedDataFilters: cachedResolution.resolvedDataFilters,
        resolvedOkvedCodes: cachedResolution.resolvedOkvedCodes,
      };
      const cachedPriceRub = Math.max(0, Math.trunc(computeDynamicProjectPriceRub(cachedContext)));
      resolvedProjectPriceRub = cachedPriceRub;
      const fallbackHint = buildPriceHint(settings.defaultProjectPriceRub, cachedPriceRub, cachedContext);
      priceHint = (row.price_reasoning_short ?? "").trim() || fallbackHint.short;
      priceHintDetails = parsedCachedHintDetails.length ? parsedCachedHintDetails : fallbackHint.details;
      if (resolvedProjectPriceRub !== row.project_price_rub) {
        await query(
          `UPDATE projects
           SET project_price_rub = $2,
               updated_text = 'Цена обновлена автоматически'
           WHERE id = $1`,
          [row.id, resolvedProjectPriceRub],
        );
      }
      pricePending = false;
    } else {
      const previewResult = intentText ? await fetchIntentPreviewFromBackend(intentText, responseFormat) : { preview: null, status: 422, detail: null };
      if (previewResult.preview) {
        const preview = previewResult.preview;
        const priceContext: DynamicPricingContext = {
          basePriceRub: settings.defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: preview.resolved_output_fields ?? null,
          resolvedDataFilters: preview.resolved_data_filters ?? null,
          resolvedOkvedCodes: Array.isArray(preview.resolved_okved_codes) ? preview.resolved_okved_codes : [],
        };
        const estimate = await fetchPriceEstimateFromBackend({
          basePriceRub: settings.defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: priceContext.resolvedOutputFields ?? [],
          resolvedDataFilters: priceContext.resolvedDataFilters ?? [],
          resolvedOkvedCodes: priceContext.resolvedOkvedCodes,
          previousPriceRub: row.project_price_rub,
          previousPrompt: row.pricing_last_prompt,
          previousReasoningShort: row.price_reasoning_short,
          previousReasoningDetails: parsedCachedHintDetails,
        });
        if (estimate && typeof estimate.estimated_price_rub === "number") {
          resolvedProjectPriceRub = Math.max(0, Math.trunc(estimate.estimated_price_rub));
          priceHint = (estimate.pricing_reason_short ?? "").trim() || null;
          priceHintDetails = Array.isArray(estimate.pricing_reason_details)
            ? estimate.pricing_reason_details.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [];
          pricePending = false;
        } else {
          priceHint = buildPriceCalculationFailureMessage("price-estimate-failed");
          priceHintDetails = [];
          pricePending = true;
        }

        if (pricePending) {
          await query(
            `UPDATE projects
             SET price_reasoning_short = $2,
                 price_reasoning_details = '[]'::jsonb,
                 pricing_last_source = 'pricing_unavailable',
                 pricing_last_input_signature = NULL,
                 pricing_updated_at = NOW(),
                 updated_text = 'Требуется уточнение запроса для расчёта цены'
             WHERE id = $1`,
            [row.id, priceHint],
          );
        } else {
          await query(
            `UPDATE projects
             SET project_price_rub = $2,
                 price_reasoning_short = $3,
                 price_reasoning_details = $4::jsonb,
                 pricing_last_prompt = $5,
                 pricing_last_prompt_hash = $6,
                 pricing_last_model = $7,
                 pricing_last_source = $8,
                 pricing_last_input_signature = $9,
                 pricing_resolved_okved_codes = $10::jsonb,
                 pricing_resolved_output_fields = $11::jsonb,
                 pricing_resolved_data_filters = $12::jsonb,
                 pricing_updated_at = NOW(),
                 updated_text = 'Цена обновлена автоматически'
             WHERE id = $1`,
            [
              row.id,
              resolvedProjectPriceRub,
              priceHint,
              JSON.stringify(priceHintDetails),
              (estimate?.pricing_prompt ?? "").trim() || intentText,
              (estimate?.pricing_prompt_hash ?? "").trim() || createHash("sha256").update(intentText).digest("hex"),
              (estimate?.pricing_model ?? "").trim() || modelTier,
              (estimate?.pricing_source ?? "").trim() || "intent_preview",
              inputSignature,
              JSON.stringify(priceContext.resolvedOkvedCodes),
              JSON.stringify(priceContext.resolvedOutputFields ?? []),
              JSON.stringify(priceContext.resolvedDataFilters ?? []),
            ],
          );
        }
      } else {
        priceHint = buildPriceCalculationFailureMessage(previewResult.detail);
        priceHintDetails = [];
        pricePending = true;
        await query(
          `UPDATE projects
           SET price_reasoning_short = $2,
               price_reasoning_details = '[]'::jsonb,
               pricing_last_source = 'pricing_unavailable',
               pricing_last_input_signature = NULL,
               pricing_updated_at = NOW(),
               updated_text = 'Требуется уточнение запроса для расчёта цены'
           WHERE id = $1`,
          [row.id, priceHint],
        );
      }
    }
  }
  const currentResultFile = (row.result_file ?? "").trim();
  let resolvedResultFile = currentResultFile || null;
  const shouldRefreshResultFile =
    !currentResultFile || isPresignedMinioUrl(currentResultFile);
  if (shouldRefreshResultFile && runtimeRow.pipeline_job_id && String(runtimeRow.pipeline_job_status ?? "").toLowerCase() === "completed") {
    const safeResultKey = await fetchPipelineResultKeyFromBackend(runtimeRow.pipeline_job_id);
    if (safeResultKey) {
      resolvedResultFile = safeResultKey;
      await query(
        `UPDATE projects
         SET result_file = $2
         WHERE id = $1`,
        [row.id, safeResultKey],
      );
    } else if (isPresignedMinioUrl(currentResultFile)) {
      resolvedResultFile = null;
      await query(
        `UPDATE projects
         SET result_file = NULL
         WHERE id = $1`,
        [row.id],
      );
    }
  }
  const pipelineRuntime = mapPipelineRuntime(runtimeRow);

  return {
    id: row.id,
    title: row.title,
    status: resolvedStatus,
    updatedText: formatRelative(row.updated_at),
    description: row.description,
    columns: columns.join(", "),
    projectPriceRub: resolvedProjectPriceRub,
    pricePending,
    oldProjectPriceRub: row.status === "new" ? settings.defaultProjectOldPriceRub : null,
    pricePromoMessage: row.status === "new" ? settings.projectPricePromoMessage : null,
    priceHint,
    priceHintDetails,
    resultFile: resolvedResultFile ?? undefined,
    hasOwnerConsent: row.has_owner_consent ?? false,
    statusHistory,
    ...pipelineRuntime,
  };
}

export async function getProjectByIdForAdmin(projectId: string): Promise<ProjectView | null> {
  const result = await query<ProjectRow>(
    `SELECT p.id,
            p.user_id,
            p.title,
            p.status,
            p.description,
            p.project_price_rub,
            p.result_file,
            p.error_message,
            p.updated_at,
            ppj.pipeline_job_id::text AS pipeline_job_id,
            u.full_name AS owner_name,
            u.email AS owner_email,
            EXISTS (
              SELECT 1
              FROM user_consents uc
              WHERE uc.user_id = p.user_id
            ) AS has_owner_consent,
            p.price_reasoning_short,
            p.price_reasoning_details,
            p.pricing_last_prompt,
            p.pricing_last_prompt_hash,
            p.pricing_last_model,
            p.pricing_last_source,
            p.pricing_last_input_signature,
            p.pricing_resolved_okved_codes,
            p.pricing_resolved_output_fields,
            p.pricing_resolved_data_filters
     FROM projects p
     LEFT JOIN project_pipeline_jobs ppj ON ppj.project_id = p.id
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1
     LIMIT 1`,
    [projectId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const [columns, statusHistory, settings, runtimeRow] = await Promise.all([
    getColumns(row.id),
    getHistory(row.id),
    getGlobalSettings(),
    enrichProjectRowWithPipelineRuntime(row),
  ]);
  const resolvedStatus = deriveProjectStatusFromPipeline(row.status, runtimeRow.pipeline_job_status ?? null);
  await syncProjectStatusFromPipeline(row.id, row.status, resolvedStatus, runtimeRow.pipeline_job_error ?? null);
  let resolvedProjectPriceRub = row.project_price_rub;
  let priceHint: string | null = null;
  let priceHintDetails: string[] = [];
  let pricePending = false;
  if (resolvedStatus === "new") {
    const intentText = (row.description ?? "").trim() || (row.title ?? "").trim();
    const responseFormat = columns.join(", ");
    const modelTier = detectModelTier();
    const inputSignature = buildPricingInputSignature({
      intent: intentText,
      responseFormat,
      basePriceRub: settings.defaultProjectPriceRub,
      modelTier,
    });

    const cachedResolution = getCachedPricingResolution(row);
    const canUseCachedResolution =
      Boolean(row.pricing_last_input_signature) &&
      row.pricing_last_input_signature === inputSignature &&
      Boolean(cachedResolution);
    const parsedCachedHintDetails = parsePriceHintDetails(row.price_reasoning_details);

    if (canUseCachedResolution && cachedResolution) {
      const cachedContext: DynamicPricingContext = {
        basePriceRub: settings.defaultProjectPriceRub,
        responseFormat,
        resolvedOutputFields: cachedResolution.resolvedOutputFields,
        resolvedDataFilters: cachedResolution.resolvedDataFilters,
        resolvedOkvedCodes: cachedResolution.resolvedOkvedCodes,
      };
      const cachedPriceRub = Math.max(0, Math.trunc(computeDynamicProjectPriceRub(cachedContext)));
      resolvedProjectPriceRub = cachedPriceRub;
      const fallbackHint = buildPriceHint(settings.defaultProjectPriceRub, cachedPriceRub, cachedContext);
      priceHint = (row.price_reasoning_short ?? "").trim() || fallbackHint.short;
      priceHintDetails = parsedCachedHintDetails.length ? parsedCachedHintDetails : fallbackHint.details;
      if (resolvedProjectPriceRub !== row.project_price_rub) {
        await query(
          `UPDATE projects
           SET project_price_rub = $2,
               updated_text = 'Цена обновлена автоматически'
           WHERE id = $1`,
          [row.id, resolvedProjectPriceRub],
        );
      }
      pricePending = false;
    } else {
      const previewResult = intentText ? await fetchIntentPreviewFromBackend(intentText, responseFormat) : { preview: null, status: 422, detail: null };
      if (previewResult.preview) {
        const preview = previewResult.preview;
        const priceContext: DynamicPricingContext = {
          basePriceRub: settings.defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: preview.resolved_output_fields ?? null,
          resolvedDataFilters: preview.resolved_data_filters ?? null,
          resolvedOkvedCodes: Array.isArray(preview.resolved_okved_codes) ? preview.resolved_okved_codes : [],
        };
        const estimate = await fetchPriceEstimateFromBackend({
          basePriceRub: settings.defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: priceContext.resolvedOutputFields ?? [],
          resolvedDataFilters: priceContext.resolvedDataFilters ?? [],
          resolvedOkvedCodes: priceContext.resolvedOkvedCodes,
          previousPriceRub: row.project_price_rub,
          previousPrompt: row.pricing_last_prompt,
          previousReasoningShort: row.price_reasoning_short,
          previousReasoningDetails: parsedCachedHintDetails,
        });
        if (estimate && typeof estimate.estimated_price_rub === "number") {
          resolvedProjectPriceRub = Math.max(0, Math.trunc(estimate.estimated_price_rub));
          priceHint = (estimate.pricing_reason_short ?? "").trim() || null;
          priceHintDetails = Array.isArray(estimate.pricing_reason_details)
            ? estimate.pricing_reason_details.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [];
          pricePending = false;
        } else {
          priceHint = buildPriceCalculationFailureMessage("price-estimate-failed");
          priceHintDetails = [];
          pricePending = true;
        }

        if (pricePending) {
          await query(
            `UPDATE projects
             SET price_reasoning_short = $2,
                 price_reasoning_details = '[]'::jsonb,
                 pricing_last_source = 'pricing_unavailable',
                 pricing_last_input_signature = NULL,
                 pricing_updated_at = NOW(),
                 updated_text = 'Требуется уточнение запроса для расчёта цены'
             WHERE id = $1`,
            [row.id, priceHint],
          );
        } else {
          await query(
            `UPDATE projects
             SET project_price_rub = $2,
                 price_reasoning_short = $3,
                 price_reasoning_details = $4::jsonb,
                 pricing_last_prompt = $5,
                 pricing_last_prompt_hash = $6,
                 pricing_last_model = $7,
                 pricing_last_source = $8,
                 pricing_last_input_signature = $9,
                 pricing_resolved_okved_codes = $10::jsonb,
                 pricing_resolved_output_fields = $11::jsonb,
                 pricing_resolved_data_filters = $12::jsonb,
                 pricing_updated_at = NOW(),
                 updated_text = 'Цена обновлена автоматически'
             WHERE id = $1`,
            [
              row.id,
              resolvedProjectPriceRub,
              priceHint,
              JSON.stringify(priceHintDetails),
              (estimate?.pricing_prompt ?? "").trim() || intentText,
              (estimate?.pricing_prompt_hash ?? "").trim() || createHash("sha256").update(intentText).digest("hex"),
              (estimate?.pricing_model ?? "").trim() || modelTier,
              (estimate?.pricing_source ?? "").trim() || "intent_preview",
              inputSignature,
              JSON.stringify(priceContext.resolvedOkvedCodes),
              JSON.stringify(priceContext.resolvedOutputFields ?? []),
              JSON.stringify(priceContext.resolvedDataFilters ?? []),
            ],
          );
        }
      } else {
        priceHint = buildPriceCalculationFailureMessage(previewResult.detail);
        priceHintDetails = [];
        pricePending = true;
        await query(
          `UPDATE projects
           SET price_reasoning_short = $2,
               price_reasoning_details = '[]'::jsonb,
               pricing_last_source = 'pricing_unavailable',
               pricing_last_input_signature = NULL,
               pricing_updated_at = NOW(),
               updated_text = 'Требуется уточнение запроса для расчёта цены'
           WHERE id = $1`,
          [row.id, priceHint],
        );
      }
    }
  }
  const currentResultFile = (row.result_file ?? "").trim();
  let resolvedResultFile = currentResultFile || null;
  const shouldRefreshResultFile =
    !currentResultFile || isPresignedMinioUrl(currentResultFile);
  if (shouldRefreshResultFile && runtimeRow.pipeline_job_id && String(runtimeRow.pipeline_job_status ?? "").toLowerCase() === "completed") {
    const safeResultKey = await fetchPipelineResultKeyFromBackend(runtimeRow.pipeline_job_id);
    if (safeResultKey) {
      resolvedResultFile = safeResultKey;
      await query(
        `UPDATE projects
         SET result_file = $2
         WHERE id = $1`,
        [row.id, safeResultKey],
      );
    } else if (isPresignedMinioUrl(currentResultFile)) {
      resolvedResultFile = null;
      await query(
        `UPDATE projects
         SET result_file = NULL
         WHERE id = $1`,
        [row.id],
      );
    }
  }
  const pipelineRuntime = mapPipelineRuntime(runtimeRow);

  return {
    id: row.id,
    title: row.title,
    status: resolvedStatus,
    updatedText: formatRelative(row.updated_at),
    description: row.description,
    columns: columns.join(", "),
    projectPriceRub: resolvedProjectPriceRub,
    pricePending,
    oldProjectPriceRub: row.status === "new" ? settings.defaultProjectOldPriceRub : null,
    pricePromoMessage: row.status === "new" ? settings.projectPricePromoMessage : null,
    priceHint,
    priceHintDetails,
    resultFile: resolvedResultFile ?? undefined,
    errorMessage: row.error_message ?? null,
    hasOwnerConsent: row.has_owner_consent ?? false,
    statusHistory,
    ownerId: row.user_id,
    ownerName: row.owner_name ?? "Пользователь",
    ownerEmail: row.owner_email,
    ...pipelineRuntime,
  };
}

type BackendDebugLogRow = {
  id: number;
  level: string;
  service: string;
  message: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

export async function getProjectDebugLogsForAdmin(
  projectId: string,
  options?: { sinceId?: number; limit?: number },
): Promise<{ jobId: string | null; logs: ProjectDebugLogView[]; lastId: number | null; storageHint?: Record<string, unknown> }> {
  const projectRes = await query<{ pipeline_job_id: string | null }>(
    `SELECT pipeline_job_id::text AS pipeline_job_id
     FROM project_pipeline_jobs
     WHERE project_id = $1
     LIMIT 1`,
    [projectId],
  );
  const jobId = projectRes.rows[0]?.pipeline_job_id ?? null;
  if (!jobId) {
    return { jobId: null, logs: [], lastId: options?.sinceId ?? null };
  }

  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (options?.sinceId) {
    params.set("since_id", String(options.sinceId));
  }
  params.set("limit", String(Math.max(1, Math.min(1000, options?.limit ?? 250))));

  const response = await fetch(`${backendBase}/jobs/${jobId}/debug-logs?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!response.ok) {
    return { jobId, logs: [], lastId: options?.sinceId ?? null };
  }

  const payload = (await response.json()) as {
    logs?: BackendDebugLogRow[];
    last_id?: number | null;
    storage_hint?: Record<string, unknown>;
  };
  const logs = (payload.logs ?? []).map((row) => ({
    id: row.id,
    level: row.level,
    service: row.service,
    message: row.message,
    createdAt: row.created_at,
    payload: row.payload ?? {},
  }));
  return {
    jobId,
    logs,
    lastId: payload.last_id ?? (logs.length > 0 ? logs[logs.length - 1].id : options?.sinceId ?? null),
    storageHint: payload.storage_hint,
  };
}

export async function createDraftProject(userId: string) {
  const defaultProjectPriceRub = await getDefaultProjectPrice();
  const defaultColumns = ["Название компании", "Телефон", "Email", "Сайт"];
  const initialProjectPriceRub = computeDraftProjectPriceRub(defaultProjectPriceRub, defaultColumns.length);

  const created = await query<{ id: string }>(
    `INSERT INTO projects (user_id, title, description, status, project_price_rub)
     VALUES ($1, 'Новый проект', 'Опишите, какие организации нужно найти и в каком регионе.', 'new', $2)
     RETURNING id`,
    [userId, initialProjectPriceRub],
  );

  const projectId = created.rows[0].id;

  for (let index = 0; index < defaultColumns.length; index += 1) {
    await query(
      `INSERT INTO project_columns (project_id, position, column_name)
       VALUES ($1, $2, $3)`,
      [projectId, index + 1, defaultColumns[index]],
    );
  }

  await query(
    `INSERT INTO project_status_history (project_id, status, title, text)
     VALUES ($1, 'new', 'Создан', 'Проект создан в системе')`,
    [projectId],
  );

  return projectId;
}

export async function duplicateProject(
  viewer: Viewer,
  projectId: string,
  targetUserId?: string,
) {
  const sourceProjectResult = viewer.role === "admin"
    ? await query<{
        id: string;
        user_id: string;
        title: string;
        description: string;
      }>(
        `SELECT id, user_id, title, description
         FROM projects
         WHERE id = $1
         LIMIT 1`,
        [projectId],
      )
    : await query<{
        id: string;
        user_id: string;
        title: string;
        description: string;
      }>(
        `SELECT id, user_id, title, description
         FROM projects
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [projectId, viewer.id],
      );

  const sourceProject = sourceProjectResult.rows[0];
  if (!sourceProject) {
    return { ok: false as const, error: "Проект не найден" };
  }

  const ownerId = viewer.role === "admin" ? targetUserId ?? sourceProject.user_id : viewer.id;
  if (!ownerId) {
    return { ok: false as const, error: "Не удалось определить владельца нового проекта" };
  }

  try {
    const defaultProjectPriceRub = await getDefaultProjectPrice();

    const newProjectId = await withTransaction(async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO projects (user_id, title, description, status, updated_text, source_query_text, project_price_rub)
         VALUES ($1, $2, $3, 'new', 'Обновлено только что', $3, $4)
         RETURNING id`,
        [ownerId, `${sourceProject.title} (копия)`, sourceProject.description, defaultProjectPriceRub],
      );

      const duplicatedProjectId = created.rows[0].id;

      const columnsResult = await client.query<ColumnRow>(
        `SELECT column_name
         FROM project_columns
         WHERE project_id = $1
         ORDER BY position ASC`,
        [projectId],
      );

      for (let index = 0; index < columnsResult.rows.length; index += 1) {
        await client.query(
          `INSERT INTO project_columns (project_id, position, column_name)
           VALUES ($1, $2, $3)`,
          [duplicatedProjectId, index + 1, columnsResult.rows[index].column_name],
        );
      }

      const duplicatedProjectPriceRub = computeDraftProjectPriceRub(
        defaultProjectPriceRub,
        columnsResult.rows.length,
      );
      await client.query(
        `UPDATE projects
         SET project_price_rub = $2
         WHERE id = $1`,
        [duplicatedProjectId, duplicatedProjectPriceRub],
      );

      await client.query(
        `INSERT INTO project_status_history (project_id, status, title, text)
         VALUES ($1, 'new', 'Создан', 'Проект создан как дубликат')`,
        [duplicatedProjectId],
      );

      return duplicatedProjectId;
    });

    return { ok: true as const, newProjectId, ownerId };
  } catch {
    return { ok: false as const, error: "Не удалось дублировать проект" };
  }
}

export async function adminCreateProjectForUser(adminViewer: Viewer, targetUserId: string) {
  const userResult = await query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 LIMIT 1`,
    [targetUserId],
  );

  if (!userResult.rows[0]) {
    return { ok: false as const, error: "Пользователь не найден" };
  }

  const newProjectId = await createDraftProject(targetUserId);

  await query(
    `INSERT INTO project_status_history (project_id, status, title, text)
     VALUES ($1, 'new', 'Создан администратором', $2)`,
    [newProjectId, `Проект создан администратором ${adminViewer.fullName}`],
  );

  return { ok: true as const, newProjectId };
}

export async function updateProjectDraft(
  userId: string | null,
  projectId: string,
  payload: { title: string; description: string; columns: string },
  options?: { recalculatePrice?: boolean; editedAtMs?: number },
) {
  const owner = userId
    ? await query<{
        id: string;
        status: ProjectStatus;
        project_price_rub: number;
        price_reasoning_short: string | null;
        price_reasoning_details: unknown;
        pricing_last_prompt: string | null;
        pricing_last_prompt_hash: string | null;
        pricing_last_model: string | null;
        pricing_last_source: string | null;
        pricing_last_input_signature: string | null;
        pricing_resolved_okved_codes: unknown;
        pricing_resolved_output_fields: unknown;
        pricing_resolved_data_filters: unknown;
        pricing_updated_at: Date | null;
      }>(
        `SELECT id,
                status,
                project_price_rub,
                price_reasoning_short,
                price_reasoning_details,
                pricing_last_prompt,
                pricing_last_prompt_hash,
                pricing_last_model,
                pricing_last_source,
                pricing_last_input_signature,
                pricing_resolved_okved_codes,
                pricing_resolved_output_fields,
                pricing_resolved_data_filters,
                pricing_updated_at
         FROM projects
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [projectId, userId],
      )
    : await query<{
        id: string;
        status: ProjectStatus;
        project_price_rub: number;
        price_reasoning_short: string | null;
        price_reasoning_details: unknown;
        pricing_last_prompt: string | null;
        pricing_last_prompt_hash: string | null;
        pricing_last_model: string | null;
        pricing_last_source: string | null;
        pricing_last_input_signature: string | null;
        pricing_resolved_okved_codes: unknown;
        pricing_resolved_output_fields: unknown;
        pricing_resolved_data_filters: unknown;
        pricing_updated_at: Date | null;
      }>(
        `SELECT id,
                status,
                project_price_rub,
                price_reasoning_short,
                price_reasoning_details,
                pricing_last_prompt,
                pricing_last_prompt_hash,
                pricing_last_model,
                pricing_last_source,
                pricing_last_input_signature,
                pricing_resolved_okved_codes,
                pricing_resolved_output_fields,
                pricing_resolved_data_filters,
                pricing_updated_at
         FROM projects
         WHERE id = $1
         LIMIT 1`,
        [projectId],
      );

  const row = owner.rows[0];
  if (!row || row.status !== "new") {
    return false;
  }

  const defaultProjectPriceRub = await getDefaultProjectPrice();
  const columns = payload.columns
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
  const shouldRecalculatePrice = options?.recalculatePrice ?? true;
  const normalizedTitle = payload.title.trim();
  const normalizedDescription = payload.description.trim();
  const responseFormat = columns.join(", ");
  const intentText = normalizedDescription || normalizedTitle;
  const modelTier = detectModelTier();
  const pricingInputSignature = buildPricingInputSignature({
    intent: intentText,
    responseFormat,
    basePriceRub: defaultProjectPriceRub,
    modelTier,
  });

  let dynamicProjectPriceRub = row.project_price_rub;
  let pricingReasoningShort: string | null = row.price_reasoning_short;
  let pricingReasoningDetails: string[] = parsePriceHintDetails(row.price_reasoning_details);
  let pricingLastPrompt: string | null = row.pricing_last_prompt;
  let pricingLastPromptHash: string | null = row.pricing_last_prompt_hash;
  let pricingLastModel: string | null = row.pricing_last_model;
  let pricingLastSource: string | null = row.pricing_last_source;
  let pricingLastInputSignature: string | null = row.pricing_last_input_signature;
  let pricingResolvedOkvedCodes: string[] = parseStringArrayJson(row.pricing_resolved_okved_codes);
  let pricingResolvedOutputFields: Array<{ key?: string; label?: string }> = parseResolvedOutputFieldsJson(
    row.pricing_resolved_output_fields,
  );
  let pricingResolvedDataFilters: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }> =
    parseResolvedDataFiltersJson(row.pricing_resolved_data_filters);
  let pricingUpdatedAtValue: Date | null = row.pricing_updated_at ?? null;

  if (shouldRecalculatePrice) {
    if (!intentText) {
      pricingReasoningShort = buildPriceCalculationFailureMessage(null);
      pricingReasoningDetails = [];
      pricingLastSource = "pricing_unavailable";
      pricingLastInputSignature = null;
      pricingLastModel = modelTier;
      pricingUpdatedAtValue = new Date();
      pricingResolvedOutputFields = [];
      pricingResolvedDataFilters = [];
      pricingResolvedOkvedCodes = [];
    } else {
      const previewResult = await fetchIntentPreviewFromBackend(intentText, responseFormat);
      if (previewResult.preview) {
        const preview = previewResult.preview;
        const context: DynamicPricingContext = {
          basePriceRub: defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: preview.resolved_output_fields ?? null,
          resolvedDataFilters: preview.resolved_data_filters ?? null,
          resolvedOkvedCodes: Array.isArray(preview.resolved_okved_codes) ? preview.resolved_okved_codes : [],
        };
        const estimate = await fetchPriceEstimateFromBackend({
          basePriceRub: defaultProjectPriceRub,
          responseFormat,
          resolvedOutputFields: context.resolvedOutputFields ?? [],
          resolvedDataFilters: context.resolvedDataFilters ?? [],
          resolvedOkvedCodes: context.resolvedOkvedCodes,
          previousPriceRub: row.project_price_rub,
          previousPrompt: row.pricing_last_prompt,
          previousReasoningShort: row.price_reasoning_short,
          previousReasoningDetails: parsePriceHintDetails(row.price_reasoning_details),
        });
        if (estimate && typeof estimate.estimated_price_rub === "number") {
          dynamicProjectPriceRub = Math.max(0, Math.trunc(estimate.estimated_price_rub));
          pricingReasoningShort = (estimate.pricing_reason_short ?? "").trim() || null;
          pricingReasoningDetails = Array.isArray(estimate.pricing_reason_details)
            ? estimate.pricing_reason_details.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [];
          pricingLastPrompt = (estimate.pricing_prompt ?? "").trim() || intentText;
          pricingLastPromptHash = (estimate.pricing_prompt_hash ?? "").trim() || createHash("sha256").update(intentText).digest("hex");
          pricingLastModel = (estimate.pricing_model ?? "").trim() || modelTier;
          pricingLastSource = (estimate.pricing_source ?? "").trim() || "draft_preview";
        } else {
          pricingReasoningShort = buildPriceCalculationFailureMessage("price-estimate-failed");
          pricingReasoningDetails = [];
          pricingLastPrompt = intentText;
          pricingLastPromptHash = createHash("sha256").update(intentText).digest("hex");
          pricingLastModel = modelTier;
          pricingLastSource = "pricing_unavailable";
          pricingLastInputSignature = null;
        }
        if (estimate && typeof estimate.estimated_price_rub === "number") {
          pricingLastInputSignature = pricingInputSignature;
        }
        pricingResolvedOkvedCodes = context.resolvedOkvedCodes;
        pricingResolvedOutputFields = context.resolvedOutputFields ?? [];
        pricingResolvedDataFilters = context.resolvedDataFilters ?? [];
        pricingUpdatedAtValue = new Date();
      } else {
        pricingReasoningShort = buildPriceCalculationFailureMessage(previewResult.detail);
        pricingReasoningDetails = [];
        pricingLastInputSignature = null;
        pricingLastModel = modelTier;
        pricingLastSource = "pricing_unavailable";
        pricingResolvedOutputFields = [];
        pricingResolvedDataFilters = [];
        pricingResolvedOkvedCodes = [];
        pricingUpdatedAtValue = new Date();
      }
    }
  }

  await query(
    `UPDATE projects
     SET title = $1,
         description = $2,
         source_query_text = $2,
         project_price_rub = $4,
         price_reasoning_short = $5,
         price_reasoning_details = $6::jsonb,
         pricing_last_prompt = $7,
         pricing_last_prompt_hash = $8,
         pricing_last_model = $9,
         pricing_last_source = $10,
         pricing_last_input_signature = $11,
         pricing_resolved_okved_codes = $12::jsonb,
         pricing_resolved_output_fields = $13::jsonb,
         pricing_resolved_data_filters = $14::jsonb,
         pricing_updated_at = $15,
         updated_text = 'Обновлено только что'
     WHERE id = $3`,
    [
      normalizedTitle,
      normalizedDescription,
      projectId,
      dynamicProjectPriceRub,
      pricingReasoningShort,
      JSON.stringify(pricingReasoningDetails),
      pricingLastPrompt,
      pricingLastPromptHash,
      pricingLastModel,
      pricingLastSource,
      pricingLastInputSignature,
      JSON.stringify(pricingResolvedOkvedCodes),
      JSON.stringify(pricingResolvedOutputFields),
      JSON.stringify(pricingResolvedDataFilters),
      pricingUpdatedAtValue,
    ],
  );

  await query("DELETE FROM project_columns WHERE project_id = $1", [projectId]);
  for (let index = 0; index < columns.length; index += 1) {
    await query(
      `INSERT INTO project_columns (project_id, position, column_name)
       VALUES ($1, $2, $3)`,
      [projectId, index + 1, columns[index]],
    );
  }

  return {
    ok: true as const,
    pricing: {
      projectPriceRub: dynamicProjectPriceRub,
      priceHint: pricingReasoningShort,
      priceHintDetails: pricingReasoningDetails,
      pricePending: pricingLastInputSignature !== pricingInputSignature,
    } satisfies DraftPricingState,
  };
}

export async function startProject(userId: string | null, projectId: string, options?: { chargeMode?: "paid" | "free" }) {
  const chargeMode = options?.chargeMode ?? "paid";
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const defaultProjectPriceRub = await getDefaultProjectPrice();
  const modelTier = detectModelTier();
  const result = userId
    ? await query<{
        user_id: string;
        status: ProjectStatus;
        project_price_rub: number;
        title: string;
        description: string;
        response_format: string;
        has_owner_consent: boolean;
        pricing_last_input_signature: string | null;
      price_reasoning_short: string | null;
      pricing_resolved_okved_codes: unknown;
      pricing_resolved_output_fields: unknown;
      pricing_resolved_data_filters: unknown;
      }>(
        `SELECT p.user_id,
                p.status,
                p.project_price_rub,
                p.title,
                p.description,
                COALESCE(
                  (
                    SELECT string_agg(pc.column_name, ', ' ORDER BY pc.position)
                    FROM project_columns pc
                    WHERE pc.project_id = p.id
                  ),
                  ''
                ) AS response_format,
                EXISTS (
                  SELECT 1
                  FROM user_consents uc
                  WHERE uc.user_id = p.user_id
                ) AS has_owner_consent,
                  p.pricing_last_input_signature,
                p.price_reasoning_short,
                p.pricing_resolved_okved_codes,
                p.pricing_resolved_output_fields,
                p.pricing_resolved_data_filters
         FROM projects p
         WHERE p.id = $1 AND p.user_id = $2
         LIMIT 1`,
        [projectId, userId],
      )
    : await query<{
        user_id: string;
        status: ProjectStatus;
        project_price_rub: number;
        title: string;
        description: string;
        response_format: string;
        has_owner_consent: boolean;
      pricing_last_input_signature: string | null;
      price_reasoning_short: string | null;
      pricing_resolved_okved_codes: unknown;
      pricing_resolved_output_fields: unknown;
      pricing_resolved_data_filters: unknown;
      }>(
        `SELECT p.user_id,
                p.status,
                p.project_price_rub,
                p.title,
                p.description,
                COALESCE(
                  (
                    SELECT string_agg(pc.column_name, ', ' ORDER BY pc.position)
                    FROM project_columns pc
                    WHERE pc.project_id = p.id
                  ),
                  ''
                ) AS response_format,
                EXISTS (
                  SELECT 1
                  FROM user_consents uc
                  WHERE uc.user_id = p.user_id
                ) AS has_owner_consent,
                  p.pricing_last_input_signature,
                p.price_reasoning_short,
                p.pricing_resolved_okved_codes,
                p.pricing_resolved_output_fields,
                p.pricing_resolved_data_filters
         FROM projects p
         WHERE p.id = $1
         LIMIT 1`,
        [projectId],
      );

  const project = result.rows[0];
  if (!project || project.status !== "new") {
    return { ok: false as const, error: "Проект нельзя запустить" };
  }

  const intentText = (project.description ?? "").trim() || (project.title ?? "").trim();
  const currentPricingInputSignature = buildPricingInputSignature({
    intent: intentText,
    responseFormat: project.response_format,
    basePriceRub: defaultProjectPriceRub,
    modelTier,
  });

  if (project.pricing_last_input_signature !== currentPricingInputSignature) {
    const pendingReason = String(project.price_reasoning_short ?? "").trim();
    return {
      ok: false as const,
      error: pendingReason || "Стоимость проекта ещё рассчитывается. Дождитесь обновления цены перед запуском.",
    };
  }

  if (!project.has_owner_consent) {
    return {
      ok: false as const,
      error: "Нельзя запустить проект без согласия с политикой конфиденциальности и офертой.",
    };
  }

  let pipelineJobId = "";
  let launchWarning = "";
  try {
    const cachedResolvedOkvedCodes = parseStringArrayJson(project.pricing_resolved_okved_codes);
    const cachedResolvedOutputFields = parseResolvedOutputFieldsJson(project.pricing_resolved_output_fields);
    const cachedResolvedDataFilters = parseResolvedDataFiltersJson(project.pricing_resolved_data_filters);
    const hasCachedResolution =
      cachedResolvedOkvedCodes.length > 0 ||
      cachedResolvedOutputFields.length > 0 ||
      cachedResolvedDataFilters.length > 0;
    const response = await fetch(`${backendBase}/jobs/from-intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: intentText,
        response_format: project.response_format,
        max_okved_codes: 30,
        max_output_fields: 30,
        use_cached_resolution: hasCachedResolution,
        resolved_okved_codes: cachedResolvedOkvedCodes,
        resolved_output_fields: cachedResolvedOutputFields,
        resolved_data_filters: cachedResolvedDataFilters,
      }),
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      let backendDetail = "";
      try {
        const errorPayload = (await response.json()) as { detail?: string };
        backendDetail = String(errorPayload.detail ?? "").trim();
      } catch {
        backendDetail = "";
      }

      if (backendDetail.includes("Unable to resolve OKVED")) {
        return {
          ok: false as const,
          error: "Не удалось определить ОКВЭД по описанию проекта. Уточните нишу проекта или добавьте явные коды ОКВЭД.",
        };
      }

      if (backendDetail.includes("No OKVED codes are configured")) {
        return {
          ok: false as const,
          error: "На сервере не настроены коды ОКВЭД для запуска проекта.",
        };
      }

      return {
        ok: false as const,
        error: backendDetail || "Сервис запуска временно недоступен. Попробуйте снова через минуту.",
      };
    }

    const payload = (await response.json()) as {
      job_id?: string;
      warning?: string;
      resolved_okved_codes?: string[];
      resolved_output_fields?: Array<{ key?: string; label?: string }>;
      resolved_data_filters?: Array<{ column?: string; operator?: string; value?: unknown; value_type?: string }>;
    };
    if (!payload.job_id) {
      return { ok: false as const, error: "Не удалось подтвердить запуск проекта. Попробуйте ещё раз." };
    }
    pipelineJobId = payload.job_id;
    launchWarning = String(payload.warning ?? "").trim();

    const resolvedContext: DynamicPricingContext = {
      basePriceRub: project.project_price_rub,
      responseFormat: project.response_format,
      resolvedOutputFields: payload.resolved_output_fields ?? null,
      resolvedDataFilters: payload.resolved_data_filters ?? null,
      resolvedOkvedCodes: Array.isArray(payload.resolved_okved_codes) ? payload.resolved_okved_codes : [],
    };
    await query(
      `UPDATE projects
       SET pricing_last_source = 'launch_resolve',
           pricing_resolved_okved_codes = $2::jsonb,
           pricing_resolved_output_fields = $3::jsonb,
           pricing_resolved_data_filters = $4::jsonb,
           pricing_updated_at = NOW()
       WHERE id = $1`,
      [
        projectId,
        JSON.stringify(resolvedContext.resolvedOkvedCodes),
        JSON.stringify(resolvedContext.resolvedOutputFields ?? []),
        JSON.stringify(resolvedContext.resolvedDataFilters ?? []),
      ],
    );
  } catch {
    return { ok: false as const, error: "Сервис запуска сейчас недоступен. Повторите попытку позже." };
  }

  try {
    await withTransaction(async (client) => {
      if (chargeMode === "paid" && project.project_price_rub > 0) {
        const debitResult = await client.query(
          `UPDATE users
           SET balance_rub = balance_rub - $1
           WHERE id = $2 AND balance_rub >= $1
           RETURNING id`,
          [project.project_price_rub, project.user_id],
        );

        if ((debitResult.rowCount ?? 0) === 0) {
          throw new Error("Недостаточно средств на балансе пользователя");
        }

        await client.query(
          `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
           VALUES ($1, 'Списание', $2, $3)`,
          [project.user_id, project.project_price_rub, `Запуск проекта ${project.title}`],
        );
      }

      await client.query(
        `UPDATE projects
         SET status = 'working',
             project_price_rub = $2,
             started_at = NOW(),
             updated_text = 'Обновлено только что'
         WHERE id = $1`,
        [projectId, project.project_price_rub],
      );

      await client.query(
        `INSERT INTO project_status_history (project_id, status, title, text)
         VALUES ($1, 'working', 'В работе', $2)`,
        [
          projectId,
          chargeMode === "paid"
            ? 'Алгоритм приступил к сбору данных. Списана стоимость проекта.'
            : 'Алгоритм приступил к сбору данных бесплатно.',
        ],
      );

      await client.query(
        `INSERT INTO project_pipeline_jobs (project_id, pipeline_job_id, source)
         VALUES ($1, $2::uuid, 'veles-scan-back')
         ON CONFLICT (project_id)
         DO UPDATE SET pipeline_job_id = EXCLUDED.pipeline_job_id,
                       source = EXCLUDED.source,
                       created_at = NOW()`,
        [projectId, pipelineJobId],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message) {
      return { ok: false as const, error: error.message };
    }

    return { ok: false as const, error: "Проект нельзя запустить" };
  }

  return { ok: true as const, warning: launchWarning || undefined };
}

export async function deleteProject(userId: string | null, projectId: string) {
  const result = userId
    ? await query(
        `DELETE FROM projects WHERE id = $1 AND user_id = $2 AND status <> 'working'`,
        [projectId, userId],
      )
    : await query(
        `DELETE FROM projects WHERE id = $1 AND status <> 'working'`,
        [projectId],
      );

  return (result.rowCount ?? 0) > 0;
}

export async function stopProject(userId: string | null, projectId: string) {
  const result = userId
    ? await query<{ status: ProjectStatus; pipeline_job_id: string | null }>(
        `SELECT p.status,
                ppj.pipeline_job_id::text AS pipeline_job_id
         FROM projects p
         LEFT JOIN project_pipeline_jobs ppj ON ppj.project_id = p.id
         WHERE p.id = $1 AND p.user_id = $2
         LIMIT 1`,
        [projectId, userId],
      )
    : await query<{ status: ProjectStatus; pipeline_job_id: string | null }>(
        `SELECT p.status,
                ppj.pipeline_job_id::text AS pipeline_job_id
         FROM projects p
         LEFT JOIN project_pipeline_jobs ppj ON ppj.project_id = p.id
         WHERE p.id = $1
         LIMIT 1`,
        [projectId],
      );

  const project = result.rows[0];
  if (!project || project.status !== "working") {
    return false;
  }

  if (project.pipeline_job_id) {
    const cancelled = await cancelPipelineJobInBackend(project.pipeline_job_id);
    if (!cancelled) {
      return false;
    }
  }

  await query(
    `UPDATE projects
     SET status = 'error',
         error_message = 'Проект остановлен администратором',
         finished_at = NOW(),
         updated_text = 'Остановлено администратором'
     WHERE id = $1`,
    [projectId],
  );

  await query(
    `INSERT INTO project_status_history (project_id, status, title, text)
     VALUES ($1, 'error', 'Остановлено', 'Проект остановлен администратором')`,
    [projectId],
  );

  return true;
}

export async function adminTransferProject(
  adminViewer: Viewer,
  projectId: string,
  targetUserIdentity: string,
) {
  const target = targetUserIdentity.trim();
  if (!target) {
    return { ok: false as const, error: "Укажите email или ID пользователя" };
  }

  const projectResult = await query<{ user_id: string; status: ProjectStatus; title: string }>(
    `SELECT user_id, status, title
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [projectId],
  );

  const project = projectResult.rows[0];
  if (!project) {
    return { ok: false as const, error: "Проект не найден" };
  }

  const targetUserResult = await query<{ id: string; full_name: string | null; email: string }>(
    `SELECT id, full_name, email
     FROM users
     WHERE id::text = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [target],
  );

  const targetUser = targetUserResult.rows[0];
  if (!targetUser) {
    return { ok: false as const, error: "Пользователь для передачи не найден" };
  }

  if (targetUser.id === project.user_id) {
    return { ok: false as const, error: "Проект уже принадлежит этому пользователю" };
  }

  await query(
    `UPDATE projects
     SET user_id = $1,
         updated_text = 'Передано другому пользователю'
     WHERE id = $2`,
    [targetUser.id, projectId],
  );

  await query(
    `INSERT INTO project_status_history (project_id, status, title, text)
     VALUES ($1, $2, 'Передача проекта', $3)`,
    [
      projectId,
      project.status,
      `Проект передан пользователю ${targetUser.full_name ?? "Пользователь"} (${targetUser.email}) администратором ${adminViewer.fullName}`,
    ],
  );

  return { ok: true as const, targetUserId: targetUser.id };
}

type FinanceRow = {
  id: number;
  operation_type: "Пополнение" | "Списание";
  amount_rub: number;
  note: string | null;
  created_at: Date;
};

export async function getFinanceData(
  userId: string,
  options?: {
    search?: string;
    page?: number;
    limit?: number;
    operationType?: "all" | "Пополнение" | "Списание";
  },
) {
  const rawSearch = options?.search?.trim() ?? "";
  const operationTypeFilter = options?.operationType === "Пополнение" || options?.operationType === "Списание" ? options.operationType : "all";
  const hasPagination = Number.isFinite(options?.limit) && (options?.limit ?? 0) > 0;
  const limit = hasPagination ? Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 10))) : 0;
  const requestedPage = Number.isFinite(options?.page) ? Math.max(1, Math.trunc(options?.page ?? 1)) : 1;

  const user = await query<{ balance_rub: number }>(
    `SELECT balance_rub FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );

  const whereType = operationTypeFilter === "all" ? "" : `AND operation_type = $${rawSearch ? 3 : 2}`;
  const whereSearch = rawSearch
    ? `AND (
         LOWER(COALESCE(note, '')) LIKE $2 OR
         LOWER(operation_type) LIKE $2 OR
         amount_rub::text LIKE $2 OR
         TO_CHAR(created_at, 'DD.MM.YYYY HH24:MI') LIKE $2
       )`
    : "";

  const searchParam = rawSearch ? `%${rawSearch.toLowerCase()}%` : null;
  const totalParams = rawSearch
    ? operationTypeFilter === "all"
      ? [userId, searchParam]
      : [userId, searchParam, operationTypeFilter]
    : operationTypeFilter === "all"
      ? [userId]
      : [userId, operationTypeFilter];
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM finance_operations
     WHERE user_id = $1
     ${whereSearch}
     ${whereType}`,
    totalParams,
  );

  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = hasPagination ? Math.max(1, Math.ceil(total / limit)) : 1;
  const safePage = hasPagination ? Math.min(requestedPage, totalPages) : 1;
  const offset = hasPagination ? (safePage - 1) * limit : 0;

  const operationsResult = hasPagination
    ? await query<FinanceRow>(
        `SELECT id, operation_type, amount_rub, note, created_at
         FROM finance_operations
         WHERE user_id = $1
         ${whereSearch}
         ${whereType}
         ORDER BY created_at DESC
         LIMIT $${rawSearch ? (operationTypeFilter === "all" ? 3 : 4) : operationTypeFilter === "all" ? 2 : 3}
         OFFSET $${rawSearch ? (operationTypeFilter === "all" ? 4 : 5) : operationTypeFilter === "all" ? 3 : 4}`,
        rawSearch
          ? operationTypeFilter === "all"
            ? [userId, searchParam, limit, offset]
            : [userId, searchParam, operationTypeFilter, limit, offset]
          : operationTypeFilter === "all"
            ? [userId, limit, offset]
            : [userId, operationTypeFilter, limit, offset],
      )
    : await query<FinanceRow>(
        `SELECT id, operation_type, amount_rub, note, created_at
         FROM finance_operations
         WHERE user_id = $1
         ${operationTypeFilter === "all" ? "" : "AND operation_type = $2"}
         ORDER BY created_at DESC`,
        operationTypeFilter === "all" ? [userId] : [userId, operationTypeFilter],
      );

  const monthTotalsResult = await query<{ month_topup: number; month_debit: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN operation_type = 'Пополнение' THEN amount_rub ELSE 0 END), 0)::int AS month_topup,
       COALESCE(SUM(CASE WHEN operation_type = 'Списание' THEN amount_rub ELSE 0 END), 0)::int AS month_debit
     FROM finance_operations
     WHERE user_id = $1
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())`,
    [userId],
  );

  const monthTopUp = monthTotalsResult.rows[0]?.month_topup ?? 0;
  const monthDebit = monthTotalsResult.rows[0]?.month_debit ?? 0;

  const operations: FinanceOperationView[] = operationsResult.rows.map((operation) => {
    const sign = operation.operation_type === "Пополнение" ? "+" : "-";

    return {
      id: String(operation.id),
      type: operation.operation_type,
      amount: `${sign}${operation.amount_rub.toLocaleString("ru-RU")} руб.`,
      date: operation.created_at.toISOString(),
      note: operation.note ?? "Без комментария",
    };
  });

  return {
    balanceRub: user.rows[0]?.balance_rub ?? 0,
    monthTopUp,
    monthDebit,
    operations,
    page: safePage,
    limit: hasPagination ? limit : operations.length,
    total,
    totalPages,
    search: rawSearch,
    operationType: operationTypeFilter,
  };
}

type PromoRow = {
  id: number;
  code: string;
  amount_rub: number;
  max_activations: number;
  expires_at: Date | null;
  expires_timezone: string | null;
  is_active: boolean;
  used_count: number;
  total_credited_rub: number;
  last_activated_at: Date | null;
};

function toPromoCodeView(row: PromoRow): PromoCodeView {
  const expiresDisplay = row.expires_at
    ? `${formatDateTimeInTimeZone(row.expires_at, row.expires_timezone)}${row.expires_timezone ? ` · ${row.expires_timezone}` : ""}`
    : "Бессрочно";

  return {
    id: String(row.id),
    code: row.code,
    amountRub: row.amount_rub,
    maxActivations: row.max_activations,
    usedActivations: row.used_count,
    expiresAt: toIsoString(row.expires_at),
    expiresTimeZone: row.expires_timezone,
    expiresDisplay,
    totalCreditedRub: row.total_credited_rub,
    lastActivatedAt: toIsoString(row.last_activated_at),
    isActive: row.is_active,
  };
}

export async function listPromoCodesForAdmin() {
  const result = await query<PromoRow>(
    `SELECT p.id,
            p.code,
            p.amount_rub,
            p.max_activations,
            p.expires_at,
            p.expires_timezone,
            p.is_active,
            COUNT(a.id)::int AS used_count,
            COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN p.amount_rub ELSE 0 END), 0)::int AS total_credited_rub,
            MAX(a.activated_at) AS last_activated_at
     FROM promo_codes p
     LEFT JOIN promo_code_activations a ON a.promo_code_id = p.id
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
  );

  return result.rows.map(toPromoCodeView);
}

export async function createPromoCodeByAdmin(
  adminUserId: string,
  payload: { code: string; amountRub: number; maxActivations: number; expiresAt?: string; expiresTimeZone?: string },
) {
  const normalizedCode = payload.code.trim().toUpperCase();
  const amountRub = Math.trunc(payload.amountRub);
  const maxActivations = Math.trunc(payload.maxActivations);
  const expiresAt = (payload.expiresAt ?? "").trim();
  const expiresTimeZone = (payload.expiresTimeZone ?? "").trim();

  if (!normalizedCode) {
    return { ok: false as const, error: "Код не должен быть пустым" };
  }

  if (!Number.isFinite(payload.amountRub) || amountRub <= 0) {
    return { ok: false as const, error: "Сумма должна быть больше нуля" };
  }

  if (!Number.isFinite(payload.maxActivations) || maxActivations < 0) {
    return { ok: false as const, error: "Лимит активаций не может быть отрицательным" };
  }

  if (expiresAt) {
    if (!expiresTimeZone) {
      return { ok: false as const, error: "Укажите смещение временной зоны в формате +03:00" };
    }

    if (parseUtcOffsetMinutes(expiresTimeZone) === null) {
      return { ok: false as const, error: "Укажите смещение временной зоны в формате +03:00" };
    }
  }

  const existing = await query<{ id: number }>(
    `SELECT id FROM promo_codes WHERE code = $1 LIMIT 1`,
    [normalizedCode],
  );

  if (existing.rows[0]) {
    return { ok: false as const, error: "Такой промокод уже существует" };
  }

  if (!expiresAt) {
    await query(
      `INSERT INTO promo_codes (code, amount_rub, max_activations, expires_at, expires_timezone, created_by_user_id, is_active)
       VALUES ($1, $2, $3, NULL, NULL, $4, TRUE)`,
      [normalizedCode, amountRub, maxActivations, adminUserId],
    );
  } else {
    const expiresAtDate = parseLocalDateTimeWithOffset(expiresAt, expiresTimeZone);
    if (!expiresAtDate) {
      return { ok: false as const, error: "Укажите корректные дату и временную зону" };
    }

    await query(
      `INSERT INTO promo_codes (code, amount_rub, max_activations, expires_at, expires_timezone, created_by_user_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [normalizedCode, amountRub, maxActivations, expiresAtDate, expiresTimeZone, adminUserId],
    );
  }

  return { ok: true as const };
}

export async function deactivatePromoCodeByAdmin(promoId: string) {
  const parsedId = Number(promoId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return { ok: false as const, error: "Некорректный идентификатор промокода" };
  }

  const result = await query(
    `UPDATE promo_codes
     SET is_active = FALSE
     WHERE id = $1 AND is_active = TRUE`,
    [parsedId],
  );

  if ((result.rowCount ?? 0) === 0) {
    return { ok: false as const, error: "Промокод не найден или уже деактивирован" };
  }

  return { ok: true as const };
}

export async function activatePromoCodeByAdmin(promoId: string) {
  const parsedId = Number(promoId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return { ok: false as const, error: "Некорректный идентификатор промокода" };
  }

  const result = await query(
    `UPDATE promo_codes
     SET is_active = TRUE
     WHERE id = $1 AND is_active = FALSE`,
    [parsedId],
  );

  if ((result.rowCount ?? 0) === 0) {
    return { ok: false as const, error: "Промокод не найден или уже активен" };
  }

  return { ok: true as const };
}

export async function deletePromoCodeByAdmin(promoId: string) {
  const parsedId = Number(promoId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return { ok: false as const, error: "Некорректный идентификатор промокода" };
  }

  const result = await query(
    `DELETE FROM promo_codes
     WHERE id = $1 AND is_active = FALSE`,
    [parsedId],
  );

  if ((result.rowCount ?? 0) === 0) {
    return { ok: false as const, error: "Удалять можно только деактивированный промокод" };
  }

  return { ok: true as const };
}

type PromoResolveRow = {
  id: number;
  amount_rub: number;
  max_activations: number;
  expires_at: Date | null;
  is_active: boolean;
  used_count: number;
  already_used_by_user: boolean;
};

export async function activatePromoCodeByUser(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false as const, error: "Введите промокод" };
  }

  const promoResult = await query<PromoResolveRow>(
    `SELECT p.id,
            p.amount_rub,
            p.max_activations,
            p.expires_at,
            p.is_active,
            COUNT(a_all.id)::int AS used_count,
            BOOL_OR(a_user.user_id IS NOT NULL) AS already_used_by_user
     FROM promo_codes p
     LEFT JOIN promo_code_activations a_all ON a_all.promo_code_id = p.id
     LEFT JOIN promo_code_activations a_user ON a_user.promo_code_id = p.id AND a_user.user_id = $2
     WHERE p.code = $1
     GROUP BY p.id
     LIMIT 1`,
    [code, userId],
  );

  const promo = promoResult.rows[0];
  if (!promo) {
    return { ok: false as const, error: "Промокод не найден" };
  }

  if (!promo.is_active) {
    return { ok: false as const, error: "Промокод неактивен" };
  }

  if (promo.expires_at && promo.expires_at.getTime() < Date.now()) {
    return { ok: false as const, error: "Срок действия промокода истёк" };
  }

  if (promo.max_activations > 0 && promo.used_count >= promo.max_activations) {
    return { ok: false as const, error: "Лимит активаций промокода исчерпан" };
  }

  if (promo.already_used_by_user) {
    return { ok: false as const, error: "Вы уже активировали этот промокод" };
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO promo_code_activations (promo_code_id, user_id)
         VALUES ($1, $2)`,
        [promo.id, userId],
      );

      await client.query(
        `UPDATE users
         SET balance_rub = balance_rub + $1
         WHERE id = $2`,
        [promo.amount_rub, userId],
      );

      await client.query(
        `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
         VALUES ($1, 'Пополнение', $2, $3)`,
        [userId, promo.amount_rub, `Промокод ${code}`],
      );
    });
  } catch {
    return { ok: false as const, error: "Не удалось активировать промокод" };
  }

  return { ok: true as const };
}

export async function updateProfileByUser(
  userId: string,
  payload: { fullName: string; email: string; passwordHash?: string },
) {
  await query(
    `UPDATE users
     SET full_name = $1,
         email = $2,
         password_hash = COALESCE($3, password_hash)
     WHERE id = $4`,
    [payload.fullName.trim(), payload.email.trim().toLowerCase(), payload.passwordHash ?? null, userId],
  );
}

type AdminUserRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: "user" | "admin";
  balance_rub: number;
  is_active: boolean;
  created_at: Date;
};

export async function adminListUsers(options?: {
  search?: string;
  role?: "all" | "user" | "admin";
  isActive?: "all" | "active" | "inactive";
  page?: number;
  limit?: number;
}) {
  const rawSearch = options?.search?.trim() ?? "";
  const roleFilter = options?.role === "admin" || options?.role === "user" ? options.role : "all";
  const activeFilter = options?.isActive === "active" || options?.isActive === "inactive" ? options.isActive : "all";
  const page = Number.isFinite(options?.page) ? Math.max(1, Math.trunc(options?.page ?? 1)) : 1;
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 10))) : 10;

  const whereParts: string[] = [];
  const params: Array<string | boolean | number> = [];

  if (rawSearch) {
    params.push(`%${rawSearch.toLowerCase()}%`);
    whereParts.push(`(LOWER(COALESCE(full_name, '')) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR id::text LIKE $${params.length})`);
  }

  if (roleFilter !== "all") {
    params.push(roleFilter);
    whereParts.push(`role = $${params.length}`);
  }

  if (activeFilter !== "all") {
    params.push(activeFilter === "active");
    whereParts.push(`is_active = $${params.length}`);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM users
     ${whereClause}`,
    params,
  );

  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const safeOffset = (safePage - 1) * limit;

  const listParams = [...params, limit, safeOffset];
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;

  const result = await query<AdminUserRow>(
    `SELECT id, full_name, email, role, balance_rub, is_active, created_at
     FROM users
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    listParams,
  );

  const items = result.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name ?? "Пользователь",
    email: row.email,
    role: row.role,
    balanceRub: row.balance_rub,
    isActive: row.is_active,
    createdAt: formatDateTime(row.created_at),
  }));

  return {
    items,
    page: safePage,
    limit,
    total,
    totalPages,
    search: rawSearch,
    role: roleFilter,
    isActive: activeFilter,
  };
}

type AdminProjectRow = {
  id: string;
  title: string;
  status: ProjectStatus;
  description: string;
  project_price_rub: number;
  result_file: string | null;
  updated_at: Date;
};

async function adminListProjectsByUser(
  userId: string,
  options?: {
    search?: string;
    status?: "all" | ProjectStatus;
    page?: number;
    limit?: number;
  },
) {
  const rawSearch = options?.search?.trim() ?? "";
  const statusFilter = options?.status && options.status !== "all" ? options.status : "all";
  const page = Number.isFinite(options?.page) ? Math.max(1, Math.trunc(options?.page ?? 1)) : 1;
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 10))) : 10;

  const whereParts = ["user_id = $1"];
  const params: Array<string | number> = [userId];

  if (rawSearch) {
    params.push(`%${rawSearch.toLowerCase()}%`);
    whereParts.push(`LOWER(title) LIKE $${params.length}`);
  }

  if (statusFilter !== "all") {
    params.push(statusFilter);
    whereParts.push(`status = $${params.length}`);
  }

  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM projects
     ${whereClause}`,
    params,
  );

  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;

  const result = await query<AdminProjectRow>(
    `SELECT id, title, status, description, project_price_rub, result_file, updated_at
     FROM projects
     ${whereClause}
     ORDER BY updated_at DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const items = await Promise.all(
    result.rows.map(async (row) => {
      const columns = await getColumns(row.id);
      const statusHistory = await getHistory(row.id);

      return {
        id: row.id,
        title: row.title,
        status: row.status,
        updatedText: formatRelative(row.updated_at),
        description: row.description,
        columns: columns.join(", "),
        projectPriceRub: row.project_price_rub,
        resultFile: row.result_file ?? undefined,
        statusHistory,
      } satisfies ProjectView;
    }),
  );

  return {
    items,
    page: safePage,
    limit,
    total,
    totalPages,
    search: rawSearch,
    status: statusFilter,
  };
}

type AnalyticsSnapshotRow = {
  snapshot_minute: Date;
  users_total: number;
  total_balance_rub: number;
  projects_new: number;
  projects_working: number;
  projects_done: number;
  projects_error: number;
  working_projects_by_user: unknown;
  working_project_list: unknown;
};

type DashboardCashflowRow = {
  day: Date;
  cash_in_rub: number;
  revenue_rub: number;
  promo_cost_rub: number;
  new_users: number;
  completed_projects: number;
};

type DashboardBusinessSummaryRow = {
  cash_in_30d: number;
  revenue_30d: number;
  promo_cost_30d: number;
  paid_starts_30d: number;
  new_users_30d: number;
  new_projects_30d: number;
  completed_projects_30d: number;
  error_projects_30d: number;
  active_customers_30d: number;
  paying_users_30d: number;
};

type DashboardWorkingUser = {
  userId: string;
  fullName: string;
  email: string;
  workingProjects: number;
};

type DashboardWorkingProject = {
  projectId: string;
  title: string;
  userId: string;
  fullName: string;
  email: string;
};

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

export async function getAdminDashboardAnalytics(points = 12) {
  const safePoints = Math.max(4, Math.min(48, Math.trunc(points)));

  try {
    const latestResult = await query<AnalyticsSnapshotRow>(
      `SELECT snapshot_minute,
              users_total,
              total_balance_rub,
              projects_new,
              projects_working,
              projects_done,
              projects_error,
              working_projects_by_user,
              working_project_list
       FROM system_analytics_snapshots
       ORDER BY snapshot_minute DESC
       LIMIT 1`,
    );

    if (!latestResult.rows[0]) {
      await query(`SELECT refresh_system_analytics_snapshot()`);
    }

    const ensuredLatestResult = latestResult.rows[0]
      ? latestResult
      : await query<AnalyticsSnapshotRow>(
          `SELECT snapshot_minute,
                  users_total,
                  total_balance_rub,
                  projects_new,
                  projects_working,
                  projects_done,
                  projects_error,
                  working_projects_by_user,
                  working_project_list
           FROM system_analytics_snapshots
           ORDER BY snapshot_minute DESC
           LIMIT 1`,
        );

    const latest = ensuredLatestResult.rows[0];
    if (!latest) {
      return null;
    }

    const historyResult = await query<
      Pick<AnalyticsSnapshotRow, "snapshot_minute" | "users_total" | "total_balance_rub" | "projects_working">
    >(
      `SELECT snapshot_minute, users_total, total_balance_rub, projects_working
       FROM system_analytics_snapshots
       ORDER BY snapshot_minute DESC
       LIMIT $1`,
      [safePoints],
    );

    const history = [...historyResult.rows]
      .reverse()
      .map((row) => ({
        label: new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(row.snapshot_minute),
        usersTotal: row.users_total,
        totalBalanceRub: row.total_balance_rub,
        projectsWorking: row.projects_working,
      }));

    const [businessSummaryResult, cashflowResult] = await Promise.all([
      query<DashboardBusinessSummaryRow>(
        `SELECT
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Пополнение' AND COALESCE(fo.note, '') NOT LIKE 'Промокод %' THEN fo.amount_rub ELSE 0 END), 0)::int AS cash_in_30d,
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Списание' AND COALESCE(fo.note, '') LIKE 'Запуск проекта %' THEN fo.amount_rub ELSE 0 END), 0)::int AS revenue_30d,
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Пополнение' AND COALESCE(fo.note, '') LIKE 'Промокод %' THEN fo.amount_rub ELSE 0 END), 0)::int AS promo_cost_30d,
           COALESCE(COUNT(*) FILTER (WHERE fo.operation_type = 'Списание' AND COALESCE(fo.note, '') LIKE 'Запуск проекта %'), 0)::int AS paid_starts_30d,
           (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days') AS new_users_30d,
           (SELECT COUNT(*)::int FROM projects WHERE created_at >= NOW() - INTERVAL '30 days') AS new_projects_30d,
           (SELECT COUNT(*)::int FROM projects WHERE status = 'done' AND finished_at >= NOW() - INTERVAL '30 days') AS completed_projects_30d,
           (SELECT COUNT(*)::int FROM projects WHERE status = 'error' AND finished_at >= NOW() - INTERVAL '30 days') AS error_projects_30d,
           (
             SELECT COUNT(DISTINCT src.user_id)::int
             FROM (
               SELECT p.user_id
               FROM projects p
               WHERE p.started_at >= NOW() - INTERVAL '30 days'
               UNION
               SELECT fo2.user_id
               FROM finance_operations fo2
               WHERE fo2.created_at >= NOW() - INTERVAL '30 days'
             ) src
           ) AS active_customers_30d,
           (
             SELECT COUNT(DISTINCT fo3.user_id)::int
             FROM finance_operations fo3
             WHERE fo3.created_at >= NOW() - INTERVAL '30 days'
               AND fo3.operation_type = 'Списание'
               AND COALESCE(fo3.note, '') LIKE 'Запуск проекта %'
           ) AS paying_users_30d
         FROM finance_operations fo
         WHERE fo.created_at >= NOW() - INTERVAL '30 days'`,
      ),
      query<DashboardCashflowRow>(
        `WITH days AS (
           SELECT generate_series(
             date_trunc('day', NOW()) - INTERVAL '13 days',
             date_trunc('day', NOW()),
             INTERVAL '1 day'
           ) AS day
         )
         SELECT
           d.day,
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Пополнение' AND COALESCE(fo.note, '') NOT LIKE 'Промокод %' THEN fo.amount_rub ELSE 0 END), 0)::int AS cash_in_rub,
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Списание' AND COALESCE(fo.note, '') LIKE 'Запуск проекта %' THEN fo.amount_rub ELSE 0 END), 0)::int AS revenue_rub,
           COALESCE(SUM(CASE WHEN fo.operation_type = 'Пополнение' AND COALESCE(fo.note, '') LIKE 'Промокод %' THEN fo.amount_rub ELSE 0 END), 0)::int AS promo_cost_rub,
           COALESCE((SELECT COUNT(*)::int FROM users u WHERE date_trunc('day', u.created_at) = d.day), 0)::int AS new_users,
           COALESCE((SELECT COUNT(*)::int FROM projects p WHERE p.status = 'done' AND date_trunc('day', p.finished_at) = d.day), 0)::int AS completed_projects
         FROM days d
         LEFT JOIN finance_operations fo ON date_trunc('day', fo.created_at) = d.day
         GROUP BY d.day
         ORDER BY d.day ASC`,
      ),
    ]);

    const summary = businessSummaryResult.rows[0];
    const cashflow = cashflowResult.rows.map((row) => ({
      label: new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      }).format(row.day),
      cashInRub: row.cash_in_rub,
      revenueRub: row.revenue_rub,
      promoCostRub: row.promo_cost_rub,
      newUsers: row.new_users,
      completedProjects: row.completed_projects,
    }));

    const successfulClosed = (summary?.completed_projects_30d ?? 0) + (summary?.error_projects_30d ?? 0);
    const successRate30d = successfulClosed > 0 ? Math.round(((summary?.completed_projects_30d ?? 0) / successfulClosed) * 100) : 0;
    const averageCheck30d = (summary?.paid_starts_30d ?? 0) > 0 ? Math.round((summary?.revenue_30d ?? 0) / (summary?.paid_starts_30d ?? 1)) : 0;

    return {
      collectedAt: formatDateTime(latest.snapshot_minute),
      collectedAtIso: latest.snapshot_minute.toISOString(),
      usersTotal: latest.users_total,
      totalBalanceRub: latest.total_balance_rub,
      projects: {
        new: latest.projects_new,
        working: latest.projects_working,
        done: latest.projects_done,
        error: latest.projects_error,
      },
      workingUsers: toArray<DashboardWorkingUser>(latest.working_projects_by_user),
      workingProjects: toArray<DashboardWorkingProject>(latest.working_project_list),
      history,
      business: {
        cashIn30d: summary?.cash_in_30d ?? 0,
        revenue30d: summary?.revenue_30d ?? 0,
        promoCost30d: summary?.promo_cost_30d ?? 0,
        paidStarts30d: summary?.paid_starts_30d ?? 0,
        averageCheck30d,
        newUsers30d: summary?.new_users_30d ?? 0,
        newProjects30d: summary?.new_projects_30d ?? 0,
        completedProjects30d: summary?.completed_projects_30d ?? 0,
        errorProjects30d: summary?.error_projects_30d ?? 0,
        activeCustomers30d: summary?.active_customers_30d ?? 0,
        payingUsers30d: summary?.paying_users_30d ?? 0,
        successRate30d,
      },
      cashflow,
    };
  } catch {
    return null;
  }
}

export async function adminGetUserWithProjects(
  userId: string,
  options?: { projectSearch?: string; projectStatus?: "all" | ProjectStatus; projectPage?: number; projectLimit?: number },
) {
  const userResult = await query<AdminUserRow>(
    `SELECT id, full_name, email, role, balance_rub, is_active, created_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );

  const user = userResult.rows[0];
  if (!user) return null;

  const projectsPage = await adminListProjectsByUser(userId, {
    search: options?.projectSearch,
    status: options?.projectStatus,
    page: options?.projectPage,
    limit: options?.projectLimit,
  });

  return {
    id: user.id,
    fullName: user.full_name ?? "Пользователь",
    email: user.email,
    role: user.role,
    balanceRub: user.balance_rub,
    isActive: user.is_active,
    createdAt: user.created_at.toISOString(),
    projects: projectsPage.items,
    projectsPage,
  };
}

export async function getUserPromocodeUsage(userId: string) {
  const result = await query<{ code: string; activated_at: Date; amount_rub: number }>(
    `SELECT p.code, a.activated_at, p.amount_rub
     FROM promo_code_activations a
     JOIN promo_codes p ON p.id = a.promo_code_id
     WHERE a.user_id = $1
     ORDER BY a.activated_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    code: row.code,
    activatedAt: row.activated_at.toISOString(),
    amountRub: row.amount_rub,
  }));
}

export async function adminUpdateUser(
  adminViewer: Viewer,
  targetUserId: string,
  payload: {
    fullName: string;
    email: string;
    role: "user" | "admin";
    isActive: boolean;
    passwordHash?: string;
  },
) {
  await query(
    `UPDATE users
     SET full_name = $1,
         email = $2,
         role = $3,
         is_active = $4,
         password_hash = COALESCE($5, password_hash)
     WHERE id = $6`,
    [
      payload.fullName.trim(),
      payload.email.trim().toLowerCase(),
      payload.role,
      payload.isActive,
      payload.passwordHash ?? null,
      targetUserId,
    ],
  );

  if (targetUserId === adminViewer.id && payload.role !== "admin") {
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [targetUserId]);
  }
}

export async function adminCreateUser(
  _adminViewer: Viewer,
  payload: {
    fullName: string;
    email: string;
    passwordHash: string;
    role: "user" | "admin";
    balanceRub: number;
    isActive: boolean;
  },
) {
  const fullName = payload.fullName.trim();
  const email = payload.email.trim().toLowerCase();
  const balanceRub = Math.trunc(payload.balanceRub);

  if (!fullName || !email) {
    return { ok: false as const, error: "Заполните имя и email" };
  }

  if (!Number.isFinite(payload.balanceRub) || balanceRub < 0) {
    return { ok: false as const, error: "Стартовый баланс не может быть отрицательным" };
  }

  const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
  if (existing.rows[0]) {
    return { ok: false as const, error: "Пользователь с таким email уже существует" };
  }

  try {
    const created = await query<{ id: string }>(
      `INSERT INTO users (full_name, email, password_hash, role, balance_rub, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [fullName, email, payload.passwordHash, payload.role, balanceRub, payload.isActive],
    );

    return { ok: true as const, userId: created.rows[0].id };
  } catch {
    return { ok: false as const, error: "Не удалось создать пользователя" };
  }
}

export async function adminCreateBalanceOperation(
  _adminViewer: Viewer,
  targetUserId: string,
  payload: {
    operationType: "Пополнение" | "Списание";
    amountRub: number;
    source: string;
    performedBy?: string;
    comment?: string;
  },
) {
  const amountRub = Math.trunc(payload.amountRub);
  const source = payload.source.trim();
  const performedBy = (payload.performedBy ?? "").trim();
  const comment = (payload.comment ?? "").trim();

  if (amountRub <= 0) {
    return { ok: false as const, error: "Сумма должна быть больше нуля" };
  }

  const noteParts = [
    source ? `Источник: ${source}` : null,
    performedBy ? `Кем: ${performedBy}` : null,
    comment ? `Комментарий: ${comment}` : null,
  ].filter(Boolean);
  const note = noteParts.length ? noteParts.join("; ") : null;

  try {
    await withTransaction(async (client) => {
      const balanceUpdateResult =
        payload.operationType === "Пополнение"
          ? await client.query(
              `UPDATE users
               SET balance_rub = balance_rub + $1
               WHERE id = $2
               RETURNING id`,
              [amountRub, targetUserId],
            )
          : await client.query(
              `UPDATE users
               SET balance_rub = balance_rub - $1
               WHERE id = $2 AND balance_rub >= $1
               RETURNING id`,
              [amountRub, targetUserId],
            );

      if ((balanceUpdateResult.rowCount ?? 0) === 0) {
        throw new Error(
          payload.operationType === "Списание"
            ? "Недостаточно средств у пользователя или пользователь не найден"
            : "Пользователь не найден",
        );
      }

      await client.query(
        `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
         VALUES ($1, $2, $3, $4)`,
        [targetUserId, payload.operationType, amountRub, note],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message) {
      return { ok: false as const, error: error.message };
    }

    return { ok: false as const, error: "Не удалось провести операцию" };
  }

  return { ok: true as const };
}

export async function getSystemWorkersSnapshot(): Promise<SystemWorkersSnapshot> {
  const backendBase = (process.env.BACKEND_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const fallback: SystemWorkersSnapshot = {
    updatedAt: "недоступно",
    workersTotal: 0,
    workersBusy: 0,
    workersIdle: 0,
    queueSize: 0,
    queueDepths: {},
    workers: [],
    backendAvailable: false,
  };

  try {
    const response = await fetch(`${backendBase}/system/workers`, {
      method: "GET",
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return fallback;
    }

    const payload = (await response.json()) as {
      workers?: Array<{
        worker_id: string;
        worker_role: string;
        status: string;
        current_job_id?: string | null;
        message?: string | null;
        queue_depth?: number | null;
        host?: string | null;
        updated_at: string;
      }>;
      queue_depths?: Record<string, number>;
      workers_total?: number;
      workers_busy?: number;
      workers_idle?: number;
    };

    const activeWorkers = (payload.workers ?? []).filter(
      (worker) => worker.status === "busy" || worker.status === "idle",
    );

    const currentJobIds = Array.from(
      new Set(
        activeWorkers
          .map((worker) => worker.current_job_id)
          .filter((jobId): jobId is string => Boolean(jobId)),
      ),
    );

    const projectByPipelineJob = new Map<string, { projectId: string; projectTitle: string }>();
    if (currentJobIds.length > 0) {
      const links = await query<{ pipeline_job_id: string; project_id: string; project_title: string }>(
        `SELECT ppj.pipeline_job_id::text AS pipeline_job_id,
                p.id::text AS project_id,
                p.title AS project_title
         FROM project_pipeline_jobs ppj
         JOIN projects p ON p.id = ppj.project_id
         WHERE ppj.pipeline_job_id = ANY($1::uuid[])`,
        [currentJobIds],
      );

      links.rows.forEach((row) => {
        projectByPipelineJob.set(row.pipeline_job_id, {
          projectId: row.project_id,
          projectTitle: row.project_title,
        });
      });
    }

    const workers: SystemWorkerView[] = activeWorkers.map((worker) => {
      const linkedProject = worker.current_job_id ? projectByPipelineJob.get(worker.current_job_id) : undefined;
      return {
        workerId: worker.worker_id,
        workerRole: worker.worker_role,
        status: worker.status === "busy" ? "busy" : worker.status === "idle" ? "idle" : "unknown",
        currentJobId: worker.current_job_id ?? null,
        projectId: linkedProject?.projectId ?? null,
        projectTitle: linkedProject?.projectTitle ?? null,
        message: worker.message ?? null,
        queueDepth: worker.queue_depth ?? null,
        host: worker.host ?? null,
        updatedAt: worker.updated_at,
      };
    });

    const queueDepths = payload.queue_depths ?? {};
    const queueSize = Object.values(queueDepths)
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((acc, value) => acc + value, 0);

    return {
      updatedAt: new Date().toISOString(),
      workersTotal: workers.length,
      workersBusy: workers.filter((worker) => worker.status === "busy").length,
      workersIdle: workers.filter((worker) => worker.status === "idle").length,
      queueSize,
      queueDepths,
      workers,
      backendAvailable: true,
    };
  } catch {
    return fallback;
  }
}

let tBankSchemaEnsured = false;

async function ensureTBankTopupsSchema() {
  if (tBankSchemaEnsured) {
    return;
  }

  await query(
    `CREATE TABLE IF NOT EXISTS tbank_topups (
       id BIGSERIAL PRIMARY KEY,
       order_id TEXT NOT NULL UNIQUE,
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       amount_rub INTEGER NOT NULL CHECK (amount_rub > 0),
       payment_id BIGINT UNIQUE,
       status TEXT NOT NULL DEFAULT 'created',
       payment_url TEXT,
       init_payload JSONB,
       notification_payload JSONB,
       credited_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_tbank_topups_user_created ON tbank_topups(user_id, created_at DESC)`);
  await query(`DROP TRIGGER IF EXISTS trg_tbank_topups_set_updated_at ON tbank_topups`);
  await query(
    `CREATE TRIGGER trg_tbank_topups_set_updated_at
     BEFORE UPDATE ON tbank_topups
     FOR EACH ROW
     EXECUTE FUNCTION set_updated_at()`,
  );

  tBankSchemaEnsured = true;
}

export async function createTBankTopupOrder(userId: string, amountRub: number, orderId: string) {
  await ensureTBankTopupsSchema();

  await query(
    `INSERT INTO tbank_topups (order_id, user_id, amount_rub, status)
     VALUES ($1, $2, $3, 'created')`,
    [orderId, userId, amountRub],
  );
}

export async function saveTBankInitResponse(
  orderId: string,
  payload: {
    status: string;
    paymentId?: number | null;
    paymentUrl?: string | null;
    initPayload?: unknown;
  },
) {
  await ensureTBankTopupsSchema();

  await query(
    `UPDATE tbank_topups
     SET status = $2,
         payment_id = COALESCE($3, payment_id),
         payment_url = COALESCE($4, payment_url),
         init_payload = COALESCE($5::jsonb, init_payload)
     WHERE order_id = $1`,
    [orderId, payload.status, payload.paymentId ?? null, payload.paymentUrl ?? null, JSON.stringify(payload.initPayload ?? null)],
  );
}

type FinalizeTBankTopupResult =
  | { ok: true; credited: boolean; reason?: "already_credited" | "not_confirmed" | "not_found" }
  | { ok: false; reason: "amount_mismatch" };

export async function finalizeTBankTopupFromNotification(payload: {
  orderId: string;
  status: string;
  success: boolean;
  paymentId: number | null;
  amountKopecks: number | null;
  rawNotification: unknown;
}): Promise<FinalizeTBankTopupResult> {
  await ensureTBankTopupsSchema();

  return withTransaction(async (client) => {
    const topupResult = await client.query<{
      order_id: string;
      user_id: string;
      amount_rub: number;
      credited_at: Date | null;
    }>(
      `SELECT order_id, user_id, amount_rub, credited_at
       FROM tbank_topups
       WHERE order_id = $1
       FOR UPDATE`,
      [payload.orderId],
    );

    const topup = topupResult.rows[0];
    if (!topup) {
      return { ok: true, credited: false, reason: "not_found" };
    }

    await client.query(
      `UPDATE tbank_topups
       SET status = $2,
           payment_id = COALESCE($3, payment_id),
           notification_payload = $4::jsonb
       WHERE order_id = $1`,
      [payload.orderId, payload.status, payload.paymentId, JSON.stringify(payload.rawNotification ?? null)],
    );

    const isConfirmed = payload.success && payload.status.toUpperCase() === "CONFIRMED";
    if (!isConfirmed) {
      return { ok: true, credited: false, reason: "not_confirmed" };
    }

    if (topup.credited_at) {
      return { ok: true, credited: false, reason: "already_credited" };
    }

    const expectedKopecks = topup.amount_rub * 100;
    if (payload.amountKopecks != null && payload.amountKopecks !== expectedKopecks) {
      return { ok: false, reason: "amount_mismatch" };
    }

    await client.query(
      `UPDATE users
       SET balance_rub = balance_rub + $1
       WHERE id = $2`,
      [topup.amount_rub, topup.user_id],
    );

    await client.query(
      `INSERT INTO finance_operations (user_id, operation_type, amount_rub, note)
       VALUES ($1, 'Пополнение', $2, $3)`,
      [
        topup.user_id,
        topup.amount_rub,
        payload.paymentId
          ? `Пополнение через Т-Банк, заказ ${topup.order_id}, платёж ${payload.paymentId}`
          : `Пополнение через Т-Банк, заказ ${topup.order_id}`,
      ],
    );

    await client.query(
      `UPDATE tbank_topups
       SET status = 'credited',
           credited_at = NOW(),
           payment_id = COALESCE($2, payment_id)
       WHERE order_id = $1`,
      [payload.orderId, payload.paymentId],
    );

    return { ok: true, credited: true };
  });
}

export async function getTBankTopupForUserByOrder(orderId: string, userId: string) {
  await ensureTBankTopupsSchema();

  const result = await query<{
    order_id: string;
    user_id: string;
    payment_id: number | null;
    status: string;
    credited_at: Date | null;
  }>(
    `SELECT order_id, user_id, payment_id, status, credited_at
     FROM tbank_topups
     WHERE order_id = $1 AND user_id = $2
     LIMIT 1`,
    [orderId, userId],
  );

  return result.rows[0] ?? null;
}

export async function saveTBankCancelResponse(payload: {
  orderId: string;
  status: string;
  cancelPayload: unknown;
}) {
  await ensureTBankTopupsSchema();

  await query(
    `UPDATE tbank_topups
     SET status = $2,
         notification_payload = $3::jsonb
     WHERE order_id = $1`,
    [payload.orderId, payload.status, JSON.stringify(payload.cancelPayload ?? null)],
  );
}
