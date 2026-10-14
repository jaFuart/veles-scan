"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/ToastProvider";

type ToastRule = {
  param: string;
  tone: "success" | "error" | "info";
  fallbackTitle: string;
};

type QueryResultToastsProps = {
  rules: ToastRule[];
};

export function QueryResultToasts({ rules }: QueryResultToastsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const lastShownRef = useRef<string>("");

  useEffect(() => {
    const key = searchParams.toString();
    if (!key || key === lastShownRef.current) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    let hasHandledResultParam = false;

    for (const rule of rules) {
      const value = searchParams.get(rule.param);
      if (!value) {
        continue;
      }

      showToast({
        title: value || rule.fallbackTitle,
        tone: rule.tone,
      });

      nextParams.delete(rule.param);
      hasHandledResultParam = true;
    }

    if (!hasHandledResultParam) {
      return;
    }

    lastShownRef.current = key;

    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const timer = window.setTimeout(() => {
      router.replace(nextUrl, { scroll: false });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pathname, router, rules, searchParams, showToast]);

  return null;
}
