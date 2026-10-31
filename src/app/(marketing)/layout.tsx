// Static group (ADR-0017): no providers, no session, no cookies()/headers().
// WEB-A05 adds the site header and footer here.
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <main className="flex flex-1 flex-col">{children}</main>;
}
