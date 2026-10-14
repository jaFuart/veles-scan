"use client";

import { useEffect, useRef, useState } from "react";
import { MdClose, MdContentCopy } from "react-icons/md";
import { Button } from "@/components/ui/Button";

type OutputFieldOptionsModalProps = {
  open: boolean;
  onClose: () => void;
};

const OUTPUT_FIELDS = [
  "Название компании",
  "Юридическое наименование",
  "Статус",
  "ИНН",
  "ИНН управляющего",
  "ФИО управляющего",
  "Должность управляющего",
  "ОГРН",
  "КПП",
  "ОКПО",
  "Дата регистрации",
  "ОКВЭД",
  "Юридический адрес",
  "Город",
  "Сайт",
  "Телефон",
  "Email",
  "Выручка",
  "Чистая прибыль",
  "Капитал",
  "Описание компании",
  "Сайт работает",
  "Контактное лицо",
  "Должность",
  "Телефон контактного лица",
  "Email контактного лица",
  "Клиенты",
  "Партнёры",
];

export function OutputFieldOptionsModal({ open, onClose }: OutputFieldOptionsModalProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(OUTPUT_FIELDS.join(", "));
      setIsCopied(true);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setIsCopied(false), 1400);
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <>
      <button className="fixed inset-0 z-30 bg-black/45" onClick={onClose} aria-label="Закрыть" />
      <section className="fixed left-1/2 top-1/2 z-40 w-[94vw] max-w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-[var(--panel)] p-4 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[22px] font-bold leading-tight md:text-[28px]">Варианты заполнения</h3>
            <p className="mt-1 text-[13px] text-[#666]">Доступные поля для итогового формирования файла.</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-[24px] hover:bg-black/5"
            aria-label="Закрыть"
          >
            <MdClose />
          </button>
        </div>

        <div className="max-h-[56vh] overflow-y-auto rounded-md border border-[var(--line)] bg-white p-3">
          <ol className="space-y-1.5">
            {OUTPUT_FIELDS.map((field, index) => (
              <li key={field} className="flex items-baseline gap-2 text-[14px] md:text-[15px]">
                <span className="shrink-0 text-[12px] font-semibold text-[#aaa]">{index + 1}.</span>
                <span className="text-[#2f2f2f]">{field}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative">
            <Button onClick={handleCopy} className="h-9 px-4 text-[13px]">
              <MdContentCopy /> Скопировать все поля
            </Button>
            {isCopied ? (
              <div className="pointer-events-none absolute left-0 top-full mt-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white md:text-[12px]">
                Скопировано
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

