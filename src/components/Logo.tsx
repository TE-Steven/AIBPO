import { IconSparkles } from "@/components/icons";

export function Logo({
  subtitle,
  size = "md",
}: {
  subtitle?: string;
  size?: "sm" | "md" | "lg";
}) {
  const iconBox = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconSize = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const titleSize = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base";

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex ${iconBox} shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-600 to-cyan-500 text-white`}
      >
        <IconSparkles className={iconSize} strokeWidth={2} />
      </span>
      <span className="leading-tight">
        <span className={`block font-semibold tracking-tight text-slate-900 ${titleSize}`}>
          營運工作台
        </span>
        {subtitle && <span className="block text-xs text-slate-500">{subtitle}</span>}
      </span>
    </div>
  );
}
