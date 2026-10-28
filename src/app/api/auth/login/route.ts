import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import {
  assertSameOrigin, checkCredentials, checkTotp, clearFailedLogins, clientIp, createSession,
  ensureAdminSeeded, errorResponse, loginLimits, normalizeEmail, overLimit, readJson, recordAttempts,
} from "@/lib/auth";

const INVALID = "Invalid email or password";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await ensureAdminSeeded();

    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const code = typeof body.code === "string" ? body.code.slice(0, 12) : "";
    if (!email || !password) return NextResponse.json({ error: INVALID }, { status: 401 });

    const ip = clientIp(req);
    const limits = loginLimits(email, ip);
    if (await overLimit(limits))
      return NextResponse.json(
        { error: "Too many failed sign-in attempts. Please wait 15 minutes and try again." },
        { status: 429 }
      );

    const user = await checkCredentials(email, password);
    if (!user) {
      await recordAttempts(limits);
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }

    // Two-factor: right password but no code yet is not a failure, it asks for the code
    if (user.totpSecret !== null) {
      if (!code) return NextResponse.json({ error: "Enter your authentication code", needsCode: true }, { status: 401 });
      if (!(await checkTotp(user.id, user.totpSecret, code))) {
        await recordAttempts(limits);
        await audit(user, "login.bad_code");
        return NextResponse.json({ error: "That code isn't right", needsCode: true }, { status: 401 });
      }
    }

    await clearFailedLogins(`${email}|${ip}`);
    const res = NextResponse.json({ ok: true });
    await createSession(res, req, user.id);
    if (user.role === "admin") await audit(user, "login");
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
