import { ButtonHTMLAttributes } from "react";
import { MdCheck, MdClose } from "react-icons/md";

type ButtonVariant = "dark" | "light";
export type ButtonFeedbackState = "idle" | "loading" | "success" | "error";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  feedbackState?: ButtonFeedbackState;
  showFeedbackIcon?: boolean;
};

export function Button({
  children,
  variant = "dark",
  fullWidth = false,
  feedbackState = "idle",
  showFeedbackIcon = false,
  className = "",
  ...props
}: ButtonProps) {
  const defaultStyle =
    variant === "dark"
      ? "bg-[var(--dark)] text-white hover:opacity-95"
      : "bg-white border border-[var(--line)] text-black hover:bg-[#f8f8f8]";

  const feedbackStyle =
    feedbackState === "success"
      ? "border border-[#7fd3b4] bg-[#baf3df] text-[#184a39]"
      : feedbackState === "error"
        ? "border border-[#e59696] bg-[#ffb9b9] text-[#6f2d2d]"
        : "";

  const style = feedbackStyle || defaultStyle;
  const isBusy = feedbackState === "loading";

  const feedbackIcon =
    feedbackState === "loading" ? (
      <span className="button-spinner" aria-hidden="true" />
    ) : feedbackState === "success" ? (
      <MdCheck className="text-[18px]" aria-hidden="true" />
    ) : feedbackState === "error" ? (
      <MdClose className="text-[18px]" aria-hidden="true" />
    ) : null;

  return (
    <button
      className={`h-10 rounded-md px-4 text-[14px] font-medium shadow-sm hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${style} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      aria-busy={isBusy}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {showFeedbackIcon && feedbackIcon ? feedbackIcon : null}
        {children}
      </span>
    </button>
  );
}
