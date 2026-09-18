import { createHash, randomUUID } from "node:crypto";
import { createServer, request, type Server } from "node:http";

export interface PilotPayload {
  accountId: string;
  jobId: string;
  articleId: string;
  snapshotId: string;
  intentId?: string;
  title: string;
  body: string;
  imageBase64: string;
  imageSha256: string;
}
export interface PilotReceipt extends PilotPayload { externalId: string; acceptedAt: string }
export interface PilotEndpoint { origin: string; token: string }
export interface PilotPlatform {
  endpoint: PilotEndpoint;
  uploads: PilotPayload[];
  receipts: PilotReceipt[];
  setMode(mode: "accepted" | "lost-response" | "rejected"): void;
  close(): Promise<void>;
}

export function assertPilotEndpoint(endpoint: PilotEndpoint): URL {
  const url = new URL(endpoint.origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password || endpoint.token.length < 32) throw new Error("PILOT_LOOPBACK_ENDPOINT_REQUIRED");
  return url;
}

function parsePayload(value: unknown): PilotPayload {
  if (!value || typeof value !== "object") throw new Error("PILOT_INVALID_PAYLOAD");
  const record = value as Record<string, unknown>;
  for (const key of ["accountId", "jobId", "articleId", "snapshotId", "title", "body", "imageBase64", "imageSha256"]) if (typeof record[key] !== "string" || !record[key]) throw new Error(`PILOT_INVALID_${key}`);
  const payload = record as unknown as PilotPayload;
  const bytes = Buffer.from(payload.imageBase64, "base64");
  if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== payload.imageSha256.toLowerCase()) throw new Error("PILOT_IMAGE_BYTES_MISMATCH");
  return payload;
}

export async function startPilotPlatform(onMutation?: () => void): Promise<PilotPlatform> {
  const token = randomUUID() + randomUUID();
  const uploads: PilotPayload[] = [];
  const receipts: PilotReceipt[] = [];
  let mode: "accepted" | "lost-response" | "rejected" = "accepted";
  const server: Server = createServer((req, res) => {
    if (req.headers["x-pilot-token"] !== token) { res.writeHead(403).end(); return; }
    if (req.method === "GET" && req.url === "/receipts") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(receipts)); return; }
    if (req.method !== "POST" || !["/upload", "/submit"].includes(req.url ?? "")) { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = []; let length = 0;
    req.on("data", (chunk: Buffer) => { length += chunk.length; if (length > 4_000_000) req.destroy(); else chunks.push(chunk); });
    req.on("end", () => {
      try {
        const payload = parsePayload(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/upload") { uploads.push(payload); onMutation?.(); res.end(JSON.stringify({ imageSha256: payload.imageSha256, byteLength: Buffer.from(payload.imageBase64, "base64").length })); return; }
        if (!payload.intentId) throw new Error("PILOT_INTENT_REQUIRED");
        if (mode === "rejected") { res.writeHead(422).end(JSON.stringify({ rejected: true })); return; }
        const receipt: PilotReceipt = { ...payload, externalId: `synthetic-${randomUUID()}`, acceptedAt: new Date().toISOString() };
        // Deliberately no server deduplication: duplicate sends must remain visible.
        receipts.push(receipt);
        onMutation?.();
        if (mode === "lost-response") { req.socket.destroy(); return; }
        res.end(JSON.stringify(receipt));
      } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : "INVALID" })); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PILOT_LOOPBACK_BIND_FAILED");
  return { endpoint: { origin: `http://127.0.0.1:${address.port}`, token }, uploads, receipts, setMode: (next) => { mode = next; }, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export async function pilotRequest(endpoint: PilotEndpoint, path: "/upload" | "/submit" | "/receipts", payload?: PilotPayload): Promise<unknown> {
  const base = assertPilotEndpoint(endpoint);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: base.port, path, method: payload ? "POST" : "GET", headers: { "x-pilot-token": endpoint.token, "Content-Type": "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => { try { if (res.statusCode !== 200) throw new Error(`PILOT_HTTP_${res.statusCode}`); resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); } });
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("PILOT_REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.end(payload ? JSON.stringify(payload) : undefined);
  });
}
