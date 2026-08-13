"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";
import type { ApplicationStatus } from "@/lib/types";

interface AddApplicationModalProps {
  onClose: () => void;
  /** Called after a successful insert so the parent can refetch. */
  onCreated: () => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-sky-500";

const labelClass = "mb-1 block text-xs font-medium text-slate-400";

export function AddApplicationModal({
  onClose,
  onCreated,
}: AddApplicationModalProps) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [dateApplied, setDateApplied] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("new");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !jobTitle.trim()) {
      showToast("Company name and job title are required.", "error");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("applications").insert({
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
        job_url: jobUrl.trim() || null,
        job_description: description.trim() || null,
        location: location.trim() || null,
        salary: salary.trim() || null,
        date_applied: dateApplied || null,
        status,
        source: "manual",
      });
      if (error) throw new Error(error.message);
      showToast("Application added.", "success");
      onCreated();
      onClose();
    } catch (err) {
      showToast(
        `Could not add application: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Application" onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-company" className={labelClass}>
              Company name *
            </label>
            <input
              id="add-company"
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="add-title" className={labelClass}>
              Job title *
            </label>
            <input
              id="add-title"
              className={inputClass}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Senior Software Engineer"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="add-url" className={labelClass}>
            Job URL
          </label>
          <input
            id="add-url"
            className={inputClass}
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div>
          <label htmlFor="add-description" className={labelClass}>
            Job description
          </label>
          <textarea
            id="add-description"
            className={`${inputClass} min-h-28 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the job description here…"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-location" className={labelClass}>
              Location
            </label>
            <input
              id="add-location"
              className={inputClass}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Remote / New York, NY"
            />
          </div>
          <div>
            <label htmlFor="add-salary" className={labelClass}>
              Salary
            </label>
            <input
              id="add-salary"
              className={inputClass}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="$150k–$180k"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="add-date-applied" className={labelClass}>
              Date applied
            </label>
            <input
              id="add-date-applied"
              className={inputClass}
              type="date"
              value={dateApplied}
              onChange={(e) => setDateApplied(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="add-status" className={labelClass}>
              Status
            </label>
            <select
              id="add-status"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            Add application
          </button>
        </div>
      </form>
    </Modal>
  );
}
