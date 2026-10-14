"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearUserSession, createUserSession, getCurrentViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  activatePromoCodeByUser,
  activatePromoCodeByAdmin,
  adminCreateBalanceOperation,
  adminCreateUser,
  adminCreateProjectForUser,
  adminTransferProject,
  createDraftProject,
  adminUpdateUser,
  createPromoCodeByAdmin,
  deletePromoCodeByAdmin,
  duplicateProject,
  deactivatePromoCodeByAdmin,
  deleteProject,
  stopProject,
  startProject,
  updateGlobalSettings,
  updateProfileByUser,
  updateProjectDraft,
} from "@/lib/repositories";

type ClientActionResult = {
  ok: boolean;
  error?: string;
  success?: string;
  redirectTo?: string;
};

type LoginRow = {
  id: string;
  password_hash: string;
  is_active: boolean;
};

export async function loginAction(_: ClientActionResult, formData: FormData): Promise<ClientActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Заполните email и пароль" };
  }

  const result = await query<LoginRow>(
    `SELECT id, password_hash, is_active
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email],
  );

  const user = result.rows[0];
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    return { ok: false, error: "Неверные данные для входа" };
  }

  await createUserSession(user.id);
  return { ok: true, redirectTo: "/projects" };
}

export async function registerAction(_: ClientActionResult, formData: FormData): Promise<ClientActionResult> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const repeatPassword = String(formData.get("repeatPassword") ?? "");
  const consentRaw = String(formData.get("consent") ?? "").trim().toLowerCase();
  const consentAccepted = consentRaw === "on" || consentRaw === "true" || consentRaw === "1";

  if (!fullName || !email || !password || !repeatPassword) {
    return { ok: false, error: "Заполните все поля" };
  }

  if (password.length < 6) {
    return { ok: false, error: "Пароль должен быть не короче 6 символов" };
  }

  if (password !== repeatPassword) {
    return { ok: false, error: "Пароли не совпадают" };
  }

  if (!consentAccepted) {
    return { ok: false, error: "Необходимо дать согласие" };
  }

  const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
  if (existing.rows[0]) {
    return { ok: false, error: "Пользователь с таким email уже существует" };
  }

  const created = await query<{ id: string }>(
    `INSERT INTO users (full_name, email, password_hash, role, balance_rub)
     VALUES ($1, $2, $3, 'user', 0)
     RETURNING id`,
    [fullName, email, hashPassword(password)],
  );

  const userId = created.rows[0].id;

  await query(
      `INSERT INTO user_consents (user_id, consent_text)
       VALUES ($1, 'Даю согласие с политикой конфиденциальности и офертой')
     ON CONFLICT (user_id, consent_text) DO NOTHING`,
    [userId],
  );

  await createUserSession(userId);
  return { ok: true, redirectTo: "/projects" };
}

export async function logoutAction() {
  await clearUserSession();
  redirect("/login");
}

export async function updateProfileAction(_: ClientActionResult, formData: FormData): Promise<ClientActionResult> {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false, error: "Требуется повторный вход", redirectTo: "/login" };
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const repeatPassword = String(formData.get("repeatPassword") ?? "");

  if (!fullName || !email) {
    return { ok: false, error: "Имя и email обязательны" };
  }

  if ((newPassword || repeatPassword) && newPassword !== repeatPassword) {
    return { ok: false, error: "Пароли не совпадают" };
  }

  const passwordHash = newPassword ? hashPassword(newPassword) : undefined;

  await updateProfileByUser(viewer.id, {
    fullName,
    email,
    passwordHash,
  });

  revalidatePath("/settings");
  return { ok: true, success: "Сохранено" };
}

export async function activatePromoCodeAction(_: ClientActionResult, formData: FormData): Promise<ClientActionResult> {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false, error: "Требуется повторный вход", redirectTo: "/login" };
  }

  const promoCode = String(formData.get("promoCode") ?? "");
  const result = await activatePromoCodeByUser(viewer.id, promoCode);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/finance");
  return { ok: true, success: "Промокод активирован" };
}

export async function createDraftProjectAction() {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false as const, error: "Требуется повторный вход", redirectTo: "/login" };
  }

  const projectId = await createDraftProject(viewer.id);

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);

  return { ok: true as const, projectId };
}

export async function createPromoCodeAction(formData: FormData) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    redirect("/projects");
  }

  const code = String(formData.get("code") ?? "");
  const amountRub = Number(formData.get("amountRub") ?? 0);
  const rawMaxActivations = String(formData.get("maxActivations") ?? "").trim();
  const maxActivations = rawMaxActivations === "" ? 0 : Number(rawMaxActivations);
  const expiresAt = String(formData.get("expiresAt") ?? "");
  const expiresTimeZone = String(formData.get("expiresTimeZone") ?? "");
  const resultKey = String(formData.get("resultKey") ?? "").trim();

  const result = await createPromoCodeByAdmin(viewer.id, {
    code,
    amountRub,
    maxActivations,
    expiresAt,
    expiresTimeZone,
  });

  if (!result.ok) {
    redirect(`/admin?tab=promos&promoError=${encodeURIComponent(result.error)}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?tab=promos&promoSuccess=${encodeURIComponent("Промокод создан")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function adminCreateUserAction(formData: FormData) {
  const admin = await getCurrentViewer();
  if (!admin || admin.role !== "admin") {
    redirect("/projects");
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "user") === "admin" ? "admin" : "user";
  const balanceRub = Number(formData.get("balanceRub") ?? 0);
  const isActive = String(formData.get("isActive") ?? "") === "on";
  const resultKey = String(formData.get("resultKey") ?? "").trim();

  if (!fullName || !email || !password) {
    redirect(`/admin?tab=users&error=${encodeURIComponent("Заполните имя, email и пароль")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  if (password.length < 6) {
    redirect(`/admin?tab=users&error=${encodeURIComponent("Пароль должен быть не короче 6 символов")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  const result = await adminCreateUser(admin, {
    fullName,
    email,
    passwordHash: hashPassword(password),
    role,
    balanceRub,
    isActive,
  });

  if (!result.ok) {
    redirect(`/admin?tab=users&error=${encodeURIComponent(result.error)}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?tab=users&user=${encodeURIComponent(result.userId)}&success=${encodeURIComponent("Пользователь создан")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function deactivatePromoCodeAction(formData: FormData) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    redirect("/projects");
  }

  const promoId = String(formData.get("promoId") ?? "");
  const resultKey = String(formData.get("resultKey") ?? "").trim();
  const result = await deactivatePromoCodeByAdmin(promoId);
  if (!result.ok) {
    redirect(`/admin?tab=promos&promoError=${encodeURIComponent(result.error)}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?tab=promos&promoSuccess=${encodeURIComponent("Промокод деактивирован")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function reactivatePromoCodeAction(formData: FormData) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    redirect("/projects");
  }

  const promoId = String(formData.get("promoId") ?? "");
  const resultKey = String(formData.get("resultKey") ?? "").trim();
  const result = await activatePromoCodeByAdmin(promoId);
  if (!result.ok) {
    redirect(`/admin?tab=promos&promoError=${encodeURIComponent(result.error)}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?tab=promos&promoSuccess=${encodeURIComponent("Промокод активирован")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function deletePromoCodeAction(formData: FormData) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    redirect("/projects");
  }

  const promoId = String(formData.get("promoId") ?? "");
  const resultKey = String(formData.get("resultKey") ?? "").trim();
  const result = await deletePromoCodeByAdmin(promoId);
  if (!result.ok) {
    redirect(`/admin?tab=promos&promoError=${encodeURIComponent(result.error)}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?tab=promos&promoSuccess=${encodeURIComponent("Промокод удалён")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function adminUpdateUserAction(formData: FormData) {
  const admin = await getCurrentViewer();
  if (!admin || admin.role !== "admin") {
    redirect("/projects");
  }

  const id = String(formData.get("userId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "user") === "admin" ? "admin" : "user";
  const isActive = String(formData.get("isActive") ?? "") === "on";
  const newPassword = String(formData.get("newPassword") ?? "").trim();
  const usersSearch = String(formData.get("q") ?? "").trim();
  const usersRole = String(formData.get("userRole") ?? "").trim();
  const usersActive = String(formData.get("userActive") ?? "").trim();
  const page = String(formData.get("page") ?? "1").trim();
  const projectSearch = String(formData.get("projectQ") ?? "").trim();
  const projectStatus = String(formData.get("projectStatus") ?? "").trim();
  const projectPage = String(formData.get("projectPage") ?? "1").trim();
  const operationSearch = String(formData.get("opQ") ?? "").trim();
  const operationType = String(formData.get("opType") ?? "").trim();
  const operationPage = String(formData.get("opPage") ?? "1").trim();
  const resultKey = String(formData.get("resultKey") ?? "").trim();

  const backParams = new URLSearchParams();
  backParams.set("tab", "users");
  backParams.set("user", id);
  if (usersSearch) backParams.set("q", usersSearch);
  if (usersRole) backParams.set("userRole", usersRole);
  if (usersActive) backParams.set("userActive", usersActive);
  if (page) backParams.set("page", page);
  if (projectSearch) backParams.set("projectQ", projectSearch);
  if (projectStatus) backParams.set("projectStatus", projectStatus);
  if (projectPage) backParams.set("projectPage", projectPage);
  if (operationSearch) backParams.set("opQ", operationSearch);
  if (operationType) backParams.set("opType", operationType);
  if (operationPage) backParams.set("opPage", operationPage);
  if (resultKey) backParams.set("resultKey", resultKey);

  if (!fullName || !email) {
    backParams.set("error", "Заполните имя и email");
    redirect(`/admin?${backParams.toString()}`);
  }

  if (newPassword && newPassword.length < 6) {
    backParams.set("error", "Пароль должен быть не короче 6 символов");
    redirect(`/admin?${backParams.toString()}`);
  }

  try {
    await adminUpdateUser(admin, id, {
      fullName,
      email,
      role,
      isActive,
      passwordHash: newPassword ? hashPassword(newPassword) : undefined,
    });
  } catch (error) {
    const maybePgError = error as { code?: string };
    if (maybePgError?.code === "23505") {
      backParams.set("error", "Пользователь с таким email уже существует");
      redirect(`/admin?${backParams.toString()}`);
    }

    backParams.set("error", "Не удалось сохранить пользователя");
    redirect(`/admin?${backParams.toString()}`);
  }

  revalidatePath("/admin");
  backParams.set("success", "Сохранено");
  redirect(`/admin?${backParams.toString()}`);
}

export async function adminCreateBalanceOperationAction(formData: FormData) {
  const admin = await getCurrentViewer();
  if (!admin || admin.role !== "admin") {
    redirect("/projects");
  }

  const userId = String(formData.get("userId") ?? "").trim();
  const usersSearch = String(formData.get("q") ?? "").trim();
  const usersRole = String(formData.get("userRole") ?? "").trim();
  const usersActive = String(formData.get("userActive") ?? "").trim();
  const projectSearch = String(formData.get("projectQ") ?? "").trim();
  const projectStatus = String(formData.get("projectStatus") ?? "").trim();
  const projectPage = String(formData.get("projectPage") ?? "1").trim();
  const operationSearch = String(formData.get("opQ") ?? "").trim();
  const operationTypeFilter = String(formData.get("opType") ?? "").trim();
  const operationPage = String(formData.get("opPage") ?? "1").trim();
  const page = String(formData.get("page") ?? "1").trim();
  const resultKey = String(formData.get("resultKey") ?? "").trim();

  const backParams = new URLSearchParams();
  backParams.set("tab", "users");
  if (userId) {
    backParams.set("user", userId);
  }
  if (usersSearch) {
    backParams.set("q", usersSearch);
  }
  if (usersRole) {
    backParams.set("userRole", usersRole);
  }
  if (usersActive) {
    backParams.set("userActive", usersActive);
  }
  if (projectSearch) {
    backParams.set("projectQ", projectSearch);
  }
  if (projectStatus) {
    backParams.set("projectStatus", projectStatus);
  }
  if (projectPage) {
    backParams.set("projectPage", projectPage);
  }
  if (operationSearch) {
    backParams.set("opQ", operationSearch);
  }
  if (operationTypeFilter) {
    backParams.set("opType", operationTypeFilter);
  }
  if (operationPage) {
    backParams.set("opPage", operationPage);
  }
  if (page) {
    backParams.set("page", page);
  }
  if (resultKey) {
    backParams.set("resultKey", resultKey);
  }

  const operationType = String(formData.get("operationType") ?? "") === "Списание" ? "Списание" : "Пополнение";
  const amountRub = Number(formData.get("amountRub") ?? 0);
  const source = String(formData.get("source") ?? "");
  const performedBy = String(formData.get("performedBy") ?? "");
  const comment = String(formData.get("comment") ?? "");

  const result = await adminCreateBalanceOperation(admin, userId, {
    operationType,
    amountRub,
    source,
    performedBy,
    comment,
  });

  if (!result.ok) {
    backParams.set("error", result.error);
    redirect(`/admin?${backParams.toString()}`);
  }

  revalidatePath("/admin");
  backParams.set("success", "Операция по балансу добавлена");
  redirect(`/admin?${backParams.toString()}`);
}

export async function adminCreateProjectForUserAction(formData: FormData) {
  const admin = await getCurrentViewer();
  if (!admin || admin.role !== "admin") {
    redirect("/projects");
  }

  const userId = String(formData.get("userId") ?? "").trim();
  const usersSearch = String(formData.get("q") ?? "").trim();
  const usersRole = String(formData.get("userRole") ?? "").trim();
  const usersActive = String(formData.get("userActive") ?? "").trim();
  const projectSearch = String(formData.get("projectQ") ?? "").trim();
  const projectStatus = String(formData.get("projectStatus") ?? "").trim();
  const projectPage = String(formData.get("projectPage") ?? "1").trim();
  const operationSearch = String(formData.get("opQ") ?? "").trim();
  const operationTypeFilter = String(formData.get("opType") ?? "").trim();
  const operationPage = String(formData.get("opPage") ?? "1").trim();
  const page = String(formData.get("page") ?? "1").trim();

  const result = await adminCreateProjectForUser(admin, userId);
  if (!result.ok) {
    const params = new URLSearchParams();
    params.set("tab", "users");
    params.set("user", userId);
    if (usersSearch) params.set("q", usersSearch);
    if (usersRole) params.set("userRole", usersRole);
    if (usersActive) params.set("userActive", usersActive);
    if (projectSearch) params.set("projectQ", projectSearch);
    if (projectStatus) params.set("projectStatus", projectStatus);
    if (projectPage) params.set("projectPage", projectPage);
    if (operationSearch) params.set("opQ", operationSearch);
    if (operationTypeFilter) params.set("opType", operationTypeFilter);
    if (operationPage) params.set("opPage", operationPage);
    if (page) params.set("page", page);
    params.set("error", result.error);
    redirect(`/admin?${params.toString()}`);
  }

  revalidatePath("/admin");
  redirect(
    `/admin/projects/${result.newProjectId}?user=${encodeURIComponent(userId)}${
      usersSearch ? `&q=${encodeURIComponent(usersSearch)}` : ""
    }${usersRole ? `&userRole=${encodeURIComponent(usersRole)}` : ""}${
      usersActive ? `&userActive=${encodeURIComponent(usersActive)}` : ""
    }${projectSearch ? `&projectQ=${encodeURIComponent(projectSearch)}` : ""}${
      projectStatus ? `&projectStatus=${encodeURIComponent(projectStatus)}` : ""
    }${projectPage ? `&projectPage=${encodeURIComponent(projectPage)}` : ""}${
      operationSearch ? `&opQ=${encodeURIComponent(operationSearch)}` : ""
    }${operationTypeFilter ? `&opType=${encodeURIComponent(operationTypeFilter)}` : ""}${
      operationPage ? `&opPage=${encodeURIComponent(operationPage)}` : ""
    }${
      page ? `&page=${encodeURIComponent(page)}` : ""
    }`,
  );
}

export async function updateGlobalSettingsAction(formData: FormData) {
  const admin = await getCurrentViewer();
  if (!admin || admin.role !== "admin") {
    redirect("/projects");
  }

  const defaultProjectPriceRub = Number(formData.get("defaultProjectPriceRub") ?? 0);
  const rawOldPrice = String(formData.get("defaultProjectOldPriceRub") ?? "").trim();
  const projectPricePromoMessage = String(formData.get("projectPricePromoMessage") ?? "");
  const resultKey = String(formData.get("resultKey") ?? "").trim();
  if (!Number.isFinite(defaultProjectPriceRub) || defaultProjectPriceRub < 0) {
    redirect(`/admin?tab=settings&settingsError=${encodeURIComponent("Укажите корректную стоимость проекта")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  const defaultProjectOldPriceRub = rawOldPrice === "" ? null : Number(rawOldPrice);
  if (rawOldPrice !== "" && (!Number.isFinite(defaultProjectOldPriceRub) || Number(defaultProjectOldPriceRub) < 0)) {
    redirect(`/admin?tab=settings&settingsError=${encodeURIComponent("Укажите корректную старую цену")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
  }

  await updateGlobalSettings({
    defaultProjectPriceRub,
    defaultProjectOldPriceRub,
    projectPricePromoMessage,
  });

  revalidatePath("/admin");
  revalidatePath("/projects");
  redirect(`/admin?tab=settings&settingsSuccess=${encodeURIComponent("Глобальные настройки сохранены")}${resultKey ? `&resultKey=${encodeURIComponent(resultKey)}` : ""}`);
}

export async function duplicateProjectAction(projectId: string, targetUserId?: string) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false as const, error: "Unauthorized" };
  }

  const result = await duplicateProject(viewer, projectId, targetUserId);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${result.newProjectId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${result.newProjectId}`);

  return result;
}

export async function updateProjectAction(
  projectId: string,
  payload: { title: string; description: string; columns: string },
  options?: { recalculatePrice?: boolean },
) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false as const, error: "Unauthorized" };
  }

  const updateResult = await updateProjectDraft(viewer.role === "admin" ? null : viewer.id, projectId, payload, {
    recalculatePrice: options?.recalculatePrice,
  });
  if (!updateResult) {
    return { ok: false as const, error: "Недоступно для редактирования" };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");

  return { ok: true as const, pricing: updateResult.pricing };
}

export async function startProjectAction(projectId: string, mode: "paid" | "free" = "paid", consentAccepted = false) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false as const, error: "Unauthorized" };
  }

  if (consentAccepted) {
    await query(
      `INSERT INTO user_consents (user_id, consent_text)
       VALUES ($1, 'Даю согласие с политикой конфиденциальности и офертой')
       ON CONFLICT (user_id, consent_text) DO NOTHING`,
      [viewer.id],
    );
  }

  const started = await startProject(viewer.role === "admin" ? null : viewer.id, projectId, {
    chargeMode: mode,
  });
  if (!started.ok) {
    return started;
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");

  return { ok: true as const, warning: started.warning };
}

export async function stopProjectAction(projectId: string) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    return { ok: false as const, error: "Unauthorized" };
  }

  const stopped = await stopProject(null, projectId);
  if (!stopped) {
    return { ok: false as const, error: "Проект нельзя остановить" };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");

  return { ok: true as const };
}

export async function adminTransferProjectAction(projectId: string, targetUserIdentity: string) {
  const viewer = await getCurrentViewer();
  if (!viewer || viewer.role !== "admin") {
    return { ok: false as const, error: "Unauthorized" };
  }

  const result = await adminTransferProject(viewer, projectId, targetUserIdentity);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");
  revalidatePath("/projects");

  return result;
}

export async function deleteProjectAction(projectId: string) {
  const viewer = await getCurrentViewer();
  if (!viewer) {
    return { ok: false as const, error: "Unauthorized" };
  }

  const deleted = await deleteProject(viewer.role === "admin" ? null : viewer.id, projectId);
  if (!deleted) {
    return { ok: false as const, error: "Проект не найден или находится в работе" };
  }

  revalidatePath("/projects");
  revalidatePath("/admin");
  return { ok: true as const };
}
