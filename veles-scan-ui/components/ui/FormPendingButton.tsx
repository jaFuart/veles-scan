"use client";

import { ButtonHTMLAttributes, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import type { ButtonFeedbackState } from "@/components/ui/Button";
import { ClientQueryFormContext } from "@/components/ui/ClientQueryForm";

type FormPendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingText?: string;
  variant?: "dark" | "light";
  resultState?: ButtonFeedbackState;
};

export function FormPendingButton({
  children,
  pendingText,
  variant = "dark",
  resultState,
  className = "",
  disabled,
  ...props
}: FormPendingButtonProps) {
  const { pending } = useFormStatus();
  const queryFormContext = useContext(ClientQueryFormContext);
  const [transientResultState, setTransientResultState] = useState<ButtonFeedbackState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (queryFormContext) {
      return;
    }

    if (resultState === "success" || resultState === "error") {
      const showTimer = window.setTimeout(() => {
        setTransientResultState(resultState);
      }, 0);

      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = window.setTimeout(() => {
        setTransientResultState("idle");
      }, 1200);
      return () => {
        window.clearTimeout(showTimer);
      };
    }

    const idleTimer = window.setTimeout(() => {
      setTransientResultState("idle");
    }, 0);

    return () => {
      window.clearTimeout(idleTimer);
    };
  }, [queryFormContext, resultState]);

  const feedbackState = queryFormContext?.feedbackState ?? (pending ? "loading" : transientResultState);
  const isLoading = feedbackState === "loading";

  return (
    <Button
      type="submit"
      variant={variant}
      disabled={disabled || isLoading}
      feedbackState={feedbackState}
      showFeedbackIcon
      className={className}
      {...props}
    >
      {isLoading ? (pendingText ?? "Сохраняем...") : children}
    </Button>
  );
}
