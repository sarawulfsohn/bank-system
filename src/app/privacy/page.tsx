import Link from "next/link";

export const metadata = { title: "Privacy notice" };

// Describes what the app actually does. The company running it should review the wording,
// add its legal name and contact details, and fill in the retention period it applies.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 text-sm leading-relaxed">
      <Link href="/" className="text-muted-foreground hover:underline">← Back</Link>
      <h1 className="text-2xl font-semibold">Privacy notice</h1>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">What we collect</h2>
        <p>
          The bank statements you upload (the PDF itself), the details read from them (account holder, bank, account
          number&apos;s last four digits, balances and every transaction line), and your email address and sign-in activity.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">How it is used</h2>
        <p>
          Statements are read automatically so that the company reviewing your application can assess it. Reviewers can
          see every statement you upload, the extracted figures and the original PDF. The automatic reading can make mistakes,
          so reviewers may check figures against the original.
        </p>
        <p>
          The text of each statement is processed by an AI model hosted by Cloudflare (Workers AI) in order to read it.
          Files are stored with Cloudflare (R2 and D1) and are not used to train models.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Who can see it</h2>
        <p>
          Only you and the administrators of this service. Administrator access is logged. Other applicants cannot see
          your documents.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">How long we keep it</h2>
        <p>
          Documents are kept until an administrator deletes them. Applicants cannot delete submitted statements, so ask the
          company you applied to if you want yours removed. They can delete your account together with everything attached to it.
        </p>
      </section>
    </main>
  );
}
