import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser } from "@/lib/auth";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Link href="/" className="font-semibold">
          Bank Statement Parser
        </Link>
        {user && (
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            {user.role === "admin" && (
              <Link href="/admin" className="text-muted-foreground hover:text-foreground hover:underline">
                Admin
              </Link>
            )}
            <span className="max-w-[16rem] truncate text-muted-foreground" title={user.email}>
              {user.email}
            </span>
            <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
            <LogoutButton />
          </nav>
        )}
      </div>
    </header>
  );
}
