"use client";

/**
 * App-wide in-flight generation tracker.
 *
 * Document generation takes up to ~2 minutes. If the request lived inside the
 * DocumentsPanel component, switching tabs or pages would unmount it and lose
 * both the spinner state and the completion callback. Instead, the request is
 * started here at module scope: it survives any client-side navigation, and
 * panels subscribe to be re-rendered when a generation starts or finishes.
 *
 * (A full browser reload still drops the spinner, but the edge function keeps
 * running server-side and the document appears on the next visit.)
 */

import { createClient } from "@/lib/supabase/client";
import type { DocumentType, GenerateDocumentResponse } from "@/lib/types";

export interface GenerationResult {
  ok: boolean;
  document_id?: string;
  error?: string;
}

const pending = new Map<string, Promise<GenerationResult>>();
/** Finished results not yet consumed by a mounted panel (keyed like pending). */
const unconsumed = new Map<string, GenerationResult>();
const listeners = new Set<() => void>();

const keyOf = (applicationId: string, type: DocumentType) =>
  `${applicationId}:${type}`;

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* listener errors must not break others */
    }
  });
}

/** Is a generation currently running for this application + type? */
export function isGenerating(applicationId: string, type: DocumentType) {
  return pending.has(keyOf(applicationId, type));
}

/**
 * Take (and clear) the finished-but-unseen result for this application +
 * type, if any. Returns null when there is nothing to consume.
 */
export function takeResult(
  applicationId: string,
  type: DocumentType
): GenerationResult | null {
  const k = keyOf(applicationId, type);
  const r = unconsumed.get(k) ?? null;
  if (r) unconsumed.delete(k);
  return r;
}

/** Subscribe to start/finish events. Returns an unsubscribe function. */
export function subscribeGeneration(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Kick off a generation (no-op if one is already running for this key). */
export function startGeneration(applicationId: string, type: DocumentType) {
  const k = keyOf(applicationId, type);
  if (pending.has(k)) return;

  const supabase = createClient();
  const p: Promise<GenerationResult> = supabase.functions
    .invoke("generate-document", {
      body: { application_id: applicationId, type },
    })
    .then(({ data, error }) => {
      if (error) return { ok: false, error: error.message };
      const r = data as GenerateDocumentResponse | null;
      if (!r?.ok) {
        return { ok: false, error: r?.error ?? "Generation reported failure." };
      }
      return { ok: true, document_id: r.document_id };
    })
    .catch((e: unknown) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));

  pending.set(k, p);
  notify();

  void p.then((result) => {
    pending.delete(k);
    unconsumed.set(k, result);
    notify();
  });
}
