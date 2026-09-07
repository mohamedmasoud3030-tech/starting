import { useAuth } from "@/app/authContext";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  showCompanyBranding?: boolean;
};

export function PageHeader({
  title,
  description,
  actions,
  showCompanyBranding = true,
}: PageHeaderProps) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const { data: settings, isLoading } = useOrganizationSettings(orgId);
  
  const [showBranding, setShowBranding] = useState(false);
  
  useEffect(() => {
    setShowBranding(!isLoading && settings?.data?.name_en);
  }, [settings, isLoading]);
  
  const companyName = settings?.data?.name_en ?? "مشروع الإطلاق";
  const primaryColor = settings?.data?.primary_color ?? "#059669";
  const accentColor = settings?.data?.accent_color ?? "#dc2626";
  
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      {/* Company branding row - appears below title on mobile, above on desktop */}
      {showCompanyBranding && showBranding && (
        <div className="flex items-center gap-3 mb-3 sm:mb-0 sm:order-2">
          <Badge
            className={cn(
              "bg-primary-100 text-primary-800 text-xs font-medium rounded-xl",
              "transition-colors hover:bg-primary-200"
            )}
          >
            <span className="font-medium truncate w-32">{companyName}</span>
          </Badge>
          <div className="flex gap-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-primary-600"></span>
            <span className="w-2 h-2 rounded-full bg-accent-600"></span>
          </div>
        </div>
      )}
      
      <div className="min-w-0">
        <h1 className="text-xl font-black leading-tight text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
            {description}
          </p>
        )}
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-none">
            {actions}
          </div>
        )}
      )}
    </div>
  );
}
