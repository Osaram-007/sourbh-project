import type { Metadata } from "next";
import AuthProvider from "@/providers/AuthProvider";
import QueryProvider from "@/providers/QueryProvider";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// The dark classes used to sit on <body> in the root layout. WEB-B19 replaces
// this with the admin shell and `requireAdmin()`.
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="dark flex flex-1 flex-col bg-slate-950 text-slate-100">
      <AuthProvider>
        <QueryProvider>{children}</QueryProvider>
      </AuthProvider>
    </div>
  );
}
