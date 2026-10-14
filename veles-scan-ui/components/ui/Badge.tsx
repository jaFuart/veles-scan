type BadgeColor = "yellow" | "blue" | "green" | "red";

const colorMap: Record<BadgeColor, string> = {
  yellow: "bg-[var(--accent-yellow)] text-black",
  blue: "bg-[var(--accent-blue)] text-black",
  green: "bg-[var(--accent-green)] text-black",
  red: "bg-[var(--accent-red)] text-black",
};

type BadgeProps = {
  children: string;
  color: BadgeColor;
};

export function Badge({ children, color }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-8 items-center rounded-full px-4 text-[13px] font-medium ${colorMap[color]}`}
    >
      {children}
    </span>
  );
}
