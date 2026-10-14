"use client";

import { useSyncExternalStore } from "react";

type BrowserDateTimeProps = {
  value?: string | null;
  mode?: "datetime" | "date" | "time";
  emptyText?: string;
  className?: string;
};

function formatValue(value: string, mode: "datetime" | "date" | "time") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (mode === "date") {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  if (mode === "time") {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function BrowserDateTime({ value, mode = "datetime", emptyText = "—", className }: BrowserDateTimeProps) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const text = value ? (isClient ? formatValue(value, mode) : emptyText) : emptyText;

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}