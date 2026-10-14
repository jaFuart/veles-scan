import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BrowserDateTime } from "@/components/ui/BrowserDateTime";
import { SystemStatusPanel } from "@/components/ui/SystemStatusPanel";
import { Badge } from "@/components/ui/Badge";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { ClientQueryForm } from "@/components/ui/ClientQueryForm";
import { FormPendingButton } from "@/components/ui/FormPendingButton";
import { QueryResultToasts } from "@/components/ui/QueryResultToasts";
import { requireAdminViewer } from "@/lib/auth";
import {
  adminCreateBalanceOperationAction,
  adminCreateProjectForUserAction,
  adminCreateUserAction,
  adminUpdateUserAction,
  createPromoCodeAction,
  deletePromoCodeAction,
  deactivatePromoCodeAction,
  reactivatePromoCodeAction,
  updateGlobalSettingsAction,
} from "@/lib/actions";
import {
  adminGetUserWithProjects,
  adminListUsers,
  getFinanceData,
  getAdminDashboardAnalytics,
  getGlobalSettings,
  getSystemWorkersSnapshot,
  listPromoCodesForAdmin,
} from "@/lib/repositories";

type AdminPageProps = {
  searchParams: Promise<{
    tab?: string;
    dashUsersPage?: string;
    dashProjectsPage?: string;
    q?: string;
    userRole?: string;
    userActive?: string;
    page?: string;
    user?: string;
    projectQ?: string;
    projectStatus?: string;
    projectPage?: string;
    opQ?: string;
    opType?: string;
    opPage?: string;
    error?: string;
    success?: string;
    promoError?: string;
    promoSuccess?: string;
    settingsError?: string;
    settingsSuccess?: string;
    resultKey?: string;
  }>;
};

function buildChartPoints(values: number[], width: number, height: number, padding = 18) {
  if (!values.length) {
    return [] as Array<{ x: number; y: number }>;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * innerWidth;
    const normalized = (value - min) / range;

    return {
      x,
      y: height - padding - normalized * innerHeight,
    };
  });
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number }>, height: number, padding = 18) {
  if (!points.length) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];

  return `${buildLinePath(points)} L ${last.x} ${height - padding} L ${first.x} ${height - padding} Z`;
}

function getTrendMeta(current: number, previous: number) {
  const delta = current - previous;

  if (previous === 0) {
    return {
      delta,
      percent: current === 0 ? 0 : 100,
      tone: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
    } as const;
  }

  return {
    delta,
    percent: Math.round((Math.abs(delta) / Math.abs(previous)) * 100),
    tone: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
  } as const;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const viewer = await requireAdminViewer();
  const query = await searchParams;

  const activeTab =
    query.tab === "promos"
      ? "promos"
      : query.tab === "users"
        ? "users"
        : query.tab === "settings"
          ? "settings"
          : query.tab === "system"
            ? "system"
            : "dashboard";
  const dashboardUsersPageNumber = Number(query.dashUsersPage ?? "1");
  const dashboardProjectsPageNumber = Number(query.dashProjectsPage ?? "1");
  const usersSearch = String(query.q ?? "").trim();
  const usersRoleFilter = query.userRole === "admin" || query.userRole === "user" ? query.userRole : "all";
  const usersActiveFilter = query.userActive === "active" || query.userActive === "inactive" ? query.userActive : "all";
  const projectSearch = String(query.projectQ ?? "").trim();
  const projectStatusFilter =
    query.projectStatus === "new" || query.projectStatus === "working" || query.projectStatus === "done" || query.projectStatus === "error"
      ? query.projectStatus
      : "all";
  const projectPageNumber = Number(query.projectPage ?? "1");
  const operationsSearch = String(query.opQ ?? "").trim();
  const operationTypeFilter = query.opType === "Пополнение" || query.opType === "Списание" ? query.opType : "all";
  const requestedPage = Number(query.page ?? "1");
  const requestedOperationsPage = Number(query.opPage ?? "1");
  const resultKey = String(query.resultKey ?? "").trim();

  const usersPage =
    activeTab === "users"
      ? await adminListUsers({
          search: usersSearch,
          role: usersRoleFilter,
          isActive: usersActiveFilter,
          page: Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1,
          limit: 10,
        })
      : {
          items: [],
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 1,
          search: usersSearch,
          role: usersRoleFilter,
          isActive: usersActiveFilter,
        };

  const users = usersPage.items;
  const dashboardAnalytics = activeTab === "dashboard" ? await getAdminDashboardAnalytics(12) : null;
  const globalSettings = activeTab === "settings" ? await getGlobalSettings() : null;
  const promoCodes = await listPromoCodesForAdmin();
  const selectedUserId = query.user ?? users[0]?.id;
  const selected =
    activeTab === "users" && selectedUserId
      ? await adminGetUserWithProjects(selectedUserId, {
          projectSearch,
          projectStatus: projectStatusFilter,
          projectPage: Number.isFinite(projectPageNumber) ? Math.max(1, Math.trunc(projectPageNumber)) : 1,
          projectLimit: 10,
        })
      : null;
  const selectedFinance =
    activeTab === "users" && selected
      ? await getFinanceData(selected.id, {
          search: operationsSearch,
          operationType: operationTypeFilter,
          page: Number.isFinite(requestedOperationsPage) ? Math.max(1, Math.trunc(requestedOperationsPage)) : 1,
          limit: 10,
        })
      : null;

  const statusBadge = {
    new: { label: "Новый", color: "yellow" as const },
    working: { label: "В работе", color: "blue" as const },
    done: { label: "Выполнен", color: "green" as const },
    error: { label: "Ошибка", color: "red" as const },
  };

  const usersTabLink = (params?: { user?: string; page?: number }) => {
    const next = new URLSearchParams();
    next.set("tab", "users");
    next.set("page", String(params?.page ?? usersPage.page));
    if (usersSearch) {
      next.set("q", usersSearch);
    }
    if (usersRoleFilter !== "all") {
      next.set("userRole", usersRoleFilter);
    }
    if (usersActiveFilter !== "all") {
      next.set("userActive", usersActiveFilter);
    }
    if (projectSearch) {
      next.set("projectQ", projectSearch);
    }
    if (projectStatusFilter !== "all") {
      next.set("projectStatus", projectStatusFilter);
    }
    next.set("projectPage", "1");

    const nextUserId = params?.user ?? selectedUserId;
    if (nextUserId) {
      next.set("user", nextUserId);
    }

    if (operationsSearch) {
      next.set("opQ", operationsSearch);
    }
    if (operationTypeFilter !== "all") {
      next.set("opType", operationTypeFilter);
    }
    next.set("opPage", "1");

    return `/admin?${next.toString()}`;
  };

  const tabLink = (tab: string) =>
    tab === "users"
      ? usersTabLink()
      : tab === "promos"
        ? "/admin?tab=promos"
        : tab === "settings"
          ? "/admin?tab=settings"
          : "/admin?tab=dashboard";

  const dashboardUserLink = (userId: string) => `/admin?tab=users&user=${encodeURIComponent(userId)}`;
  const dashboardProjectLink = (projectId: string, userId?: string) => {
    const next = new URLSearchParams();

    if (userId) {
      next.set("user", userId);
    }

    const suffix = next.toString();
    return `/admin/projects/${projectId}${suffix ? `?${suffix}` : ""}`;
  };

  const dashboardPaginationLink = (type: "users" | "projects", page: number) => {
    const next = new URLSearchParams();
    next.set("tab", "dashboard");
    next.set("dashUsersPage", String(type === "users" ? page : Number.isFinite(dashboardUsersPageNumber) ? Math.max(1, Math.trunc(dashboardUsersPageNumber)) : 1));
    next.set("dashProjectsPage", String(type === "projects" ? page : Number.isFinite(dashboardProjectsPageNumber) ? Math.max(1, Math.trunc(dashboardProjectsPageNumber)) : 1));
    return `/admin?${next.toString()}`;
  };

  const systemStatus = activeTab === "system" ? await getSystemWorkersSnapshot() : null;

  return (
    <DashboardLayout viewer={viewer}>
      <section>
        <QueryResultToasts
          rules={[
            { param: "success", tone: "success", fallbackTitle: "Операция выполнена" },
            { param: "error", tone: "error", fallbackTitle: "Ошибка операции" },
            { param: "promoSuccess", tone: "success", fallbackTitle: "Операция с промокодом выполнена" },
            { param: "promoError", tone: "error", fallbackTitle: "Ошибка промокода" },
            { param: "settingsSuccess", tone: "success", fallbackTitle: "Настройки сохранены" },
            { param: "settingsError", tone: "error", fallbackTitle: "Ошибка сохранения настроек" },
          ]}
        />
        <h1 className="mb-5 text-[34px] font-extrabold md:text-[46px]">Админ-зона</h1>

        {/* Tab navigation */}
        <div className="mb-6 flex flex-wrap gap-2">
          <ClientNavButton
            href={tabLink("dashboard")}
            className={`min-w-[140px] rounded-full border px-5 py-2 text-center text-[14px] font-semibold transition-colors ${
              activeTab === "dashboard"
                ? "border-black bg-black text-white"
                : "border-[var(--line)] bg-white text-black hover:border-black"
            }`}
          >
            Дашборд
          </ClientNavButton>
          <ClientNavButton
            href={tabLink("users")}
            className={`min-w-[140px] rounded-full border px-5 py-2 text-center text-[14px] font-semibold transition-colors ${
              activeTab === "users"
                ? "border-black bg-black text-white"
                : "border-[var(--line)] bg-white text-black hover:border-black"
            }`}
          >
            Пользователи
          </ClientNavButton>
          <ClientNavButton
            href={tabLink("promos")}
            className={`min-w-[140px] rounded-full border px-5 py-2 text-center text-[14px] font-semibold transition-colors ${
              activeTab === "promos"
                ? "border-black bg-black text-white"
                : "border-[var(--line)] bg-white text-black hover:border-black"
            }`}
          >
            Промокоды
          </ClientNavButton>
          <ClientNavButton
            href={tabLink("settings")}
            className={`min-w-[140px] rounded-full border px-5 py-2 text-center text-[14px] font-semibold transition-colors ${
              activeTab === "settings"
                ? "border-black bg-black text-white"
                : "border-[var(--line)] bg-white text-black hover:border-black"
            }`}
          >
            Настройки
          </ClientNavButton>
          <ClientNavButton
            href="/admin?tab=system"
            className={`min-w-[140px] rounded-full border px-5 py-2 text-center text-[14px] font-semibold transition-colors ${
              activeTab === "system"
                ? "border-black bg-black text-white"
                : "border-[var(--line)] bg-white text-black hover:border-black"
            }`}
          >
            Система
          </ClientNavButton>
        </div>

        {activeTab === "settings" ? (
          <section className="max-w-[760px] space-y-4">
            <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
              <h2 className="mb-4 text-[20px] font-bold">Глобальные настройки</h2>
              <form action={updateGlobalSettingsAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="resultKey" value="settings-save" />
                <label className="text-[13px] font-semibold text-[#444]">
                  Стоимость выполнения проекта (руб)
                  <input
                    name="defaultProjectPriceRub"
                    type="number"
                    min={0}
                    defaultValue={globalSettings?.defaultProjectPriceRub ?? 1488}
                    className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                    required
                  />
                  <span className="mt-1 block text-[11px] font-normal text-[#777]">
                    После сохранения цена обновится у всех проектов со статусом «Новый».
                  </span>
                </label>

                <label className="text-[13px] font-semibold text-[#444]">
                  Старая цена (необязательно)
                  <input
                    name="defaultProjectOldPriceRub"
                    type="number"
                    min={0}
                    defaultValue={globalSettings?.defaultProjectOldPriceRub ?? ""}
                    placeholder="Например, 1990"
                    className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                  />
                  <span className="mt-1 block text-[11px] font-normal text-[#777]">
                    Если поле пустое — старая цена и сообщение акции скрываются у всех.
                  </span>
                </label>

                <label className="col-span-full text-[13px] font-semibold text-[#444]">
                  Сообщение об акции
                  <input
                    name="projectPricePromoMessage"
                    defaultValue={globalSettings?.projectPricePromoMessage ?? ""}
                    placeholder="Например: Весенняя акция — новая цена действует до конца месяца"
                    className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                  />
                </label>

                <div className="rounded-md border border-[var(--line)] bg-white px-3 py-3 text-[12px] text-[#666]">
                  У проектов в статусах «В работе», «Ошибка» и «Выполнен» стоимость не меняется — она остаётся зафиксированной.
                </div>

                <FormPendingButton
                  pendingText="Сохраняем..."
                  resultState={
                    resultKey === "settings-save"
                      ? query.settingsSuccess
                        ? "success"
                        : query.settingsError
                          ? "error"
                          : "idle"
                      : "idle"
                  }
                  className="col-span-full h-11 text-[14px] font-semibold"
                >
                  Сохранить настройки
                </FormPendingButton>
              </form>
            </article>
          </section>
        ) : null}

        {activeTab === "dashboard" && dashboardAnalytics ? (
          <section className="space-y-5">
            {(() => {
              const history = dashboardAnalytics.history.length
                ? dashboardAnalytics.history
                : [
                    {
                      label: "Сейчас",
                      usersTotal: dashboardAnalytics.usersTotal,
                      totalBalanceRub: dashboardAnalytics.totalBalanceRub,
                      projectsWorking: dashboardAnalytics.projects.working,
                    },
                  ];
              const previousPoint = history.length > 1 ? history[history.length - 2] : history[0];
              const balanceTrend = getTrendMeta(dashboardAnalytics.totalBalanceRub, previousPoint.totalBalanceRub);
              const workingTrend = getTrendMeta(dashboardAnalytics.projects.working, previousPoint.projectsWorking);
              const totalProjects =
                dashboardAnalytics.projects.new +
                dashboardAnalytics.projects.working +
                dashboardAnalytics.projects.done +
                dashboardAnalytics.projects.error;
              const statusItems = [
                {
                  key: "Новые",
                  value: dashboardAnalytics.projects.new,
                  color: "#94a3b8",
                  lightColor: "rgba(148, 163, 184, 0.18)",
                },
                {
                  key: "В работе",
                  value: dashboardAnalytics.projects.working,
                  color: "#2563eb",
                  lightColor: "rgba(37, 99, 235, 0.16)",
                },
                {
                  key: "Готово",
                  value: dashboardAnalytics.projects.done,
                  color: "#16a34a",
                  lightColor: "rgba(22, 163, 74, 0.16)",
                },
                {
                  key: "Ошибка",
                  value: dashboardAnalytics.projects.error,
                  color: "#ef4444",
                  lightColor: "rgba(239, 68, 68, 0.16)",
                },
              ];
              const donutBackground = (() => {
                if (!totalProjects) {
                  return "conic-gradient(#e5e7eb 0deg 360deg)";
                }

                let progress = 0;
                const segments = statusItems.map((item) => {
                  const size = (item.value / totalProjects) * 360;
                  const start = progress;
                  progress += size;
                  return `${item.color} ${start}deg ${progress}deg`;
                });

                return `conic-gradient(${segments.join(", ")})`;
              })();

              const balanceChartPoints = buildChartPoints(
                history.map((point) => point.totalBalanceRub),
                720,
                260,
                20,
              );
              const balanceLinePath = buildLinePath(balanceChartPoints);
              const balanceAreaPath = buildAreaPath(balanceChartPoints, 260, 20);
              const cashflow = dashboardAnalytics.cashflow;
              const cashflowMax = Math.max(
                1,
                ...cashflow.flatMap((point) => [point.cashInRub, point.revenueRub, point.promoCostRub]),
              );
              const cashInPoints = buildChartPoints(cashflow.map((point) => point.cashInRub), 720, 260, 20);
              const revenuePoints = buildChartPoints(cashflow.map((point) => point.revenueRub), 720, 260, 20);
              const cashInPath = buildLinePath(cashInPoints);
              const revenuePath = buildLinePath(revenuePoints);
              const dashboardUsersPerPage = 10;
              const dashboardProjectsPerPage = 10;
              const workingUsersTotalPages = Math.max(1, Math.ceil(dashboardAnalytics.workingUsers.length / dashboardUsersPerPage));
              const workingProjectsTotalPages = Math.max(1, Math.ceil(dashboardAnalytics.workingProjects.length / dashboardProjectsPerPage));
              const safeDashboardUsersPage = Math.min(
                Math.max(1, Number.isFinite(dashboardUsersPageNumber) ? Math.trunc(dashboardUsersPageNumber) : 1),
                workingUsersTotalPages,
              );
              const safeDashboardProjectsPage = Math.min(
                Math.max(1, Number.isFinite(dashboardProjectsPageNumber) ? Math.trunc(dashboardProjectsPageNumber) : 1),
                workingProjectsTotalPages,
              );
              const visibleWorkingUsers = dashboardAnalytics.workingUsers.slice(
                (safeDashboardUsersPage - 1) * dashboardUsersPerPage,
                safeDashboardUsersPage * dashboardUsersPerPage,
              );
              const visibleWorkingProjects = dashboardAnalytics.workingProjects.slice(
                (safeDashboardProjectsPage - 1) * dashboardProjectsPerPage,
                safeDashboardProjectsPage * dashboardProjectsPerPage,
              );

              return (
                <>
                  <article className="rounded-[28px] border border-black bg-[var(--panel)] px-5 py-5 md:px-7 md:py-6">
                    <div className="relative grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
                      <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#666]">
                          <span className="h-2 w-2 rounded-full bg-black" />
                          Обновлено <BrowserDateTime value={dashboardAnalytics.collectedAtIso ?? dashboardAnalytics.collectedAt} />
                        </div>
                        <h2 className="max-w-[760px] text-[28px] font-extrabold leading-tight md:text-[40px]">
                          Общий срез системы: пользователи, баланс, нагрузка и быстрый переход к активным сущностям.
                        </h2>
                        <p className="mt-3 max-w-[720px] text-[14px] text-[#666] md:text-[15px]">
                          Следите за динамикой платформы, сразу открывайте активные проекты и быстро переходите к нужным пользователям прямо из дашборда.
                        </p>

                        <div className="mt-5 flex flex-wrap gap-2.5">
                          <ClientNavButton
                            href={tabLink("users")}
                            className="rounded-full border border-black bg-black px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-black/90"
                          >
                            Открыть пользователей
                          </ClientNavButton>
                          <ClientNavButton
                            href={tabLink("promos")}
                            className="rounded-full border border-black/15 bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:border-black"
                          >
                            Управлять промокодами
                          </ClientNavButton>
                          <ClientNavButton
                            href={tabLink("settings")}
                            className="rounded-full border border-black/15 bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:border-black"
                          >
                            Глобальные настройки
                          </ClientNavButton>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div className="rounded-[24px] border border-black/15 bg-white p-4">
                          <p className="text-[12px] text-[#666]">Всего пользователей</p>
                          <p className="mt-2 text-[30px] font-extrabold">{dashboardAnalytics.usersTotal.toLocaleString("ru-RU")}</p>
                          <p className="mt-1 text-[12px] text-[#666]">Активные аккаунты и новые регистрации в одном срезе.</p>
                        </div>
                        <div className="rounded-[24px] border border-black/15 bg-white p-4">
                          <p className="text-[12px] text-[#666]">Баланс системы</p>
                          <p className="mt-2 text-[30px] font-extrabold">
                            {dashboardAnalytics.totalBalanceRub.toLocaleString("ru-RU")} ₽
                          </p>
                          <p className="mt-1 text-[12px] text-[#666]">Сумма средств на балансах пользователей.</p>
                        </div>
                        <div className="rounded-[24px] border border-black/15 bg-white p-4">
                          <p className="text-[12px] text-[#666]">Проектов в работе</p>
                          <p className="mt-2 text-[30px] font-extrabold">{dashboardAnalytics.projects.working.toLocaleString("ru-RU")}</p>
                          <p className="mt-1 text-[12px] text-[#666]">Текущая нагрузка и число запущенных задач.</p>
                        </div>
                        <div className="rounded-[24px] border border-black/15 bg-white p-4">
                          <p className="text-[12px] text-[#666]">Активных пользователей</p>
                          <p className="mt-2 text-[30px] font-extrabold">
                            {dashboardAnalytics.workingUsers.length.toLocaleString("ru-RU")}
                          </p>
                          <p className="mt-1 text-[12px] text-[#666]">Пользователи, у которых прямо сейчас есть работающие проекты.</p>
                        </div>
                      </div>
                    </div>
                  </article>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: "Cash In · 30 дней",
                        value: `${dashboardAnalytics.business.cashIn30d.toLocaleString("ru-RU")} ₽`,
                        trend: balanceTrend,
                        footnote: "Пополнения без промокодов",
                      },
                      {
                        label: "Выручка · 30 дней",
                        value: `${dashboardAnalytics.business.revenue30d.toLocaleString("ru-RU")} ₽`,
                        trend: workingTrend,
                        footnote: `${dashboardAnalytics.business.paidStarts30d.toLocaleString("ru-RU")} платных запусков`,
                      },
                      {
                        label: "Средний чек",
                        value: `${dashboardAnalytics.business.averageCheck30d.toLocaleString("ru-RU")} ₽`,
                        trend: {
                          delta: dashboardAnalytics.business.averageCheck30d,
                          percent: dashboardAnalytics.business.paidStarts30d > 0 ? 100 : 0,
                          tone: dashboardAnalytics.business.averageCheck30d > 0 ? "positive" : "neutral",
                        } as const,
                        footnote: "Средняя выручка на платный запуск",
                      },
                      {
                        label: "Success rate",
                        value: `${dashboardAnalytics.business.successRate30d}%`,
                        trend: {
                          delta: dashboardAnalytics.business.completedProjects30d - dashboardAnalytics.business.errorProjects30d,
                          percent: dashboardAnalytics.business.successRate30d,
                          tone:
                            dashboardAnalytics.business.completedProjects30d >= dashboardAnalytics.business.errorProjects30d
                              ? "positive"
                              : "negative",
                        } as const,
                        footnote: `${dashboardAnalytics.business.completedProjects30d} успешно · ${dashboardAnalytics.business.errorProjects30d} с ошибкой`,
                      },
                    ].map((card) => (
                      <article
                        key={card.label}
                        className="rounded-[24px] border border-black bg-[var(--panel)] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6b7280]">{card.label}</p>
                            <p className="mt-2 text-[28px] font-extrabold text-[#111827]">{card.value}</p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                              card.trend.tone === "positive"
                                ? "bg-[#dcfce7] text-[#166534]"
                                : card.trend.tone === "negative"
                                  ? "bg-[#fee2e2] text-[#991b1b]"
                                  : "bg-[#eef2ff] text-[#4338ca]"
                            }`}
                          >
                            {card.trend.delta > 0 ? "+" : card.trend.delta < 0 ? "−" : "•"}
                            {card.trend.percent}%
                          </span>
                        </div>
                        <p className="mt-3 text-[12px] text-[#6b7280]">{card.footnote}</p>
                      </article>
                    ))}
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                    <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-[22px] font-extrabold text-[#111827]">Баланс системы</h2>
                          <p className="mt-1 text-[13px] text-[#6b7280]">История по последним аналитическим снимкам.</p>
                        </div>
                        <div className="rounded-2xl border border-black/15 bg-white px-3 py-2 text-right">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#666]">Текущее значение</p>
                          <p className="mt-1 text-[20px] font-extrabold text-[#111827]">
                            {dashboardAnalytics.totalBalanceRub.toLocaleString("ru-RU")} ₽
                          </p>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-[24px] border border-black/15 bg-white p-3 md:p-4">
                        <svg viewBox="0 0 720 260" className="h-[240px] w-full">
                          <defs>
                            <linearGradient id="balanceAreaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
                              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.03" />
                            </linearGradient>
                          </defs>

                          {[20, 80, 140, 200].map((y) => (
                            <line key={y} x1="20" y1={y} x2="700" y2={y} stroke="#e5e7eb" strokeDasharray="6 8" />
                          ))}

                          {balanceAreaPath ? <path d={balanceAreaPath} fill="url(#balanceAreaFill)" /> : null}
                          {balanceLinePath ? (
                            <path
                              d={balanceLinePath}
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ) : null}

                          {balanceChartPoints.map((point, index) => (
                            <g key={`${point.x}-${point.y}-${history[index]?.label ?? index}`}>
                              <circle cx={point.x} cy={point.y} r="6" fill="#ffffff" stroke="#2563eb" strokeWidth="3" />
                              <text x={point.x} y="246" textAnchor="middle" fontSize="11" fill="#6b7280">
                                {history[index]?.label}
                              </text>
                            </g>
                          ))}
                        </svg>
                      </div>
                    </article>

                    <div className="grid gap-5">
                      <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                        <div className="mb-5 flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-[22px] font-extrabold text-[#111827]">Бизнес-метрики · 30 дней</h2>
                            <p className="mt-1 text-[13px] text-[#6b7280]">То, что реально помогает управлять продуктом и деньгами.</p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            ["Новые пользователи", dashboardAnalytics.business.newUsers30d],
                            ["Новые проекты", dashboardAnalytics.business.newProjects30d],
                            ["Активные клиенты", dashboardAnalytics.business.activeCustomers30d],
                            ["Платящие клиенты", dashboardAnalytics.business.payingUsers30d],
                            ["Промо-затраты", `${dashboardAnalytics.business.promoCost30d.toLocaleString("ru-RU")} ₽`],
                            ["Проектов завершено", dashboardAnalytics.business.completedProjects30d],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-2xl border border-black/15 bg-white px-4 py-3">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6b7280]">{label}</p>
                              <p className="mt-2 text-[24px] font-extrabold text-[#111827]">{value}</p>
                            </div>
                          ))}
                        </div>
                      </article>

                      <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                        <div className="mb-5 flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-[22px] font-extrabold text-[#111827]">Статусы проектов</h2>
                            <p className="mt-1 text-[13px] text-[#6b7280]">Распределение по текущему состоянию.</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6b7280]">Всего</p>
                            <p className="text-[20px] font-extrabold text-[#111827]">{totalProjects.toLocaleString("ru-RU")}</p>
                          </div>
                        </div>

                        <div className="grid gap-5 md:grid-cols-[180px_1fr] md:items-center">
                          <div className="mx-auto flex h-[180px] w-[180px] items-center justify-center rounded-full" style={{ background: donutBackground }}>
                            <div className="flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full bg-white shadow-inner">
                              <span className="text-[11px] uppercase tracking-[0.16em] text-[#6b7280]">В работе</span>
                              <span className="mt-1 text-[28px] font-extrabold text-[#111827]">
                                {dashboardAnalytics.projects.working}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {statusItems.map((item) => {
                              const width = totalProjects > 0 ? Math.max(5, (item.value / totalProjects) * 100) : 0;

                              return (
                                <div key={item.key} className="rounded-2xl border border-[#eef2f7] bg-[#fbfdff] p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
                                    <div className="flex items-center gap-2 font-semibold text-[#111827]">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                      {item.key}
                                    </div>
                                    <span className="text-[#6b7280]">
                                      {item.value.toLocaleString("ru-RU")} · {totalProjects > 0 ? Math.round((item.value / totalProjects) * 100) : 0}%
                                    </span>
                                  </div>
                                  <div className="h-2.5 rounded-full" style={{ backgroundColor: item.lightColor }}>
                                    <div
                                      className="h-full rounded-full"
                                      style={{ width: `${width}%`, backgroundColor: item.color }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </article>

                      <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-[22px] font-extrabold text-[#111827]">Cashflow и отдача</h2>
                            <p className="mt-1 text-[13px] text-[#6b7280]">Пополнения, выручка по запускам и стоимость промо по дням.</p>
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-[24px] border border-black/15 bg-white p-3 md:p-4">
                          <svg viewBox="0 0 720 260" className="h-[240px] w-full">
                            {[20, 80, 140, 200].map((y) => (
                              <line key={y} x1="20" y1={y} x2="700" y2={y} stroke="#e5e7eb" strokeDasharray="6 8" />
                            ))}
                            {cashflow.map((point, index) => {
                              const barX = 24 + index * 49;
                              const promoHeight = Math.max(2, (point.promoCostRub / cashflowMax) * 170);
                              return (
                                <g key={`${point.label}-${index}`}>
                                  <rect x={barX} y={210 - promoHeight} width="16" height={promoHeight} rx="6" fill="#d9d9d9" />
                                  <text x={barX + 8} y="244" textAnchor="middle" fontSize="10" fill="#6b7280">
                                    {point.label}
                                  </text>
                                </g>
                              );
                            })}
                            {cashInPath ? <path d={cashInPath} fill="none" stroke="#111827" strokeWidth="3.5" strokeLinecap="round" /> : null}
                            {revenuePath ? <path d={revenuePath} fill="none" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" /> : null}
                            {cashInPoints.map((point, index) => (
                              <circle key={`cash-${index}`} cx={point.x} cy={point.y} r="4.5" fill="#111827" />
                            ))}
                            {revenuePoints.map((point, index) => (
                              <circle key={`revenue-${index}`} cx={point.x} cy={point.y} r="4.5" fill="#2563eb" />
                            ))}
                          </svg>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-[#666]">
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#111827]" /> Cash In</span>
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" /> Выручка</span>
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#d9d9d9]" /> Промо-затраты</span>
                        </div>
                      </article>
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
                    <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-[22px] font-extrabold text-[#111827]">Проекты в работе</h2>
                          <p className="mt-1 text-[13px] text-[#6b7280]">Нажмите на карточку, чтобы перейти к проекту.</p>
                        </div>
                        <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-3 py-1 text-[12px] font-semibold text-[#1d4ed8]">
                          {dashboardAnalytics.workingProjects.length}
                        </span>
                      </div>

                      {dashboardAnalytics.workingProjects.length ? (
                        <div className="space-y-3">
                          {visibleWorkingProjects.map((item) => (
                            <ClientNavButton
                              key={item.projectId}
                              href={dashboardProjectLink(item.projectId, item.userId)}
                              className="group block w-full rounded-[22px] border border-[#cfcfcf] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-black hover:bg-[#f9f9f9]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[15px] font-bold text-[#111827]">{item.title}</p>
                                  <p className="mt-1 truncate text-[13px] text-[#6b7280]">{item.fullName} · {item.email}</p>
                                </div>
                                <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8]">
                                  Проект
                                </span>
                              </div>
                            </ClientNavButton>
                          ))}
                          <div className="flex items-center justify-between gap-2 pt-1 text-[12px] text-[#666]">
                            <span>
                              Страница {safeDashboardProjectsPage} из {workingProjectsTotalPages} · Всего: {dashboardAnalytics.workingProjects.length}
                            </span>
                            <div className="flex gap-2">
                              <ClientNavButton
                                href={dashboardPaginationLink("projects", Math.max(1, safeDashboardProjectsPage - 1))}
                                disabled={safeDashboardProjectsPage <= 1}
                                className={`rounded-md border px-3 py-1 font-semibold ${
                                  safeDashboardProjectsPage <= 1
                                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                }`}
                              >
                                Назад
                              </ClientNavButton>
                              <ClientNavButton
                                href={dashboardPaginationLink("projects", Math.min(workingProjectsTotalPages, safeDashboardProjectsPage + 1))}
                                disabled={safeDashboardProjectsPage >= workingProjectsTotalPages}
                                className={`rounded-md border px-3 py-1 font-semibold ${
                                  safeDashboardProjectsPage >= workingProjectsTotalPages
                                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                }`}
                              >
                                Вперёд
                              </ClientNavButton>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[#6d6d6d]">Сейчас нет проектов со статусом «в работе».</p>
                      )}
                    </article>

                    <article className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-[22px] font-extrabold text-[#111827]">Активные пользователи</h2>
                          <p className="mt-1 text-[13px] text-[#6b7280]">Карточки ведут прямо в раздел пользователя.</p>
                        </div>
                        <span className="rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-3 py-1 text-[12px] font-semibold text-[#15803d]">
                          {dashboardAnalytics.workingUsers.length}
                        </span>
                      </div>

                      {dashboardAnalytics.workingUsers.length ? (
                        <div className="space-y-3">
                          {visibleWorkingUsers.map((item) => (
                            <ClientNavButton
                              key={item.userId}
                              href={dashboardUserLink(item.userId)}
                              className="group block w-full rounded-[22px] border border-[#cfcfcf] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-black hover:bg-[#f9f9f9]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[15px] font-bold text-[#111827]">{item.fullName}</p>
                                  <p className="mt-1 truncate text-[13px] text-[#6b7280]">{item.email}</p>
                                </div>
                                <div className="rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] px-3 py-2 text-center">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#15803d]">В работе</p>
                                  <p className="mt-1 text-[18px] font-extrabold text-[#111827]">{item.workingProjects}</p>
                                </div>
                              </div>
                            </ClientNavButton>
                          ))}
                          <div className="flex items-center justify-between gap-2 pt-1 text-[12px] text-[#666]">
                            <span>
                              Страница {safeDashboardUsersPage} из {workingUsersTotalPages} · Всего: {dashboardAnalytics.workingUsers.length}
                            </span>
                            <div className="flex gap-2">
                              <ClientNavButton
                                href={dashboardPaginationLink("users", Math.max(1, safeDashboardUsersPage - 1))}
                                disabled={safeDashboardUsersPage <= 1}
                                className={`rounded-md border px-3 py-1 font-semibold ${
                                  safeDashboardUsersPage <= 1
                                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                }`}
                              >
                                Назад
                              </ClientNavButton>
                              <ClientNavButton
                                href={dashboardPaginationLink("users", Math.min(workingUsersTotalPages, safeDashboardUsersPage + 1))}
                                disabled={safeDashboardUsersPage >= workingUsersTotalPages}
                                className={`rounded-md border px-3 py-1 font-semibold ${
                                  safeDashboardUsersPage >= workingUsersTotalPages
                                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                }`}
                              >
                                Вперёд
                              </ClientNavButton>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[#6d6d6d]">Пользователей с активными проектами пока нет.</p>
                      )}
                    </article>
                  </div>
                </>
              );
            })()}
          </section>
        ) : null}

        {activeTab === "dashboard" && !dashboardAnalytics ? (
          <section className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel)] px-4 py-8 text-center">
            <p className="text-[14px] text-[#666]">
              Аналитика пока недоступна. Выполните `make db-seed` (или `make db-reset && make db-seed`) для применения SQL-скриптов аналитики.
            </p>
          </section>
        ) : null}

        {activeTab === "system" ? (
          <SystemStatusPanel initialData={systemStatus} />
        ) : null}

        {/* ─── USERS TAB ─── */}
        {activeTab === "users" && (
          <>
            <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
              {/* User list */}
              <section className="space-y-5">
                <article className="rounded-xl border border-black bg-[var(--panel)] p-4">
                  <h2 className="mb-3 text-[18px] font-bold">Создать пользователя</h2>
                  <form action={adminCreateUserAction} className="space-y-3">
                    <input type="hidden" name="resultKey" value="users-create" />
                    <label className="block text-[13px] font-semibold text-[#444]">
                      Имя
                      <input
                        name="fullName"
                        placeholder="Например: Иван Петров"
                        className="mt-1.5 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        required
                      />
                    </label>
                    <label className="block text-[13px] font-semibold text-[#444]">
                      E-Mail
                      <input
                        name="email"
                        type="email"
                        placeholder="user@example.com"
                        className="mt-1.5 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        required
                      />
                    </label>
                    <label className="block text-[13px] font-semibold text-[#444]">
                      Пароль
                      <input
                        name="password"
                        type="password"
                        minLength={6}
                        placeholder="Минимум 6 символов"
                        className="mt-1.5 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        required
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <label className="block text-[13px] font-semibold text-[#444]">
                        Роль
                        <select
                          name="role"
                          defaultValue="user"
                          className="mt-1.5 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        >
                          <option value="user">Пользователь</option>
                          <option value="admin">Админ</option>
                        </select>
                      </label>
                      <label className="block text-[13px] font-semibold text-[#444]">
                        Стартовый баланс
                        <input
                          name="balanceRub"
                          type="number"
                          min={0}
                          defaultValue={0}
                          className="mt-1.5 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                          required
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-[13px] font-semibold text-[#444]">
                      <input type="checkbox" name="isActive" defaultChecked className="size-4" />
                      Аккаунт активен
                    </label>
                    <FormPendingButton
                      pendingText="Создаём..."
                      resultState={
                        resultKey === "users-create"
                          ? query.success
                            ? "success"
                            : query.error
                              ? "error"
                              : "idle"
                          : "idle"
                      }
                      className="h-10 w-full text-[13px] font-semibold"
                    >
                      Создать пользователя
                    </FormPendingButton>
                  </form>
                </article>

                <article className="rounded-xl border border-black bg-[var(--panel)] p-4">
                  <h2 className="mb-3 text-[18px] font-bold">Список пользователей</h2>
                <ClientQueryForm action="/admin" successToastTitle="Список пользователей обновлён" className="mb-3 space-y-2">
                  <input type="hidden" name="tab" value="users" />
                  {projectSearch ? <input type="hidden" name="projectQ" value={projectSearch} /> : null}
                  {projectStatusFilter !== "all" ? <input type="hidden" name="projectStatus" value={projectStatusFilter} /> : null}
                  {operationsSearch ? <input type="hidden" name="opQ" value={operationsSearch} /> : null}
                  {operationTypeFilter !== "all" ? <input type="hidden" name="opType" value={operationTypeFilter} /> : null}
                  <input
                    type="search"
                    name="q"
                    defaultValue={usersSearch}
                    placeholder="Поиск по имени или email"
                    className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      name="userRole"
                      defaultValue={usersRoleFilter}
                      className="h-10 rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                    >
                      <option value="all">Все роли</option>
                      <option value="user">Пользователь</option>
                      <option value="admin">Админ</option>
                    </select>
                    <select
                      name="userActive"
                      defaultValue={usersActiveFilter}
                      className="h-10 rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                    >
                      <option value="all">Любой статус</option>
                      <option value="active">Активные</option>
                      <option value="inactive">Неактивные</option>
                    </select>
                  </div>
                  <FormPendingButton pendingText="Ищем..." className="h-9 w-full text-[13px] font-semibold">
                    Найти
                  </FormPendingButton>
                </ClientQueryForm>

                <div className="space-y-2">
                  {users.map((user) => {
                    const isActive = user.id === selectedUserId;
                    return (
                      <ClientNavButton
                        key={user.id}
                        href={usersTabLink({ user: user.id })}
                        className={`block w-full rounded-md border px-3 py-2 text-left ${
                          isActive ? "border-black bg-white" : "border-[#cfcfcf] hover:bg-white/70"
                        }`}
                      >
                        <p className="text-[14px] font-semibold">{user.fullName}</p>
                        <p className="text-[12px] text-[#666]">{user.email}</p>
                        <p className="text-[12px] text-[#888]">
                          {user.role === "admin" ? "Админ" : "Пользователь"} · {user.balanceRub.toLocaleString("ru-RU")} руб.
                        </p>
                      </ClientNavButton>
                    );
                  })}
                </div>

                {users.length === 0 ? (
                  <p className="mt-3 text-[12px] text-[#7a7a7a]">Пользователи не найдены.</p>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-2 text-[12px] text-[#666]">
                  <span>
                    Страница {usersPage.page} из {usersPage.totalPages} · Всего: {usersPage.total}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <ClientNavButton
                    href={usersPage.page > 1 ? usersTabLink({ page: usersPage.page - 1 }) : usersTabLink()}
                    disabled={usersPage.page <= 1}
                    className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                      usersPage.page <= 1
                        ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                        : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                    }`}
                  >
                    Назад
                  </ClientNavButton>
                  <ClientNavButton
                    href={
                      usersPage.page < usersPage.totalPages
                        ? usersTabLink({ page: usersPage.page + 1 })
                        : usersTabLink()
                    }
                    disabled={usersPage.page >= usersPage.totalPages}
                    className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                      usersPage.page >= usersPage.totalPages
                        ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                        : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                    }`}
                  >
                    Вперёд
                  </ClientNavButton>
                </div>
                </article>
              </section>

              {/* User detail */}
              {selected ? (
                <div className="space-y-5">
                  {/* Edit form */}
                  <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                    <h2 className="mb-1 text-[20px] font-bold">{selected.fullName}</h2>
                    <p className="mb-4 text-[12px] text-[#888]">
                      ID: {selected.id} · Зарегистрирован: <BrowserDateTime value={selected.createdAt} />
                    </p>
                    <form key={selected.id} action={adminUpdateUserAction} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="userId" value={selected.id} />
                      <input type="hidden" name="resultKey" value="users-update" />
                      <input type="hidden" name="q" value={usersSearch} />
                      <input type="hidden" name="userRole" value={usersRoleFilter} />
                      <input type="hidden" name="userActive" value={usersActiveFilter} />
                      <input type="hidden" name="page" value={String(usersPage.page)} />
                      <input type="hidden" name="projectQ" value={projectSearch} />
                      <input type="hidden" name="projectStatus" value={projectStatusFilter} />
                      <input type="hidden" name="projectPage" value={String(selected.projectsPage.page)} />
                      <input type="hidden" name="opQ" value={operationsSearch} />
                      <input type="hidden" name="opType" value={operationTypeFilter} />
                      <input type="hidden" name="opPage" value={String(selectedFinance?.page ?? 1)} />
                      <label className="text-[13px] font-semibold text-[#444]">
                        Имя
                        <input
                          name="fullName"
                          defaultValue={selected.fullName}
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                          required
                        />
                      </label>
                      <label className="text-[13px] font-semibold text-[#444]">
                        E-Mail
                        <input
                          name="email"
                          defaultValue={selected.email}
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                          required
                        />
                      </label>
                      <label className="text-[13px] font-semibold text-[#444]">
                        Роль
                        <select
                          name="role"
                          defaultValue={selected.role}
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        >
                          <option value="user">Пользователь</option>
                          <option value="admin">Админ</option>
                        </select>
                      </label>
                      <label className="col-span-full text-[13px] font-semibold text-[#444]">
                        Новый пароль (необязательно)
                        <input
                          name="newPassword"
                          type="password"
                          minLength={6}
                          placeholder="Оставьте пустым, чтобы не менять"
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        />
                      </label>
                      <label className="col-span-full flex items-center gap-2 text-[13px] font-semibold text-[#444]">
                        <input type="checkbox" name="isActive" defaultChecked={selected.isActive} className="size-4" />
                        Аккаунт активен
                      </label>
                      <FormPendingButton
                        pendingText="Сохраняем..."
                        resultState={
                          resultKey === "users-update"
                            ? query.success
                              ? "success"
                              : query.error
                                ? "error"
                                : "idle"
                            : "idle"
                        }
                        className="col-span-full h-11 text-[14px] font-semibold"
                      >
                        Сохранить изменения
                      </FormPendingButton>
                    </form>
                  </article>

                  <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                    <h2 className="mb-3 text-[18px] font-bold">Операции по балансу</h2>
                    <form action={adminCreateBalanceOperationAction} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="userId" value={selected.id} />
                      <input type="hidden" name="resultKey" value="users-balance" />
                      <input type="hidden" name="q" value={usersSearch} />
                      <input type="hidden" name="userRole" value={usersRoleFilter} />
                      <input type="hidden" name="userActive" value={usersActiveFilter} />
                      <input type="hidden" name="projectQ" value={projectSearch} />
                      <input type="hidden" name="projectStatus" value={projectStatusFilter} />
                      <input type="hidden" name="projectPage" value={String(selected.projectsPage.page)} />
                      <input type="hidden" name="opQ" value={operationsSearch} />
                      <input type="hidden" name="opType" value={operationTypeFilter} />
                      <input type="hidden" name="opPage" value={String(selectedFinance?.page ?? 1)} />
                      <input type="hidden" name="page" value={String(usersPage.page)} />

                      <label className="text-[13px] font-semibold text-[#444]">
                        Тип операции
                        <select
                          name="operationType"
                          defaultValue="Пополнение"
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        >
                          <option value="Пополнение">Пополнение</option>
                          <option value="Списание">Списание</option>
                        </select>
                      </label>

                      <label className="text-[13px] font-semibold text-[#444]">
                        Сумма (руб)
                        <input
                          name="amountRub"
                          type="number"
                          min={1}
                          placeholder="Например, 500"
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                          required
                        />
                      </label>

                      <label className="text-[13px] font-semibold text-[#444]">
                        Источник
                        <input
                          name="source"
                          placeholder="Банк, касса, корректировка и т.д."
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        />
                      </label>

                      <label className="text-[13px] font-semibold text-[#444]">
                        Кем инициировано
                        <input
                          name="performedBy"
                          placeholder="Например: менеджер Иванов"
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        />
                      </label>

                      <label className="col-span-full text-[13px] font-semibold text-[#444]">
                        Комментарий
                        <input
                          name="comment"
                          placeholder="Произвольный комментарий"
                          className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                        />
                      </label>

                      <FormPendingButton
                        pendingText="Добавляем..."
                        resultState={
                          resultKey === "users-balance"
                            ? query.success
                              ? "success"
                              : query.error
                                ? "error"
                                : "idle"
                            : "idle"
                        }
                        className="col-span-full h-11 text-[14px] font-semibold"
                      >
                        Добавить операцию
                      </FormPendingButton>
                    </form>
                  </article>

                  <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-[18px] font-bold">История операций</h2>
                    </div>

                    {selectedFinance ? (
                      <div className="mb-4 rounded-xl border border-black bg-white px-4 py-4">
                        <p className="text-[12px] uppercase tracking-[0.16em] text-[#666]">Текущий баланс</p>
                        <p className="mt-2 text-[28px] font-extrabold md:text-[34px]">
                          {selectedFinance.balanceRub.toLocaleString("ru-RU")} руб.
                        </p>
                      </div>
                    ) : null}

                    <ClientQueryForm
                      action="/admin"
                      successToastTitle="История операций обновлена"
                      className="mb-3 space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0"
                    >
                      <input type="hidden" name="tab" value="users" />
                      <input type="hidden" name="user" value={selected.id} />
                      <input type="hidden" name="page" value={String(usersPage.page)} />
                      {usersSearch ? <input type="hidden" name="q" value={usersSearch} /> : null}
                      {usersRoleFilter !== "all" ? <input type="hidden" name="userRole" value={usersRoleFilter} /> : null}
                      {usersActiveFilter !== "all" ? <input type="hidden" name="userActive" value={usersActiveFilter} /> : null}
                      {projectSearch ? <input type="hidden" name="projectQ" value={projectSearch} /> : null}
                      {projectStatusFilter !== "all" ? <input type="hidden" name="projectStatus" value={projectStatusFilter} /> : null}
                      <input type="hidden" name="projectPage" value={String(selected.projectsPage.page)} />
                      <input
                        type="search"
                        name="opQ"
                        defaultValue={operationsSearch}
                        placeholder="Поиск: сумма, комментарий, тип, назначение"
                        className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                      />
                      <select
                        name="opType"
                        defaultValue={operationTypeFilter}
                        className="h-10 rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                      >
                        <option value="all">Все типы</option>
                        <option value="Пополнение">Пополнение</option>
                        <option value="Списание">Списание</option>
                      </select>
                      <FormPendingButton pendingText="Ищем..." className="h-10 shrink-0 px-4 text-[13px] font-semibold">
                        Найти
                      </FormPendingButton>
                    </ClientQueryForm>

                    {selectedFinance?.operations.length ? (
                      <div className="space-y-2">
                        {selectedFinance.operations.map((operation) => (
                          <div key={operation.id} className="rounded-md border border-[var(--line)] bg-white px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-black">{operation.type}</p>
                                <p className="truncate text-[12px] text-[#666]">{operation.note}</p>
                              </div>
                              <p
                                className={`shrink-0 text-[13px] font-semibold ${
                                  operation.type === "Пополнение" ? "text-[#35723a]" : "text-[#8c3a3a]"
                                }`}
                              >
                                {operation.amount}
                              </p>
                            </div>
                            <p className="mt-1 text-[11px] text-[#8a8a8a]"><BrowserDateTime value={operation.date} /></p>
                          </div>
                        ))}

                        {(() => {
                          const buildOperationsLink = (targetPage: number) => {
                            const next = new URLSearchParams();
                            next.set("tab", "users");
                            next.set("user", selected.id);
                            next.set("page", String(usersPage.page));
                            next.set("opPage", String(targetPage));
                            if (usersSearch) {
                              next.set("q", usersSearch);
                            }
                            if (usersRoleFilter !== "all") {
                              next.set("userRole", usersRoleFilter);
                            }
                            if (usersActiveFilter !== "all") {
                              next.set("userActive", usersActiveFilter);
                            }
                            if (projectSearch) {
                              next.set("projectQ", projectSearch);
                            }
                            if (projectStatusFilter !== "all") {
                              next.set("projectStatus", projectStatusFilter);
                            }
                            next.set("projectPage", String(selected.projectsPage.page));
                            if (operationsSearch) {
                              next.set("opQ", operationsSearch);
                            }
                            if (operationTypeFilter !== "all") {
                              next.set("opType", operationTypeFilter);
                            }
                            return `/admin?${next.toString()}`;
                          };

                          return (
                            <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-[#666]">
                              <span>
                                Страница {selectedFinance.page} из {selectedFinance.totalPages} · Всего: {selectedFinance.total}
                              </span>
                              <div className="flex items-center gap-2">
                                <ClientNavButton
                                  href={
                                    selectedFinance.page > 1
                                      ? buildOperationsLink(selectedFinance.page - 1)
                                      : buildOperationsLink(selectedFinance.page)
                                  }
                                  disabled={selectedFinance.page <= 1}
                                  className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                                    selectedFinance.page <= 1
                                      ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                      : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                  }`}
                                >
                                  Назад
                                </ClientNavButton>
                                <ClientNavButton
                                  href={
                                    selectedFinance.page < selectedFinance.totalPages
                                      ? buildOperationsLink(selectedFinance.page + 1)
                                      : buildOperationsLink(selectedFinance.page)
                                  }
                                  disabled={selectedFinance.page >= selectedFinance.totalPages}
                                  className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                                    selectedFinance.page >= selectedFinance.totalPages
                                      ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                      : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                  }`}
                                >
                                  Вперёд
                                </ClientNavButton>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <p className="text-[13px] text-[#6d6d6d]">
                        {operationsSearch ? "По этому запросу операций не найдено." : "Операций по балансу пока нет."}
                      </p>
                    )}
                  </article>

                  {/* Projects */}
                  <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-[18px] font-bold">Проекты</h2>
                      <span className="text-[12px] text-[#666]">{selected.projectsPage.total} найдено</span>
                    </div>
                    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start">
                      <ClientQueryForm
                        action="/admin"
                        successToastTitle="Список проектов обновлён"
                        className="flex flex-1 flex-col gap-2 sm:flex-row"
                      >
                        <input type="hidden" name="tab" value="users" />
                        <input type="hidden" name="user" value={selected.id} />
                        <input type="hidden" name="page" value={String(usersPage.page)} />
                        {usersSearch ? <input type="hidden" name="q" value={usersSearch} /> : null}
                        {usersRoleFilter !== "all" ? <input type="hidden" name="userRole" value={usersRoleFilter} /> : null}
                        {usersActiveFilter !== "all" ? <input type="hidden" name="userActive" value={usersActiveFilter} /> : null}
                        {operationsSearch ? <input type="hidden" name="opQ" value={operationsSearch} /> : null}
                        {operationTypeFilter !== "all" ? <input type="hidden" name="opType" value={operationTypeFilter} /> : null}
                        <input type="hidden" name="opPage" value={String(selectedFinance?.page ?? 1)} />
                        <input
                          type="search"
                          name="projectQ"
                          defaultValue={projectSearch}
                          placeholder="Поиск проекта по названию"
                          className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        />
                        <select
                          name="projectStatus"
                          defaultValue={projectStatusFilter}
                          className="h-10 rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[13px] outline-none"
                        >
                          <option value="all">Все статусы</option>
                          <option value="new">Новый</option>
                          <option value="working">В работе</option>
                          <option value="done">Выполнен</option>
                          <option value="error">Ошибка</option>
                        </select>
                        <FormPendingButton pendingText="Ищем..." className="h-10 px-4 text-[13px] font-semibold">
                          Найти
                        </FormPendingButton>
                      </ClientQueryForm>

                      <form action={adminCreateProjectForUserAction} className="lg:ml-3">
                        <input type="hidden" name="userId" value={selected.id} />
                        <input type="hidden" name="q" value={usersSearch} />
                        <input type="hidden" name="userRole" value={usersRoleFilter} />
                        <input type="hidden" name="userActive" value={usersActiveFilter} />
                        <input type="hidden" name="projectQ" value={projectSearch} />
                        <input type="hidden" name="projectStatus" value={projectStatusFilter} />
                        <input type="hidden" name="projectPage" value={String(selected.projectsPage.page)} />
                        <input type="hidden" name="opQ" value={operationsSearch} />
                        <input type="hidden" name="opType" value={operationTypeFilter} />
                        <input type="hidden" name="opPage" value={String(selectedFinance?.page ?? 1)} />
                        <input type="hidden" name="page" value={String(usersPage.page)} />
                        <FormPendingButton
                          pendingText="Создаём..."
                          className="h-10 w-full px-4 text-[13px] font-semibold lg:w-auto"
                        >
                          Создать проект пользователю
                        </FormPendingButton>
                      </form>
                    </div>

                    {selected.projects.length ? (
                      <div className="space-y-2">
                        {selected.projects.map((project) => (
                          <ClientNavButton
                            key={project.id}
                            href={`/admin/projects/${project.id}?user=${selected.id}${
                              usersSearch ? `&q=${encodeURIComponent(usersSearch)}` : ""
                            }${usersRoleFilter !== "all" ? `&userRole=${encodeURIComponent(usersRoleFilter)}` : ""}${
                              usersActiveFilter !== "all" ? `&userActive=${encodeURIComponent(usersActiveFilter)}` : ""
                            }${projectSearch ? `&projectQ=${encodeURIComponent(projectSearch)}` : ""}${
                              projectStatusFilter !== "all" ? `&projectStatus=${encodeURIComponent(projectStatusFilter)}` : ""
                            }&projectPage=${selected.projectsPage.page}${
                              operationsSearch ? `&opQ=${encodeURIComponent(operationsSearch)}` : ""
                            }${operationTypeFilter !== "all" ? `&opType=${encodeURIComponent(operationTypeFilter)}` : ""}&opPage=${selectedFinance?.page ?? 1}&page=${usersPage.page}`}
                            className="flex w-full items-center justify-between gap-3 rounded-md border border-[#cfcfcf] bg-white px-3 py-2 text-left hover:border-black hover:bg-[#f9f9f9]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold">{project.title}</p>
                              <div className="mt-1 flex items-center gap-2">
                                <Badge color={statusBadge[project.status].color}>{statusBadge[project.status].label}</Badge>
                                <p className="text-[12px] text-[#666]">{project.updatedText}</p>
                              </div>
                            </div>
                            <span className="shrink-0 text-[12px] font-semibold text-[#444]">Открыть</span>
                          </ClientNavButton>
                        ))}

                        {(() => {
                          const buildProjectsLink = (targetPage: number) => {
                            const next = new URLSearchParams();
                            next.set("tab", "users");
                            next.set("user", selected.id);
                            next.set("page", String(usersPage.page));
                            next.set("projectPage", String(targetPage));
                            if (usersSearch) next.set("q", usersSearch);
                            if (usersRoleFilter !== "all") next.set("userRole", usersRoleFilter);
                            if (usersActiveFilter !== "all") next.set("userActive", usersActiveFilter);
                            if (projectSearch) next.set("projectQ", projectSearch);
                            if (projectStatusFilter !== "all") next.set("projectStatus", projectStatusFilter);
                            if (operationsSearch) next.set("opQ", operationsSearch);
                            if (operationTypeFilter !== "all") next.set("opType", operationTypeFilter);
                            next.set("opPage", String(selectedFinance?.page ?? 1));
                            return `/admin?${next.toString()}`;
                          };

                          return (
                            <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-[#666]">
                              <span>
                                Страница {selected.projectsPage.page} из {selected.projectsPage.totalPages} · Всего: {selected.projectsPage.total}
                              </span>
                              <div className="flex items-center gap-2">
                                <ClientNavButton
                                  href={
                                    selected.projectsPage.page > 1
                                      ? buildProjectsLink(selected.projectsPage.page - 1)
                                      : buildProjectsLink(selected.projectsPage.page)
                                  }
                                  disabled={selected.projectsPage.page <= 1}
                                  className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                                    selected.projectsPage.page <= 1
                                      ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                      : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                  }`}
                                >
                                  Назад
                                </ClientNavButton>
                                <ClientNavButton
                                  href={
                                    selected.projectsPage.page < selected.projectsPage.totalPages
                                      ? buildProjectsLink(selected.projectsPage.page + 1)
                                      : buildProjectsLink(selected.projectsPage.page)
                                  }
                                  disabled={selected.projectsPage.page >= selected.projectsPage.totalPages}
                                  className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                                    selected.projectsPage.page >= selected.projectsPage.totalPages
                                      ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                                      : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                                  }`}
                                >
                                  Вперёд
                                </ClientNavButton>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <p className="text-[13px] text-[#6d6d6d]">
                        {projectSearch || projectStatusFilter !== "all"
                          ? "Проекты по этому фильтру не найдены."
                          : "У пользователя пока нет проектов."}
                      </p>
                    )}
                  </article>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-[#cfcfcf] px-3 py-6 text-center text-[13px] text-[#8d8d8d]">
                  Выберите пользователя слева
                </p>
              )}
            </div>
          </>
        )}

        {/* ─── PROMOS TAB ─── */}
        {activeTab === "promos" && (
          <>
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              {/* Create form */}
              <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                <h2 className="mb-4 text-[20px] font-bold">Создать промокод</h2>
                <form action={createPromoCodeAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="resultKey" value="promo-create" />
                  <label className="col-span-full text-[13px] font-semibold text-[#444]">
                    Код
                    <input
                      name="code"
                      placeholder="Например: BONUS500"
                      className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] uppercase outline-none placeholder:normal-case"
                      required
                    />
                  </label>
                  <label className="text-[13px] font-semibold text-[#444]">
                    Сумма (руб)
                    <input
                      name="amountRub"
                      type="number"
                      min={1}
                      placeholder="500"
                      className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                      required
                    />
                  </label>
                  <label className="text-[13px] font-semibold text-[#444]">
                    Лимит активаций
                    <input
                      name="maxActivations"
                      type="number"
                      min={0}
                      placeholder="Пусто или 0 = без лимита"
                      className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-[#777]">Если поле пустое — лимит считается бесконечным.</span>
                  </label>
                  <label className="col-span-full text-[13px] font-semibold text-[#444]">
                    Действует до
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_150px]">
                      <div className="relative">
                        <input
                          name="expiresAt"
                          type="datetime-local"
                          className="h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 pr-10 text-[14px] outline-none"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[16px]">📅</span>
                      </div>
                      <input
                        name="expiresTimeZone"
                        defaultValue="+03:00"
                        placeholder="+03:00"
                        className="h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
                      />
                    </div>
                    <span className="mt-1 block text-[11px] font-normal text-[#777]">
                      Если дата пустая — промокод бессрочный. Для даты укажите смещение в формате +/-ЧЧ:ММ.
                    </span>
                  </label>
                  <FormPendingButton
                    pendingText="Создаём..."
                    resultState={
                      resultKey === "promo-create"
                        ? query.promoSuccess
                          ? "success"
                          : query.promoError
                            ? "error"
                            : "idle"
                        : "idle"
                    }
                    className="col-span-full h-11 text-[14px] font-semibold"
                  >
                    Создать промокод
                  </FormPendingButton>
                </form>
              </article>

              {/* Promo list */}
              <article className="rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
                <h2 className="mb-4 text-[20px] font-bold">Все промокоды</h2>
                {promoCodes.length ? (
                  <div className="space-y-2">
                    {promoCodes.map((promo) => (
                      <div key={promo.id} className="rounded-md border border-[#cfcfcf] bg-white px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[14px] font-bold tracking-wider">{promo.code}</p>
                            <p className="mt-0.5 text-[12px] text-[#555]">
                              +{promo.amountRub.toLocaleString("ru-RU")} руб.
                            </p>
                            <p className="text-[12px] text-[#888]">
                              {promo.expiresAt ? <BrowserDateTime value={promo.expiresAt} /> : "Бессрочно"}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Активировали</p>
                                <p className="mt-1 text-[15px] font-bold text-[#111827]">{promo.usedActivations}</p>
                              </div>
                              <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Осталось активаций</p>
                                <p className="mt-1 text-[15px] font-bold text-[#111827]">
                                  {promo.maxActivations === 0
                                    ? "∞"
                                    : Math.max(0, promo.maxActivations - promo.usedActivations).toLocaleString("ru-RU")}
                                </p>
                              </div>
                              <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Начислено всего</p>
                                <p className="mt-1 text-[15px] font-bold text-[#111827]">
                                  {promo.totalCreditedRub.toLocaleString("ru-RU")} руб.
                                </p>
                              </div>
                            </div>
                            <p className="mt-2 text-[12px] text-[#666]">
                              Последняя активация: {promo.lastActivatedAt ? <BrowserDateTime value={promo.lastActivatedAt} /> : "ещё не использовался"}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                promo.isActive
                                  ? "bg-[#efffea] text-[#35723a]"
                                  : "bg-[#f5f5f5] text-[#888]"
                              }`}
                            >
                              {promo.isActive ? "Активен" : "Неактивен"}
                            </span>
                            {promo.isActive ? (
                              <form action={deactivatePromoCodeAction}>
                                <input type="hidden" name="promoId" value={promo.id} />
                                <input type="hidden" name="resultKey" value={`promo-deactivate-${promo.id}`} />
                                <FormPendingButton
                                  variant="light"
                                  pendingText="..."
                                  resultState={
                                    resultKey === `promo-deactivate-${promo.id}`
                                      ? query.promoSuccess
                                        ? "success"
                                        : query.promoError
                                          ? "error"
                                          : "idle"
                                      : "idle"
                                  }
                                  className="h-auto rounded-md border-[#e5b0b0] px-2.5 py-1 text-[11px] font-semibold text-[#8c3a3a] hover:bg-[#ffeaea]"
                                >
                                  Деактивировать
                                </FormPendingButton>
                              </form>
                            ) : (
                              <>
                                <form action={reactivatePromoCodeAction}>
                                  <input type="hidden" name="promoId" value={promo.id} />
                                  <input type="hidden" name="resultKey" value={`promo-reactivate-${promo.id}`} />
                                  <FormPendingButton
                                    variant="light"
                                    pendingText="..."
                                    resultState={
                                      resultKey === `promo-reactivate-${promo.id}`
                                        ? query.promoSuccess
                                          ? "success"
                                          : query.promoError
                                            ? "error"
                                            : "idle"
                                        : "idle"
                                    }
                                    className="h-auto rounded-md border-[#9ac7ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8] hover:bg-[#eff6ff]"
                                  >
                                    Активировать
                                  </FormPendingButton>
                                </form>
                                <form action={deletePromoCodeAction}>
                                  <input type="hidden" name="promoId" value={promo.id} />
                                  <input type="hidden" name="resultKey" value={`promo-delete-${promo.id}`} />
                                  <FormPendingButton
                                    variant="light"
                                    pendingText="..."
                                    resultState={
                                      resultKey === `promo-delete-${promo.id}`
                                        ? query.promoSuccess
                                          ? "success"
                                          : query.promoError
                                            ? "error"
                                            : "idle"
                                        : "idle"
                                    }
                                    className="h-auto rounded-md border-[#e5b0b0] px-2.5 py-1 text-[11px] font-semibold text-[#8c3a3a] hover:bg-[#ffeaea]"
                                  >
                                    Удалить
                                  </FormPendingButton>
                                </form>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-[#6d6d6d]">Промокоды пока не созданы.</p>
                )}
              </article>
            </div>
          </>
        )}
      </section>
    </DashboardLayout>
  );
}
