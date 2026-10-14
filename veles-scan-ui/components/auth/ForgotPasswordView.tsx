import { MdInfoOutline } from "react-icons/md";
import { AppLogo } from "@/components/ui/AppLogo";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { AppFooter } from "@/components/layout/AppFooter";

export function ForgotPasswordView() {
  return (
    <div className="flex min-h-screen flex-col px-4 py-6 md:px-8">
      <header className="mb-6 flex justify-center md:mb-8">
        <ClientNavButton href="/" className="inline-flex hover:opacity-80">
          <AppLogo centered />
        </ClientNavButton>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center pb-8">
        <section className="rounded-xl border border-black/15 bg-[var(--panel)] p-5 md:p-6">
          <h1 className="mb-1 text-[28px] font-bold md:text-[32px]">Восстановление пароля</h1>
          <p className="mb-4 text-[13px] text-[#777]">
            Чтобы восстановить пароль, напишите на почту info@veles-drive.com
          </p>

          <div className="mt-4 grid gap-3">
            <ClientNavButton
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--dark)] px-4 text-[14px] font-medium text-white shadow-sm hover:-translate-y-0.5 hover:opacity-95 active:translate-y-0"
            >
              Войти
            </ClientNavButton>
            <ClientNavButton
              href="/register"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--line)] bg-white px-4 text-[14px] font-medium text-black shadow-sm hover:-translate-y-0.5 hover:bg-[#f8f8f8] active:translate-y-0"
            >
              Регистрация
            </ClientNavButton>
          </div>
        </section>

      </main>

      <AppFooter />
    </div>
  );
}
