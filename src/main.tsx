import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
// Self-hosted Cairo (Arabic-first UI font): the PWA service worker can cache
// same-origin font files, so the app keeps its typography fully offline, and
// no font requests leave the organization's deployment to a third-party CDN.
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/500.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "@fontsource/cairo/800.css";
import "./index.css";
import { AuthProvider } from "@/app/AuthContext";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { queryClient } from "@/lib/queryClient";
import { registerServiceWorker } from "@/pwa/registerServiceWorker";
import { router } from "@/routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
