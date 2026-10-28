import type { APIRoute } from "astro";
import { MongoClient } from "mongodb";

// Runs on the server; every other page is static HTML.
export const prerender = false;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

let client: MongoClient | null = null;
async function collection() {
  const uri = import.meta.env.MONGODB_URI ?? process.env.MONGODB_URI;
  if (!uri) return null;
  client ??= new MongoClient(uri);
  await client.connect();
  return client.db(process.env.MONGODB_DB ?? "cutiva").collection("waitlist");
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async ({ request }) => {
  let data: Record<string, unknown> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    data = type.includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : Object.fromEntries(await request.formData());
  } catch {
    return json(400, { ok: false, error: "Send an email address." });
  }

  // Honeypot: real people never fill this hidden field.
  if (typeof data.company === "string" && data.company.length > 0) return json(200, { ok: true });

  const email = String(data.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) return json(400, { ok: false, error: "That email address doesn't look valid." });

  const col = await collection().catch(() => null);
  if (!col) return json(503, { ok: false, error: "The waitlist isn't open yet. Follow the repo on GitHub in the meantime." });

  await col.updateOne(
    { email },
    { $setOnInsert: { email, createdAt: new Date(), source: "cutiva.dev" } },
    { upsert: true },
  );
  return json(200, { ok: true });
};
