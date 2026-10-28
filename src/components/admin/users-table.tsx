"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction, adminRequest } from "@/components/admin/confirm-action";
import { dateTime } from "@/lib/format";
import type { AdminUserRow } from "@/lib/types";

export function UsersTable({ users, meId }: { users: AdminUserRow[]; meId: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const activeAdmins = users.filter((u) => u.role === "admin" && !u.disabled).length;

  async function act(id: string, body: object | null) {
    const url = `/api/admin/users/${id}`;
    const err = body ? await adminRequest(url, "PATCH", body) : await adminRequest(url, "DELETE");
    if (!err) router.refresh();
    return err;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead className="text-right">Docs</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isMe = u.id === meId;
            // Mirrors the server guard rails; the API enforces them regardless
            const lastAdmin = u.role === "admin" && !u.disabled && activeAdmins <= 1;
            const locked = isMe || lastAdmin;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.email}
                  {isMe && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                  {u.role === "admin" && (
                    <Badge variant="outline" className="ml-1">{u.totp_enabled ? "2FA" : "no 2FA"}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.disabled ? <Badge variant="destructive">disabled</Badge> : <Badge variant="outline">active</Badge>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{dateTime(u.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{dateTime(u.last_login_at)}</TableCell>
                <TableCell className="text-right">{u.document_count}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.role === "user" ? (
                      <ConfirmAction
                        label="Promote"
                        title={`Make ${u.email} an admin?`}
                        description="Admins can see every user's documents and manage accounts. Their current sessions will be signed out."
                        onConfirm={() => act(u.id, { action: "promote" })}
                      />
                    ) : (
                      <ConfirmAction
                        label="Demote"
                        disabled={locked}
                        title={`Remove admin rights from ${u.email}?`}
                        description="They will become a normal user and be signed out."
                        onConfirm={() => act(u.id, { action: "demote" })}
                      />
                    )}
                    {u.disabled ? (
                      <ConfirmAction
                        label="Enable"
                        title={`Enable ${u.email}?`}
                        description="They will be able to sign in again."
                        onConfirm={() => act(u.id, { action: "enable" })}
                      />
                    ) : (
                      <ConfirmAction
                        label="Disable"
                        disabled={locked}
                        title={`Disable ${u.email}?`}
                        description="They will be signed out everywhere and can't sign in until re-enabled."
                        onConfirm={() => act(u.id, { action: "disable" })}
                      />
                    )}
                    <ConfirmAction
                      label="Reset password"
                      title={`Set a new password for ${u.email}`}
                      description="All of their sessions will be signed out. Share the new password with them securely."
                      confirmLabel="Set password"
                      onConfirm={async () => {
                        const err = await act(u.id, { action: "reset_password", password: newPassword });
                        if (!err) setNewPassword("");
                        return err;
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor={`pw-${u.id}`}>New password (at least 10 characters)</Label>
                        <Input
                          id={`pw-${u.id}`}
                          type="password"
                          autoComplete="new-password"
                          maxLength={256}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>
                    </ConfirmAction>
                    {u.totp_enabled && !isMe ? (
                      <ConfirmAction
                        label="Reset 2FA"
                        title={`Turn off two-factor for ${u.email}?`}
                        description="Use this if they lost their authenticator. They will be signed out and can set it up again."
                        onConfirm={() => act(u.id, { action: "reset_2fa" })}
                      />
                    ) : null}
                    <ConfirmAction
                      label="Delete"
                      destructive
                      disabled={locked}
                      title={`Delete ${u.email}?`}
                      description={`This permanently deletes the account and its ${u.document_count} document(s). This can't be undone.`}
                      onConfirm={() => act(u.id, null)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
