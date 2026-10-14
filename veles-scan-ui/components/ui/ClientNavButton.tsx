"use client";

import { ButtonHTMLAttributes, MouseEvent, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

type ClientNavButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
  type?: "button" | "submit" | "reset";
  onNavigate?: () => void;
};

export function ClientNavButton({
  href,
  replace = false,
  prefetch = true,
  onNavigate,
  onClick,
  className = "",
  disabled,
  type = "button",
  children,
  ...props
}: ClientNavButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!prefetch) {
      return;
    }

    void router.prefetch(href);
  }, [href, prefetch, router]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || disabled || isPending) {
      return;
    }

    startTransition(() => {
      onNavigate?.();
      if (replace) {
        router.replace(href, { scroll: false });
        return;
      }

      router.push(href, { scroll: false });
    });
  };

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      aria-busy={isPending}
      className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
