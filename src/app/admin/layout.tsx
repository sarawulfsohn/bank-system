import { AdminNav } from "@/components/admin/admin-nav";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/auth";
import { getBindings } from "@/lib/db";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePageAdmin();
  const { env } = await getBindings();
  const sec = await env.DB.prepare("SELECT totp_enabled FROM users WHERE id = ?").bind(me.id).first<{ totp_enabled: number }>();
  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <AdminNav />
      {!sec?.totp_enabled && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Your account has no two-factor authentication.{" "}
          <Link href="/admin/security" className="underline underline-offset-4">Turn it on</Link>
        </p>
      )}
      {children}
    </main>
  );
}
