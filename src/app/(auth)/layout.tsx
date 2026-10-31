import type { Metadata } from "next";

// ADR-0017: /login lives here (WEB-B06) and is the only group that imports Firebase.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
