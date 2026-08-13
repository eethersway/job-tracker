import type { ApplicationStatus } from "@/lib/types";

/** Display order for status chips and dropdowns. */
export const STATUS_ORDER: ApplicationStatus[] = [
  "new",
  "applied",
  "screening",
  "interviewing",
  "negotiating",
  "accepted",
  "rejected",
  "declined",
  "ghosted",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: "New",
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  negotiating: "Negotiating",
  accepted: "Accepted",
  rejected: "Rejected",
  declined: "Declined",
  ghosted: "Ghosted",
};

/**
 * Tailwind classes for the colored status pills.
 * blue = applied, teal = screening, purple = interviewing,
 * amber = negotiating, green = accepted, red = rejected,
 * gray = new / declined / ghosted.
 */
export const STATUS_PILL_CLASSES: Record<ApplicationStatus, string> = {
  new: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  applied: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  screening: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  interviewing: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  negotiating: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  accepted: "bg-green-500/15 text-green-300 border-green-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  declined: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  ghosted: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

/** Solid dot colors used inside chips/pills. */
export const STATUS_DOT_CLASSES: Record<ApplicationStatus, string> = {
  new: "bg-slate-400",
  applied: "bg-blue-400",
  screening: "bg-teal-400",
  interviewing: "bg-purple-400",
  negotiating: "bg-amber-400",
  accepted: "bg-green-400",
  rejected: "bg-red-400",
  declined: "bg-slate-500",
  ghosted: "bg-slate-500",
};
