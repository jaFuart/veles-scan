"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MdInfoOutline, MdLogin } from "react-icons/md";
import { AppLogo } from "@/components/ui/AppLogo";
import { Button } from "@/components/ui/Button";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { Input } from "@/components/ui/Input";
import { AppFooter } from "@/components/layout/AppFooter";
import { loginAction } from "@/lib/actions";

type LoginViewProps = {
  error?: string;
};

export function LoginView({ error }: LoginViewProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(loginAction, {
    ok: false,
    error,
  });

  useEffect(() => {
    if (!state.ok || !state.redirectTo) {
      return;
    }

    router.replace(state.redirectTo);
  }, [router, state.ok, state.redirectTo]);

  return (
    <div className="flex min-h-screen flex-col px-4 py-6 md:px-8">
      <header className="mb-6 flex justify-center md:mb-8">
        <ClientNavButton href="/" className="inline-flex hover:opacity-80">
          <AppLogo centered />
        </ClientNavButton>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center pb-8">
        <section className="rounded-xl border border-black/15 bg-[var(--panel)] p-5 md:p-6">
          <h1 className="mb-1 text-[28px] font-bold md:text-[32px]">Вход в аккаунт</h1>
          <p className="mb-4 text-[13px] text-[#777]">Введите email и пароль, чтобы продолжить.</p>

          {state.error ? (
            <p className="mb-3 rounded-md border border-[#e5b0b0] bg-[#ffeaea] px-3 py-2 text-[12px] text-[#8c3a3a]">
              {state.error}
            </p>
          ) : null}

          <form action={formAction}>
            <div className="space-y-3">
              <label className="block text-[14px] font-semibold text-[#444]">
                E-Mail
                <Input name="email" placeholder="Введите почту" type="email" className="mt-1.5" required />
              </label>

              <label className="block text-[14px] font-semibold text-[#444]">
                Пароль
                <Input name="password" placeholder="************" type="password" className="mt-1.5" required />
              </label>
            </div>

            <div className="mt-3 flex items-center justify-between text-[12px]">
              <ClientNavButton href="/forgot-password" className="text-[#3d8cff] hover:underline">
                Забыли пароль?
              </ClientNavButton>
              <ClientNavButton href="/register" className="text-[#3d8cff] hover:underline">
                Регистрация
              </ClientNavButton>
            </div>

            <Button fullWidth className="mt-4 text-[14px]" type="submit" disabled={isPending}>
              <MdLogin /> {isPending ? "Входим..." : "Войти"}
            </Button>
          </form>
        </section>

        <p className="mt-3 flex items-center gap-1 text-[12px] text-[#8e8e8e]">
          <MdInfoOutline /> По вопросам поддержки: <a href="mailto:info@veles-drive.com" className="text-[#3d8cff] hover:underline">info@veles-drive.com</a>
        </p>
      </main>

      <AppFooter />
    </div>
  );
}
