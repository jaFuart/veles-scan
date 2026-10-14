"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { MdClose, MdContentCopy, MdSearch } from "react-icons/md";
import { Button } from "@/components/ui/Button";
import { examplePrompts, ExamplePrompt } from "@/data/mock";

type QueryExamplesModalProps = {
  open: boolean;
  onClose: () => void;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setIsCopied(false), 1400);
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <div className="relative w-fit">
      <Button onClick={handleCopy} className="h-9 w-fit px-4 text-[13px]">
        <MdContentCopy /> {label}
      </Button>
      {isCopied ? (
        <div className="pointer-events-none absolute left-0 top-full mt-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white md:text-[12px]">
          Скопировано
        </div>
      ) : null}
    </div>
  );
}

export function QueryExamplesModal({ open, onClose }: QueryExamplesModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activePrompt, setActivePrompt] = useState<ExamplePrompt>(examplePrompts[0]);

  const filteredPrompts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return examplePrompts;
    return examplePrompts.filter(
      (p) => p.title.toLowerCase().includes(query) || p.text.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const resolvedActivePrompt: ExamplePrompt =
    filteredPrompts.some((p) => p.title === activePrompt.title)
      ? activePrompt
      : (filteredPrompts[0] ?? examplePrompts[0]);

  if (!open) return null;

  return (
    <>
      <button className="fixed inset-0 z-30 bg-black/45" onClick={onClose} aria-label="Закрыть" />
      <section className="fixed left-1/2 top-1/2 z-40 grid h-[84vh] w-[94vw] max-w-[1120px] -translate-x-1/2 -translate-y-1/2 grid-cols-1 gap-4 rounded-md bg-[var(--panel)] p-4 md:grid-cols-[280px_1fr] md:gap-5 md:p-6">

        {/* Sidebar */}
        <div className="hide-scrollbar overflow-y-auto md:border-r md:border-[#d6d6d6] md:pr-3">
          <div className="sticky top-0 z-10 mb-3 bg-[var(--panel)] pb-2">
            <label className="flex items-center rounded-full bg-[#dfdfdf] px-3 py-2 text-[13px] text-[#7f7f7f]">
              <MdSearch className="mr-2 shrink-0" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск"
                className="w-full bg-transparent outline-none placeholder:text-[#a6a6a6]"
              />
            </label>
          </div>
          <div className="space-y-1">
            {filteredPrompts.map((prompt) => (
              <button
                key={prompt.title}
                onClick={() => setActivePrompt(prompt)}
                className={`flex h-[52px] w-full items-center rounded-md px-3 text-left ${
                  prompt.title === resolvedActivePrompt.title ? "bg-[#e2e2e2]" : "hover:bg-[#ececec]"
                }`}
              >
                <p className="line-clamp-2 text-[13px] font-semibold leading-[1.25]">{prompt.title}</p>
              </button>
            ))}
            {!filteredPrompts.length ? (
              <p className="rounded-md border border-dashed border-[#cfcfcf] px-3 py-4 text-[12px] text-[#8d8d8d]">
                Ничего не найдено
              </p>
            ) : null}
          </div>
        </div>

        {/* Detail */}
        <div className="hide-scrollbar overflow-y-auto pr-1">
          <div className="mb-4 flex items-start justify-between gap-2">
            <h3 className="text-[22px] font-bold leading-tight md:text-[28px]">
              {resolvedActivePrompt?.title ?? "Пример запроса"}
            </h3>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1 text-[24px] hover:bg-black/5"
              aria-label="Закрыть"
            >
              <MdClose />
            </button>
          </div>

          {/* Description section */}
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-[#999]">Описание данных</h4>
          <p className="max-w-3xl text-[14px] leading-[1.65] text-[#2f2f2f] md:text-[15px]">
            {resolvedActivePrompt?.text}
          </p>
          <div className="mt-3">
            <CopyButton text={resolvedActivePrompt?.text ?? ""} label="Скопировать описание" />
          </div>

          {/* Columns section */}
          <div className="mt-6 border-t border-[#e0e0e0] pt-5">
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#999]">Формат ответа</h4>
            <ol className="space-y-1.5">
              {resolvedActivePrompt?.columns.map((col, i) => (
                <li key={col} className="flex items-baseline gap-2 text-[14px] md:text-[15px]">
                  <span className="shrink-0 text-[12px] font-semibold text-[#aaa]">{i + 1}.</span>
                  <span className="text-[#2f2f2f]">{col}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <CopyButton
                text={resolvedActivePrompt?.columns.join(", ") ?? ""}
                label="Скопировать столбцы"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
