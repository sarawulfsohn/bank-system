import { notFound, redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, registrationEnabled, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>;
}) {
  const { next, invite } = await searchParams;
  // Without open sign-up, the page only exists for someone holding an invite link
  if (!(await registrationEnabled()) && !invite) notFound();
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex justify-center p-6 pt-16">
      <AuthForm mode="register" next={safeNext(next)} invite={invite} />
    </main>
  );
}
