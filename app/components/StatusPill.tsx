import type { ApplicationStatus } from "@/lib/types";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  STATUS_PILL_CLASSES,
} from "@/lib/status";

export function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
