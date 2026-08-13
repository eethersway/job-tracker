import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "StrongerApplicant - AI-powered job application tracker",
  description:
    "Track every application, get automatic company research, and generate tailored resumes and cover letters. Apply stronger, not just more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
