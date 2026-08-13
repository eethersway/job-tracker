/**
 * TypeScript types mirroring the JobTracker Supabase schema.
 * Keep these in sync with the database migrations.
 */

/** enum application_status */
export type ApplicationStatus =
  | "new"
  | "applied"
  | "screening"
  | "interviewing"
  | "negotiating"
  | "accepted"
  | "rejected"
  | "declined"
  | "ghosted";

export type DocumentType = "resume" | "cover_letter";

export type ApplicationSource = "manual" | "extension";

/** table: companies */
export interface Company {
  id: string;
  name: string;
  website: string | null;
  summary: string | null;
  size: string | null;
  industry: string | null;
  hq: string | null;
  funding: string | null;
  products: string | null;
  recent_news: string | null;
  research_md: string | null;
  researched_at: string | null;
  created_at: string;
}

/** table: applications */
export interface Application {
  id: string;
  user_id: string;
  company_id: string | null;
  company_name: string;
  job_title: string;
  job_url: string | null;
  job_description: string | null;
  location: string | null;
  salary: string | null;
  source: ApplicationSource;
  status: ApplicationStatus;
  notes: string | null;
  callouts_md: string | null;
  date_added: string;
  date_applied: string | null;
  updated_at: string;
}

/** table: documents */
export interface DocumentRow {
  id: string;
  application_id: string;
  type: DocumentType;
  content_md: string;
  created_at: string;
}

/** table: profile (one row per user, keyed by user_id = auth.uid()) */
export interface Profile {
  user_id: string;
  master_resume_md: string | null;
  full_name: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  website: string | null;
  highlights_md: string | null;
  skills_md: string | null;
  extra_context_md: string | null;
  anthropic_api_key: string | null;
  capture_token: string | null;
  onboarding_dismissed: boolean;
  updated_at: string;
}

/** Fields the user can set when creating an application by hand. */
export interface NewApplication {
  company_name: string;
  job_title: string;
  job_url: string | null;
  job_description: string | null;
  location: string | null;
  salary: string | null;
  date_applied: string | null;
  status: ApplicationStatus;
  source: ApplicationSource;
}

/** Response shape of the research-company edge function. */
export interface ResearchCompanyResponse {
  ok: boolean;
  company_id?: string;
  error?: string;
}

/** Response shape of the generate-document edge function. */
export interface GenerateDocumentResponse {
  ok: boolean;
  document_id?: string;
  /** True when a fit assessment was saved to applications.callouts_md. */
  has_callouts?: boolean;
  error?: string;
}
