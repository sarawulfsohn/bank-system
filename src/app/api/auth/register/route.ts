import { NextResponse } from "next/server";
import { getBindings } from "@/lib/db";
import { claimInvite, markInviteUsed, releaseInvite } from "@/lib/invites";
import {
  assertSameOrigin, clientIp, createSession, errorResponse, hashPassword, normalizeEmail,
  overLimit, passwordProblem, readJson, recordAttempts, registerLimits, registrationEnabled,
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await readJson(req);

    // Every attempt counts toward the per-IP limit, successful or not
    const { env } = await getBindings();
    const limits = registerLimits(clientIp(req), Number((env as { REGISTER_RATE_LIMIT?: string }).REGISTER_RATE_LIMIT) || 5);
    if (await overLimit(limits))
      return NextResponse.json({ error: "Too many sign-up attempts. Please try again later." }, { status: 429 });
    await recordAttempts(limits);

    const open = await registrationEnabled();
    const token = typeof body.invite === "string" ? body.invite : "";
    if (!open && !token)
      return NextResponse.json({ error: "Sign-up is by invitation only" }, { status: 403 });

    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    // An invite is used up before the account is created, and given back if creation fails
    let invite: string | null = null;
    if (!open) {
      invite = await claimInvite(token);
      if (!invite) return NextResponse.json({ error: "This invite link is invalid or has expired" }, { status: 403 });
    }

    const id = crypto.randomUUID();
    // Self-registration only ever creates role "user"
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)"
    )
      .bind(id, email, await hashPassword(body.password as string), Date.now())
      .run();
    if (!res.meta.changes) {
      if (invite) await releaseInvite(invite);
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    if (invite) await markInviteUsed(invite, id);

    const out = NextResponse.json({ ok: true }, { status: 201 });
    await createSession(out, req, id);
    return out;
  } catch (e) {
    return errorResponse(e);
  }
}
