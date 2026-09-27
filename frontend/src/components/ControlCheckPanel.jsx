import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useApp } from "@/context/AppContext";

export default function ControlCheckPanel({ checks = [], reconciled = true }) {
  const { t } = useApp();
  return (
    <div data-testid="control-check-warning-panel" className="space-y-2">
      <div
        className={`flex items-center justify-between p-4 rounded-lg border font-mono text-sm font-semibold ${
          reconciled
            ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
            : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
        }`}
      >
        <span className="flex items-center gap-2">
          {reconciled ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          {reconciled ? t("reconciled") : t("has_warnings")}
        </span>
        <span className="hidden sm:inline">{t("control_check")}</span>
      </div>
      {checks.map((c, i) => (
        <div
          key={i}
          data-testid={`control-check-${c.code}-${i}`}
          className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
            c.level === "error"
              ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
              : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {c.message}
        </div>
      ))}
    </div>
  );
}
