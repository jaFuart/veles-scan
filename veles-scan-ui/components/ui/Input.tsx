import { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;
type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Input(props: InputProps) {
  return (
    <input
      {...props}
      className={`h-11 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-[14px] placeholder:text-[#a1a1a1] outline-none focus:border-[#949494] focus:ring-2 focus:ring-black/5 disabled:cursor-not-allowed disabled:text-[#8d8d8d] ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: TextAreaProps) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-[var(--line)] bg-[var(--background)] p-3 text-[14px] leading-6 placeholder:text-[#a1a1a1] outline-none focus:border-[#949494] focus:ring-2 focus:ring-black/5 disabled:cursor-not-allowed disabled:text-[#8d8d8d] ${props.className ?? ""}`}
    />
  );
}
