"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MdArrowDownward, MdArrowUpward } from "react-icons/md";
import { BrowserDateTime } from "@/components/ui/BrowserDateTime";
import { Button, ButtonFeedbackState } from "@/components/ui/Button";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import { activatePromoCodeAction } from "@/lib/actions";
import { FinanceOperationView } from "@/lib/types";

type FinanceViewProps = {
  balanceRub: number;
  monthTopUp: number;
  monthDebit: number;
  operations: FinanceOperationView[];
  operationsPage: number;
  operationsTotal: number;
  operationsTotalPages: number;
  promoError?: string;
  promoSuccess?: string;
  promoUsage: Array<{
    code: string;
    activatedAt: string;
    amountRub: number;
  }>;
  paymentStatus?: string;
  paymentOrderId?: string;
};

export function FinanceView({
  balanceRub,
  monthTopUp,
  monthDebit,
  operations,
  operationsPage,
  operationsTotal,
  operationsTotalPages,
  promoError,
  promoSuccess,
  promoUsage,
  paymentStatus,
  paymentOrderId,
}: FinanceViewProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const promoFormRef = useRef<HTMLFormElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [buttonFeedback, setButtonFeedback] = useState<ButtonFeedbackState>("idle");
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmountRub, setTopUpAmountRub] = useState("1000");
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [topUpOrderId, setTopUpOrderId] = useState<string | null>(null);
  const [isClosingTopUp, setIsClosingTopUp] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<{
    ok: boolean;
    error?: string;
    success?: string;
    redirectTo?: string;
  }>({
    ok: false,
    error: promoError,
    success: promoSuccess,
  });

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const onSubmitPromo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setButtonFeedback("loading");

    startTransition(async () => {
      const result = await activatePromoCodeAction({ ok: false }, formData);
      setState(result);

      if (result.redirectTo) {
        router.replace(result.redirectTo);
        return;
      }

      const isSuccess = result.ok;
      setButtonFeedback(isSuccess ? "success" : "error");
      showToast({
        title: isSuccess ? "Промокод активирован" : "Ошибка активации промокода",
        description: isSuccess ? result.success : result.error,
        tone: isSuccess ? "success" : "error",
      });

      if (isSuccess) {
        promoFormRef.current?.reset();
        router.refresh();
      }

      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => setButtonFeedback("idle"), 1400);
    });
  };

  const buildOperationsLink = (targetPage: number) => `/finance?opPage=${targetPage}`;

  const openTopUpModal = () => {
    setTopUpError(null);
    setPaymentUrl(null);
    setTopUpOrderId(null);
    setTopUpAmountRub("1000");
    setIsTopUpModalOpen(true);
  };

  const closeTopUpModal = () => {
    setIsTopUpModalOpen(false);
    setTopUpError(null);
    setIsTopUpLoading(false);
    setPaymentUrl(null);
    setTopUpOrderId(null);
  };

  const onCreateTopUpPayment = async () => {
    const amountRub = Number(topUpAmountRub);
    const normalizedAmount = Number.isFinite(amountRub) ? Math.trunc(amountRub) : 0;

    if (normalizedAmount < 10 || normalizedAmount > 1_000_000) {
      setTopUpError("Сумма должна быть от 10 до 1 000 000 руб.");
      return;
    }

    setIsTopUpLoading(true);
    setTopUpError(null);

    try {
      const response = await fetch("/api/payments/tbank/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountRub: normalizedAmount }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        paymentUrl?: string;
        orderId?: string;
      };

      if (!response.ok || !payload.ok || !payload.paymentUrl) {
        throw new Error(payload.error || "Не удалось инициализировать оплату");
      }

      setPaymentUrl(payload.paymentUrl);
      setTopUpOrderId(payload.orderId ?? null);
      showToast({
        title: "Платёж создан",
        description: "Откройте форму ниже и завершите оплату в виджете Т-Банка.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка инициализации оплаты";
      setTopUpError(message);
      showToast({
        title: "Ошибка пополнения",
        description: message,
        tone: "error",
      });
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const onCloseTopUpModal = async () => {
    if (!topUpOrderId) {
      closeTopUpModal();
      router.refresh();
      return;
    }

    setIsClosingTopUp(true);
    setTopUpError(null);

    try {
      const statusResponse = await fetch(`/api/payments/tbank/order-status?orderId=${encodeURIComponent(topUpOrderId)}`, {
        method: "GET",
      });

      const statusPayload = (await statusResponse.json()) as {
        ok?: boolean;
        error?: string;
        needsCancel?: boolean;
      };

      if (!statusResponse.ok || !statusPayload.ok) {
        throw new Error(statusPayload.error || "Не удалось проверить статус оплаты");
      }

      if (statusPayload.needsCancel) {
        const cancelResponse = await fetch("/api/payments/tbank/cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orderId: topUpOrderId }),
        });
        const cancelPayload = (await cancelResponse.json()) as { ok?: boolean; error?: string };
        if (!cancelResponse.ok || !cancelPayload.ok) {
          throw new Error(cancelPayload.error || "Не удалось отменить оплату");
        }
      }

      closeTopUpModal();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка при закрытии окна оплаты";
      setTopUpError(message);
      showToast({
        title: "Не удалось закрыть оплату",
        description: message,
        tone: "error",
      });
    } finally {
      setIsClosingTopUp(false);
    }
  };

  return (
    <section>
      <h1 className="mb-6 text-[34px] font-extrabold md:text-[46px]">Финансы</h1>

      {state.error ? (
        <p className="mb-3 rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[12px] text-[#8c3a3a]">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mb-3 rounded-md border border-[#b7e5b0] bg-[#efffea] px-3 py-2 text-[12px] text-[#35723a]">
          {state.success}
        </p>
      ) : null}

      {paymentStatus === "success" ? (
        <p className="mb-3 rounded-md border border-[#b7e5b0] bg-[#efffea] px-3 py-2 text-[12px] text-[#35723a]">
          Платёж {paymentOrderId ? `по заказу ${paymentOrderId}` : ""} отправлен в обработку. После подтверждения банка баланс
          обновится автоматически.
        </p>
      ) : null}
      {paymentStatus === "fail" ? (
        <p className="mb-3 rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[12px] text-[#8c3a3a]">
          Оплата не завершена. Вы можете повторить попытку пополнения.
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-black bg-[var(--panel)] p-5">
          <p className="text-[14px] text-[#666]">Текущий баланс</p>
          <p className="mt-1 text-[32px] font-bold">{balanceRub.toLocaleString("ru-RU")} руб.</p>
          <Button className="mt-4" onClick={openTopUpModal}>
            Пополнить
          </Button>
        </article>

        <article className="rounded-xl border border-black bg-[var(--panel)] p-5">
          <p className="mb-2 text-[14px] text-[#666]">Активация промокода</p>
          <form ref={promoFormRef} className="flex flex-col gap-2" onSubmit={onSubmitPromo}>
            <input
              name="promoCode"
              placeholder="Введите промокод"
              className="h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] outline-none"
              required
            />
            <Button
              type="submit"
              fullWidth
              className="h-11 text-[14px] font-semibold"
              disabled={isPending}
              feedbackState={buttonFeedback}
              showFeedbackIcon
            >
              {isPending ? "Активируем..." : "Активировать"}
            </Button>
          </form>

          <div className="mt-3 space-y-1.5">
            <p className="text-[13px] font-semibold text-[#555]">История активаций</p>
            {promoUsage.length ? (
              promoUsage.slice(0, 5).map((item) => (
                <p key={`${item.code}-${item.activatedAt}`} className="text-[12px] text-[#666]">
                  {item.code}: +{item.amountRub.toLocaleString("ru-RU")} руб. (<BrowserDateTime value={item.activatedAt} />)
                </p>
              ))
            ) : (
              <p className="text-[12px] text-[#888]">Промокоды пока не активировались.</p>
            )}
          </div>
        </article>

        <article className="rounded-xl border border-black bg-[var(--panel)] p-5 md:col-span-2">
          <p className="mb-2 text-[14px] text-[#666]">Краткая статистика за месяц</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="text-[13px] text-[#777]">Пополнения</p>
              <p className="text-[24px] font-semibold text-[#1f9f48]">{monthTopUp.toLocaleString("ru-RU")} руб.</p>
            </div>
            <div>
              <p className="text-[13px] text-[#777]">Списания</p>
              <p className="text-[24px] font-semibold text-[#cf4040]">{monthDebit.toLocaleString("ru-RU")} руб.</p>
            </div>
            <div>
              <p className="text-[13px] text-[#777]">Операций</p>
              <p className="text-[24px] font-semibold">{operationsTotal}</p>
            </div>
          </div>
        </article>
      </div>

      <section className="overflow-hidden rounded-xl border border-black bg-[var(--panel)]">
        <header className="hidden grid-cols-[1.2fr_1fr_1fr] border-b border-[var(--line)] px-5 py-3 text-[13px] font-semibold text-[#656565] md:grid">
          <span>Операция</span>
          <span>Дата</span>
          <span className="text-right">Сумма</span>
        </header>
        <div>
          {operations.map((operation) => {
            const isTopUp = operation.type === "Пополнение";

            return (
              <article
                key={operation.id}
                className="grid grid-cols-1 gap-1 border-b border-[var(--line)] px-4 py-3 last:border-b-0 md:grid-cols-[1.2fr_1fr_1fr] md:items-center md:gap-0 md:px-5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-[16px] font-semibold md:text-[16px]">
                    {isTopUp ? <MdArrowDownward className="text-[#1f9f48]" /> : <MdArrowUpward className="text-[#cf4040]" />}
                    {operation.type}
                  </p>
                  <p className="truncate text-[12px] text-[#767676] md:text-[13px]">{operation.note}</p>
                </div>
                <p className="text-[12px] text-[#767676] md:text-[13px]"><BrowserDateTime value={operation.date} /></p>
                <p className="text-left text-[18px] font-semibold md:text-right md:text-[18px]">{operation.amount}</p>
              </article>
            );
          })}
          {!operations.length ? <div className="px-5 py-6 text-[14px] text-[#777]">Операций пока нет.</div> : null}
        </div>
        {operationsTotalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-3 text-[12px] text-[#666] md:px-5">
            <span>
              Страница {operationsPage} из {operationsTotalPages} · Всего: {operationsTotal}
            </span>
            <div className="flex items-center gap-2">
              <ClientNavButton
                href={operationsPage > 1 ? buildOperationsLink(operationsPage - 1) : buildOperationsLink(operationsPage)}
                disabled={operationsPage <= 1}
                className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                  operationsPage <= 1
                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                }`}
              >
                Назад
              </ClientNavButton>
              <ClientNavButton
                href={operationsPage < operationsTotalPages ? buildOperationsLink(operationsPage + 1) : buildOperationsLink(operationsPage)}
                disabled={operationsPage >= operationsTotalPages}
                className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                  operationsPage >= operationsTotalPages
                    ? "pointer-events-none border-[#d9d9d9] text-[#b5b5b5]"
                    : "border-[#cfcfcf] hover:border-black hover:bg-black hover:text-white"
                }`}
              >
                Вперёд
              </ClientNavButton>
            </div>
          </div>
        ) : null}
      </section>

      {isTopUpModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-black bg-[var(--panel)] p-5 shadow-2xl">
            <h2 className="text-[22px] font-bold">Пополнение через Т-Банк</h2>

            {!paymentUrl ? (
              <div className="mt-4 space-y-3">
                <p className="text-[14px] leading-6 text-[#555]">
                  Укажите сумму пополнения, после этого откроется платёжный iframe-виджет Т-Банка.
                </p>

                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold text-[#666]">Сумма, руб.</span>
                  <Input
                    type="number"
                    min={10}
                    step={1}
                    value={topUpAmountRub}
                    onChange={(event) => setTopUpAmountRub(event.target.value)}
                    placeholder="Например, 1000"
                  />
                </label>

                {topUpError ? <p className="text-[12px] text-[#b64040]">{topUpError}</p> : null}

                <div className="flex flex-col gap-2">
                  <Button fullWidth onClick={onCreateTopUpPayment} disabled={isTopUpLoading}>
                    {isTopUpLoading ? "Создаём платёж..." : "Перейти к оплате"}
                  </Button>
                  <Button fullWidth variant="light" onClick={onCloseTopUpModal} disabled={isClosingTopUp}>
                    {isClosingTopUp ? "Закрываем..." : "Закрыть окно"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-[14px] leading-6 text-[#555]">
                  Завершите оплату в форме ниже. После подтверждения банка операция появится в истории, а баланс обновится.
                </p>
                <iframe
                  src={paymentUrl}
                  title="Виджет оплаты Т-Банка"
                  className="h-[620px] w-full rounded-md border border-[var(--line)] bg-white"
                  loading="eager"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="payment *"
                />

                {topUpError ? <p className="text-[12px] text-[#b64040]">{topUpError}</p> : null}
                <Button fullWidth variant="light" onClick={onCloseTopUpModal} disabled={isClosingTopUp}>
                  {isClosingTopUp ? "Закрываем..." : "Закрыть окно"}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
