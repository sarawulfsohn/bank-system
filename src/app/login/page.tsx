import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, registrationEnabled, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="flex justify-center p-6 pt-16">
      <AuthForm mode="login" next={safeNext(next)} canRegister={await registrationEnabled()} />
    </main>
  );
}
