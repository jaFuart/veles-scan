"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import {
  MdAdminPanelSettings,
  MdAccountCircle,
  MdAccountBalanceWallet,
  MdClose,
  MdFolder,
  MdHelp,
  MdHelpOutline,
  MdLogout,
  MdOutlineAccountBalanceWallet,
  MdOutlineAdminPanelSettings,
  MdOutlineFolder,
  MdOutlineSettings,
  MdSettings,
} from "react-icons/md";
import { Viewer } from "@/lib/types";

type SideMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  viewer: Viewer;
};

export function SideMenu({ isOpen, onClose, viewer }: SideMenuProps) {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopMenuWidth, setDesktopMenuWidth] = useState(420);
  const copyTimerRef = useRef<number | null>(null);
  const accountId = viewer.id;

  const isProjectsActive = pathname.startsWith("/projects");
  const isFinanceActive = pathname.startsWith("/finance");
  const isSupportActive = pathname.startsWith("/support");
  const isAdminActive = pathname.startsWith("/admin");
  const isSettingsActive = pathname.startsWith("/settings");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    return () => {
      mediaQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const measureTextWidth = (text: string, font: string) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return text.length * 12;
      }

      ctx.font = font;
      return ctx.measureText(text).width;
    };

    const calculateWidth = () => {
      const nameTextWidth = measureTextWidth(viewer.fullName, "700 36px Montserrat, sans-serif");
      const idTextWidth = measureTextWidth(accountId, "500 16px Montserrat, sans-serif");

      const nameRowWidth = 30 + 8 + nameTextWidth;
      const idRowWidth = 30 + 8 + idTextWidth;
      const widestContent = Math.max(nameRowWidth, idRowWidth);

      const horizontalPadding = 48;
      const rightControlSpace = 64;
      const rawWidth = widestContent + horizontalPadding + rightControlSpace;

      setDesktopMenuWidth(Math.min(560, Math.max(340, Math.ceil(rawWidth))));
    };

    calculateWidth();

    if (document.fonts?.ready) {
      document.fonts.ready.then(calculateWidth).catch(() => undefined);
    }
  }, [viewer.fullName, accountId]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        aria-label="Закрыть меню"
        className={`fixed inset-0 z-30 bg-black/45 transition-opacity duration-300 ${
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        style={{
          width: isDesktop ? `${desktopMenuWidth}px` : "100vw",
        } as CSSProperties}
        className={`fixed left-0 top-0 z-40 flex h-full max-w-none flex-col bg-[var(--panel)] px-5 py-5 shadow-xl transition-transform duration-300 md:px-6 md:py-6 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-7 flex items-start justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-[28px] font-bold leading-[1.05] md:text-[36px]">
              <MdAccountCircle className="shrink-0 text-[26px] md:text-[30px]" />
              <span className="min-w-0 break-words leading-[1.05]">{viewer.fullName}</span>
            </p>
            <div className="relative">
              <p className="flex items-center gap-2 text-[15px] text-[#707070] md:text-[16px]">
                <span className="inline-flex w-[28px] cursor-default justify-center font-bold md:w-[30px]">ID</span>
                <button
                  type="button"
                  onClick={copyId}
                  className="cursor-default rounded px-1 text-left transition hover:bg-black/5 hover:text-black active:scale-[0.98]"
                >
                  {accountId}
                </button>
              </p>
              {copied ? (
                <div className="pointer-events-none absolute left-[38px] top-full mt-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white md:text-[12px]">
                  ID скопирован
                </div>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md p-1 text-[24px] hover:bg-black/5"
          >
            <MdClose />
          </button>
        </div>

        <div className="flex flex-1 items-center">
          <nav className="w-full space-y-2 text-[18px] font-semibold md:text-[20px]">
          <ClientNavButton
            href="/projects"
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 hover:bg-black/5 ${
              isProjectsActive ? "bg-black/10" : ""
            }`}
            onNavigate={onClose}
          >
            {isProjectsActive ? (
              <MdFolder className="text-[22px] md:text-[24px]" />
            ) : (
              <MdOutlineFolder className="text-[22px] md:text-[24px]" />
            )}
            Проекты
          </ClientNavButton>
          <ClientNavButton
            href="/finance"
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 hover:bg-black/5 ${
              isFinanceActive ? "bg-black/10" : ""
            }`}
            onNavigate={onClose}
          >
            {isFinanceActive ? (
              <MdAccountBalanceWallet className="text-[22px] md:text-[24px]" />
            ) : (
              <MdOutlineAccountBalanceWallet className="text-[22px] md:text-[24px]" />
            )}
            Финансы
          </ClientNavButton>
          <ClientNavButton
            href="/support"
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 hover:bg-black/5 ${
              isSupportActive ? "bg-black/10" : ""
            }`}
            onNavigate={onClose}
          >
            {isSupportActive ? (
              <MdHelp className="text-[22px] md:text-[24px]" />
            ) : (
              <MdHelpOutline className="text-[22px] md:text-[24px]" />
            )}
            Поддержка
          </ClientNavButton>
          </nav>
        </div>

        <div className="mt-auto space-y-2 text-[18px] font-semibold md:text-[20px]">
          {viewer.role === "admin" ? (
            <ClientNavButton
              href="/admin"
              className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 hover:bg-black/5 ${
                isAdminActive ? "bg-black/10" : ""
              }`}
              onNavigate={onClose}
            >
              {isAdminActive ? (
                <MdAdminPanelSettings className="text-[22px] md:text-[24px]" />
              ) : (
                <MdOutlineAdminPanelSettings className="text-[22px] md:text-[24px]" />
              )}
              Админ-зона
            </ClientNavButton>
          ) : null}

          <ClientNavButton
            href="/settings"
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 hover:bg-black/5 ${
              isSettingsActive ? "bg-black/10" : ""
            }`}
            onNavigate={onClose}
          >
            {isSettingsActive ? (
              <MdSettings className="text-[22px] md:text-[24px]" />
            ) : (
              <MdOutlineSettings className="text-[22px] md:text-[24px]" />
            )}
            Настройки
          </ClientNavButton>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-black/5"
              onClick={onClose}
            >
              <MdLogout className="text-[22px] md:text-[24px]" /> Выход
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
