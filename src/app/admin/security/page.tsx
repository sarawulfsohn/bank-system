import { SecurityForm } from "@/components/admin/security-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageAdmin } from "@/lib/auth";
import { getBindings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const me = await requirePageAdmin();
  const { env } = await getBindings();
  const row = await env.DB.prepare("SELECT totp_enabled FROM users WHERE id = ?").bind(me.id).first<{ totp_enabled: number }>();
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent>
        <SecurityForm enabled={Boolean(row?.totp_enabled)} />
      </CardContent>
    </Card>
  );
}
