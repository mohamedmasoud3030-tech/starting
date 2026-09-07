import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

type CompanyHeaderProps = {
  /** Company name in English (displayed as fallback if Arabic not available) */
  name: string;
  /** Optional: shows a small badge with the name */
  showBadge?: boolean;
  /** Optional className overrides */
  className?: string;
};

export function CompanyHeader({
  name,
  showBadge = true,
  className,
}: CompanyHeaderProps) {
  return (
    <Badge
      className={cn(
        "flex items-center gap-2 rounded-xl bg-primary-100 text-primary-800 text-xs font-medium",
        "transition-colors hover:bg-primary-200",
        className,
      )}
      {...showBadge && {
        label: name,
        // Accessible name for the badge content
        "aria-label": `اسم الشركة: ${name}`,
      }}
    >
      {showBadge && <span className="self-center">{name.substring(0, 15)}{name.length > 15 ? "..." : ""}</span>}
    </Badge>
  );
}
