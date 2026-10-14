"use client";

import { createContext, FormEvent, FormHTMLAttributes, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ButtonFeedbackState } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";

type QueryFormContextValue = {
  feedbackState: ButtonFeedbackState;
};

export const ClientQueryFormContext = createContext<QueryFormContextValue | null>(null);

type ClientQueryFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method"> & {
  action: string;
  replace?: boolean;
  onNavigate?: () => void;
  successToastTitle?: string;
};

export function ClientQueryForm({
  action,
  replace = false,
  onNavigate,
  successToastTitle,
  className = "",
  children,
  ...props
}: ClientQueryFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [feedbackState, setFeedbackState] = useState<ButtonFeedbackState>("idle");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const pendingSeenRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPending) {
      pendingSeenRef.current = true;
      return;
    }

    if (!hasSubmitted) {
      return;
    }

    if (!pendingSeenRef.current) {
      return;
    }

    const successStateTimer = window.setTimeout(() => {
      setFeedbackState("success");
      if (successToastTitle) {
        showToast({ title: successToastTitle, tone: "success", durationMs: 1800 });
      }
    }, 0);

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setFeedbackState("idle");
      setHasSubmitted(false);
      pendingSeenRef.current = false;
    }, 1200);

    return () => {
      window.clearTimeout(successStateTimer);
    };
  }, [hasSubmitted, isPending, showToast, successToastTitle]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    pendingSeenRef.current = false;
    setHasSubmitted(true);
    setFeedbackState("loading");

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    formData.forEach((value, key) => {
      if (typeof value !== "string") {
        return;
      }

      if (!value.trim()) {
        return;
      }

      params.append(key, value);
    });

    const target = params.toString() ? `${action}?${params.toString()}` : action;

    try {
      startTransition(() => {
        onNavigate?.();
        if (replace) {
          router.replace(target, { scroll: false });
          return;
        }

        router.push(target, { scroll: false });
      });
    } catch {
      setFeedbackState("error");
      showToast({ title: "Не удалось обновить список", tone: "error" });
      setHasSubmitted(false);
      pendingSeenRef.current = false;
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setFeedbackState("idle"), 1500);
    }
  };

  const contextValue = useMemo(() => ({ feedbackState }), [feedbackState]);

  return (
    <ClientQueryFormContext.Provider value={contextValue}>
      <form
        method="GET"
        action={action}
        onSubmit={handleSubmit}
        aria-busy={isPending}
        className={className}
        {...props}
      >
        {children}
      </form>
    </ClientQueryFormContext.Provider>
  );
}
