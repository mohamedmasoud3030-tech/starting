import { useAuth } from "@/app/authContext";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export function CompanyNavbar() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const { data: settings, isLoading } = useOrganizationSettings(orgId);
  
  const [showLogo, setShowLogo] = useState(false);
  
  useEffect(() => {
    setShowLogo(!isLoading && settings?.data?.name_en);
  }, [settings, isLoading]);
  
  if (!showLogo || isLoading) return null;
  
  const companyName = settings.data.name_en ?? "مشروع الإطلاق";
  const primaryColor = settings.data.primary_color ?? "#059669";
  const accentColor = settings.data.accent_color ?? "#dc2626";
  
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Badge
          className="bg-primary-100 text-primary-800"
          aria-label="اسم الشركة"
        >
          {showLogo && (
            <span className="self-center w-6 h-6 rounded-full bg-primary-200">
              {showLogo ? showLogo[0] : "؟"}
            </span>
          )}
          <span className="font-medium text-primary-900 truncate w-24">{companyName}</span>
        </Badge>
      </div>
      
      {/* Color indicators */}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full bg-primary-600"></span>
        <span className="w-2 h-2 rounded-full bg-accent-600"></span>
      </div>
    </div>
  );
}
