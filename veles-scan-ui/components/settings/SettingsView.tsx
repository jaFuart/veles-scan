"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonFeedbackState } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import { updateProfileAction } from "@/lib/actions";
import { Viewer } from "@/lib/types";

type SettingsViewProps = {
  viewer: Viewer;
  error?: string;
  success?: string;
};

export function SettingsView({ viewer, error, success }: SettingsViewProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const feedbackTimerRef = useRef<number | null>(null);
  const [buttonFeedback, setButtonFeedback] = useState<ButtonFeedbackState>("idle");
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<{
    ok: boolean;
    error?: string;
    success?: string;
    redirectTo?: string;
  }>({
    ok: false,
    error,
    success,
  });

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setButtonFeedback("loading");

    startTransition(async () => {
      const result = await updateProfileAction({ ok: false }, formData);
      setState(result);

      if (result.redirectTo) {
        router.replace(result.redirectTo);
        return;
      }

      const isSuccess = result.ok;
      setButtonFeedback(isSuccess ? "success" : "error");
      showToast({
        title: isSuccess ? "Профиль обновлён" : "Не удалось сохранить профиль",
        description: isSuccess ? "Изменения успешно применены." : result.error,
        tone: isSuccess ? "success" : "error",
      });

      if (isSuccess) {
        router.refresh();
      }

      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => setButtonFeedback("idle"), 1400);
    });
  };

  return (
    <section>
      <h1 className="mb-5 text-[34px] font-extrabold md:text-[46px]">Настройки аккаунта</h1>

      {state.error ? (
        <p className="mb-3 max-w-3xl rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[12px] text-[#8c3a3a]">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mb-3 max-w-3xl rounded-md border border-[#b7e5b0] bg-[#efffea] px-3 py-2 text-[12px] text-[#35723a]">
          {state.success}
        </p>
      ) : null}

      <article className="max-w-3xl rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
        <h2 className="mb-3 text-[20px] font-bold md:text-[24px]">Профиль</h2>
        <form onSubmit={onSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] font-semibold text-[#444]">
              Имя
              <Input name="fullName" defaultValue={viewer.fullName} aria-label="Имя" className="mt-1.5" required />
            </label>
            <label className="block text-[13px] font-semibold text-[#444]">
              E-Mail
              <Input name="email" defaultValue={viewer.email} aria-label="Email" className="mt-1.5" required />
            </label>
            <label className="block text-[13px] font-semibold text-[#444]">
              Новый пароль
              <Input name="newPassword" type="password" placeholder="Новый пароль" className="mt-1.5" />
            </label>
            <label className="block text-[13px] font-semibold text-[#444]">
              Повторите пароль
              <Input name="repeatPassword" type="password" placeholder="Повторите пароль" className="mt-1.5" />
            </label>
          </div>

          <Button
            className="mt-4 w-fit px-5 text-[14px]"
            type="submit"
            disabled={isPending}
            feedbackState={buttonFeedback}
            showFeedbackIcon
          >
            {isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </form>
      </article>
    </section>
  );
}
