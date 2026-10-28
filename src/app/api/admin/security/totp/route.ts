import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import {
  assertSameOrigin, checkTotp, errorResponse, getPepper, HttpError, readJson, requireAdmin,
} from "@/lib/auth";
import { getBindings } from "@/lib/db";
import { encryptSecret, newSecret, otpauthUri } from "@/lib/totp";

// Two-factor setup for the signed-in admin.
//   begin   -> makes a secret (not active yet) and returns it for the authenticator app
//   enable  -> activates it once a code from the app checks out
//   disable -> turns it off; needs a current code
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await readJson(req);
    const code = typeof body.code === "string" ? body.code : "";
    const { env } = await getBindings();
    const row = await env.DB.prepare("SELECT totp_enabled, totp_secret FROM users WHERE id = ?")
      .bind(admin.id)
      .first<{ totp_enabled: number; totp_secret: string | null }>();

    switch (body.action) {
      case "begin": {
        if (row?.totp_enabled) throw new HttpError(409, "Two-factor is already on");
        const pepper = await getPepper();
        if (!pepper) throw new HttpError(500, "PASSWORD_PEPPER is not configured, so the secret can't be stored safely");
        const secret = newSecret();
        await env.DB.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?")
          .bind(await encryptSecret(secret, pepper), admin.id)
          .run();
        return NextResponse.json({ secret, uri: otpauthUri(secret, admin.email) });
      }
      case "enable": {
        if (!row?.totp_secret || row.totp_enabled) throw new HttpError(409, "Start setup first");
        if (!(await checkTotp(admin.id, row.totp_secret, code))) throw new HttpError(400, "That code isn't right");
        await env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").bind(admin.id).run();
        await audit(admin, "2fa.enable");
        return NextResponse.json({ ok: true });
      }
      case "disable": {
        if (!row?.totp_enabled || !row.totp_secret) throw new HttpError(409, "Two-factor is not on");
        if (!(await checkTotp(admin.id, row.totp_secret, code))) throw new HttpError(400, "That code isn't right");
        await env.DB.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").bind(admin.id).run();
        await audit(admin, "2fa.disable");
        return NextResponse.json({ ok: true });
      }
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
