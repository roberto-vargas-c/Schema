import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-gradient-to-br from-brand-50 via-white to-amber-50 p-6">
      <Link href="/"><Logo /></Link>
      {children}
      <footer className="text-xs text-slate-500"><Link href="/privacy" className="hover:underline">Privacy policy</Link></footer>
    </div>
  );
}
