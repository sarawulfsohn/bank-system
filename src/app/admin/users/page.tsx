import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsersTable } from "@/components/admin/users-table";
import { InvitePanel } from "@/components/admin/invite-panel";
import { listInvites } from "@/lib/invites";
import { requirePageAdmin } from "@/lib/auth";
import { getStats, listUsers } from "@/lib/db";
import { modelLabel } from "@/lib/models";
import { seconds } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export default async function AdminUsersPage() {
  const me = await requirePageAdmin();
  const [stats, users, invites] = await Promise.all([getStats(), listUsers(), listInvites()]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Users" value={stats.total_users} />
        <Stat label="Documents" value={stats.total_documents} />
        <Stat label="Avg processing time" value={seconds(stats.avg_duration_ms)} />
        <Stat label="Failures (last 24h)" value={stats.failed_last_24h} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Documents by status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.by_status.length === 0 && <span className="text-sm text-muted-foreground">None yet</span>}
            {stats.by_status.map((s) => (
              <Badge key={s.status} variant={s.status === "failed" ? "destructive" : "secondary"}>
                {s.status}: {s.n}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Documents by model</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.by_model.length === 0 && <span className="text-sm text-muted-foreground">None yet</span>}
            {stats.by_model.map((m) => (
              <Badge key={m.model} variant="outline">
                {modelLabel(m.model)}: {m.n}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite applicants</CardTitle>
        </CardHeader>
        <CardContent>
          <InvitePanel invites={invites} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={users} meId={me.id} />
        </CardContent>
      </Card>
    </div>
  );
}
