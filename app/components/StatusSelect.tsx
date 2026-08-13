"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ApplicationStatus } from "@/lib/types";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_PILL_CLASSES,
} from "@/lib/status";
import { Spinner } from "@/components/Spinner";

interface StatusSelectProps {
  value: ApplicationStatus;
  onChange: (next: ApplicationStatus) => void | Promise<void>;
  /** Show a small spinner while the change is being saved. */
  saving?: boolean;
}

/**
 * Inline status editor: renders the colored pill; clicking it opens a
 * dropdown of all statuses.
 *
 * The menu is rendered in a document.body portal with fixed positioning so
 * it can never be clipped by scroll containers (e.g. the dashboard table's
 * overflow-x-auto wrapper).
 */
export function StatusSelect({ value, onChange, saving }: StatusSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const MENU_HEIGHT = 300; // approximate; used to flip upward near viewport bottom
  const MENU_WIDTH = 176; // w-44

  const openMenu = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const openUp = r.bottom + MENU_HEIGHT > window.innerHeight && r.top > MENU_HEIGHT;
    setPos({
      top: openUp ? r.top - MENU_HEIGHT - 4 : r.bottom + 4,
      left: Math.min(r.left, window.innerWidth - MENU_WIDTH - 8),
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition hover:brightness-125 ${STATUS_PILL_CLASSES[value]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[value]}`}
        />
        {STATUS_LABELS[value]}
        {saving ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <svg
            className="h-3 w-3 opacity-60"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {open && pos !== null &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-[100] w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl"
          >
            {STATUS_ORDER.map((status) => (
              <li key={status}>
                <button
                  type="button"
                  role="option"
                  aria-selected={status === value}
                  onClick={() => {
                    setOpen(false);
                    if (status !== value) void onChange(status);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-800 ${
                    status === value ? "bg-slate-800/60" : ""
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[status]}`}
                  />
                  <span className="text-slate-200">{STATUS_LABELS[status]}</span>
                  {status === value && (
                    <span className="ml-auto text-slate-400">✓</span>
                  )}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
