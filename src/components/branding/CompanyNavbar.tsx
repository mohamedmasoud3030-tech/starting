import { useAuth } from "@/app/authContext";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { Badge } from "@/components/ui/Badge";
import { useState, useEffect } from "react";

export function CompanyNavbar() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const { data: settings, isLoading } = useOrganizationSettings(orgId);

  const [showLogo, setShowLogo] = useState(false);

  useEffect(() => {
    setShowLogo(!isLoading && !!settings?.name_en);
  }, [settings, isLoading]);

  if (!showLogo || isLoading) return null;

  const companyName = settings?.name_en ?? "مشروع الإطلاق";
  const primaryColor = settings?.primary_color ?? "#0d9488";
  const accentColor = settings?.accent_color ?? "#dc2626";

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Badge
          className="bg-brand-100 text-brand-800"
          aria-label="اسم الشركة"
        >
          <span className="self-center w-6 h-6 rounded-full bg-brand-200">
            {companyName.charAt(0)}
          </span>
          <span className="font-medium text-brand-900 truncate w-24">{companyName}</span>
        </Badge>
      </div>

      {/* Color indicators */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: primaryColor }}
        ></span>
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: accentColor }}
        ></span>
      </div>
    </div>
  );
}
