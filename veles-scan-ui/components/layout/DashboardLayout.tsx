"use client";

import { ReactNode, useState } from "react";
import { MdMenu } from "react-icons/md";
import { AppLogo } from "@/components/ui/AppLogo";
import { AppFooter } from "@/components/layout/AppFooter";
import { SideMenu } from "@/components/layout/SideMenu";
import { ClientNavButton } from "@/components/ui/ClientNavButton";
import { Viewer } from "@/lib/types";

type DashboardLayoutProps = {
  children: ReactNode;
  viewer: Viewer;
};

export function DashboardLayout({ children, viewer }: DashboardLayoutProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="min-h-screen px-4 pb-4 pt-4 md:px-8 md:pt-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1560px] flex-col md:min-h-[calc(100vh-3rem)]">
        <header className="mb-6 grid grid-cols-[1fr_auto_1fr] items-center md:mb-8">
          <button
            aria-label="Открыть меню"
            onClick={() => setIsMenuOpen(true)}
            className="justify-self-start rounded-md p-2 hover:bg-black/5"
          >
            <MdMenu className="text-[28px] md:text-[32px]" />
          </button>
          <ClientNavButton href="/projects" className="justify-self-center hover:opacity-80">
            <AppLogo centered />
          </ClientNavButton>
          <ClientNavButton href="/finance" className="justify-self-end text-[16px] hover:opacity-80 md:text-[22px] 2xl:text-[26px]">
            {viewer.balanceRub.toLocaleString("ru-RU")} руб.
          </ClientNavButton>
        </header>

        <main className="flex-1">{children}</main>

        <AppFooter />
      </div>

      <SideMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} viewer={viewer} />
    </div>
  );
}
