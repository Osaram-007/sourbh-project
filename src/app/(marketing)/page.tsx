import Link from "next/link";

// Placeholder until WEB-B01 builds the landing page. No numbers or claims (T-1, T-2).
export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">FullCharge</h1>
      <p>Find EV charging stations in India.</p>
      <Link href="/app" prefetch={false} className="font-semibold underline underline-offset-4">
        Open the map
      </Link>
    </div>
  );
}
