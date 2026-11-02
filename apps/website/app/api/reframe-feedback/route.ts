import { MongoClient } from "mongodb";

/** Reports are numbers about one clip (face boxes, speech levels, crop keys); a few minutes of analysis is well under this. */
const MAX_BYTES = 4_000_000;

let client: MongoClient | null = null;
async function collection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  client ??= new MongoClient(uri);
  await client.connect();
  return client.db(process.env.MONGODB_DB ?? "cutiva").collection("reframe_feedback");
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ONE_OF = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);

/** Auto-reframe feedback from the playground. See apps/playground/src/ReframeFeedback.tsx for the shape. */
export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BYTES) return json(413, { ok: false, error: "Send one report, under 4 MB." });
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "Send JSON." });
  }
  if (
    !isObj(report) ||
    report.version !== 1 ||
    !ONE_OF(report.overall, ["good", "ok", "bad"]) ||
    !isObj(report.settings) ||
    !isObj(report.analysis) ||
    !Array.isArray(report.analysis.frames) ||
    !isObj(report.auto) ||
    !Array.isArray(report.final) ||
    !Array.isArray(report.ratings) ||
    (report.comment !== undefined && (typeof report.comment !== "string" || report.comment.length > 2000))
  ) {
    return json(400, { ok: false, error: "That isn't an auto-reframe feedback report." });
  }

  const col = await collection().catch(() => null);
  if (!col) return json(503, { ok: false, error: "Feedback storage isn't set up yet." });
  // The report's own assetId is a random id from the browser; nothing in it names the file or the person.
  await col.insertOne({ ...report, receivedAt: new Date() });
  return json(200, { ok: true });
}
