import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import multer from "multer";
import { Server } from "socket.io";
import { z } from "zod";
import { authMiddleware, signToken, type AuthClaims, type AuthedRequest } from "./auth.js";
import { env } from "./config.js";
import { registerRealtime } from "./realtime.js";
import { ChatMessageModel, ParticipantModel, RoomModel, UserModel } from "./models.js";

const app = express();
const allowedOrigins = new Set<string>([
  env.CLIENT_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174"
]);

const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
  // Allow non-browser clients and same-origin tools (curl/postman).
  if (!origin) return callback(null, true);
  if (allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

type SubscriptionTier = "free" | "standard" | "premium";
const tierWeight: Record<SubscriptionTier, number> = { free: 0, standard: 1, premium: 2 };
const hasTierAccess = (userTier: SubscriptionTier, requiredTier: SubscriptionTier) => tierWeight[userTier] >= tierWeight[requiredTier];
function resolveTierFromAccessKey(key: string): SubscriptionTier | null {
  if (key === env.OTT_PREMIUM_ACCESS_KEY) return "premium";
  if (key === env.OTT_STANDARD_ACCESS_KEY) return "standard";
  return null;
}

const ottCatalog = [
  { assetId: "moonlight-voyage", title: "Moonlight Voyage", tier: "premium", streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", posterUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200" },
  { assetId: "space-city-live", title: "Space City Live", tier: "standard", streamUrl: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8", posterUrl: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200" }
] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../uploads");
mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
app.use("/uploads", express.static(uploadDir));

app.post("/api/auth/register", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(6), displayName: z.string().min(2).max(32) }).safeParse(req.body);
  if (!body.success) return void res.status(400).json(body.error.format());
  const existing = await UserModel.findOne({ email: body.data.email });
  if (existing) return void res.status(409).json({ error: "Email already exists" });
  const user = await UserModel.create({ email: body.data.email, passwordHash: await bcrypt.hash(body.data.password, 10), displayName: body.data.displayName });
  const token = signToken({ userId: String(user._id), email: user.email, displayName: user.displayName });
  res.status(201).json({ token });
});

app.post("/api/auth/login", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(6) }).safeParse(req.body);
  if (!body.success) return void res.status(400).json(body.error.format());
  const user = await UserModel.findOne({ email: body.data.email });
  if (!user) return void res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(body.data.password, user.passwordHash);
  if (!ok) return void res.status(401).json({ error: "Invalid credentials" });
  const token = signToken({ userId: String(user._id), email: user.email, displayName: user.displayName });
  res.json({ token });
});

app.get("/api/auth/me", authMiddleware, (req: AuthedRequest, res) => res.json(req.auth));

app.post("/api/rooms", authMiddleware, async (req: AuthedRequest, res) => {
  const body = z.object({
    name: z.string().min(2).max(80),
    passcode: z.string().min(4).max(12).optional(),
    media: z.object({
      sourceType: z.enum(["local", "url", "youtube", "protected_hls"]),
      sourceUrl: z.string().url(),
      title: z.string().min(1).max(120)
    })
  }).safeParse(req.body);
  if (!body.success || !req.auth) return void res.status(400).json({ error: "Invalid payload" });
  const room = await RoomModel.create({
    name: body.data.name,
    hostUserId: req.auth.userId,
    passcode: body.data.passcode ?? null,
    media: body.data.media,
    playbackState: { isPlaying: false, positionSec: 0, speed: 1, serverTimestampMs: Date.now() }
  });
  await ParticipantModel.create({ roomId: room.roomId, userId: req.auth.userId, role: "host" });
  res.status(201).json({ roomId: room.roomId });
});

app.post("/api/rooms/:roomId/join", authMiddleware, async (req: AuthedRequest, res) => {
  const body = z.object({ passcode: z.string().optional() }).safeParse(req.body ?? {});
  if (!body.success || !req.auth) return void res.status(400).json({ error: "Invalid payload" });
  const room = await RoomModel.findOne({ roomId: req.params.roomId });
  if (!room) return void res.status(404).json({ error: "Room not found" });
  if (room.passcode && room.passcode !== body.data.passcode) return void res.status(401).json({ error: "Invalid passcode" });
  await ParticipantModel.updateOne({ roomId: room.roomId, userId: req.auth.userId }, { $set: { role: "viewer" } }, { upsert: true });
  const recentMessages = await ChatMessageModel.find({ roomId: room.roomId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ roomId: room.roomId, media: room.media, playbackState: room.playbackState, recentMessages: recentMessages.reverse() });
});

app.post("/api/rooms/:roomId/end", authMiddleware, async (req: AuthedRequest, res) => {
  if (!req.auth) return void res.status(401).json({ error: "Unauthorized" });
  const room = await RoomModel.findOne({ roomId: req.params.roomId });
  if (!room) return void res.status(404).json({ error: "Room not found" });
  if (String(room.hostUserId) !== req.auth.userId) return void res.status(403).json({ error: "Only host can end this room" });
  await Promise.all([RoomModel.deleteOne({ roomId: room.roomId }), ParticipantModel.deleteMany({ roomId: room.roomId }), ChatMessageModel.deleteMany({ roomId: room.roomId })]);
  res.json({ ok: true });
});

app.get("/api/ott/catalog", authMiddleware, async (req: AuthedRequest, res) => {
  const user = req.auth?.userId ? await UserModel.findById(req.auth.userId).lean() : null;
  const userTier = (user?.subscriptionTier as SubscriptionTier | undefined) ?? "free";
  res.json({
    items: ottCatalog.map((asset) => ({
      assetId: asset.assetId,
      title: asset.title,
      tier: asset.tier,
      posterUrl: asset.posterUrl,
      isUnlocked: hasTierAccess(userTier, asset.tier as SubscriptionTier)
    }))
  });
});

app.post("/api/ott/authorize", authMiddleware, async (req: AuthedRequest, res) => {
  const body = z.object({ accessKey: z.string().min(6) }).safeParse(req.body);
  if (!body.success || !req.auth) return void res.status(400).json({ error: "Invalid payload" });
  const grantedTier = resolveTierFromAccessKey(body.data.accessKey);
  if (!grantedTier) return void res.status(403).json({ error: "Invalid OTT access key" });
  const user = await UserModel.findById(req.auth.userId);
  const currentTier = (user?.subscriptionTier as SubscriptionTier | undefined) ?? "free";
  const finalTier = hasTierAccess(currentTier, grantedTier) ? currentTier : grantedTier;
  if (user) {
    user.subscriptionTier = finalTier;
    await user.save();
  }
  const entitlementToken = jwt.sign({ userId: req.auth.userId, scope: "ott:session:create", tier: finalTier }, env.JWT_SECRET, { expiresIn: "30m" });
  res.json({ entitlementToken, grantedTier: finalTier, expiresIn: "30m" });
});

app.post("/api/ott/session", authMiddleware, async (req: AuthedRequest, res) => {
  const body = z.object({ assetId: z.string().min(2), entitlementToken: z.string().min(20) }).safeParse(req.body);
  if (!body.success || !req.auth) return void res.status(400).json({ error: "Invalid payload" });
  const asset = ottCatalog.find((item) => item.assetId === body.data.assetId);
  if (!asset) return void res.status(404).json({ error: "OTT asset not found" });
  let tokenTier: SubscriptionTier = "free";
  try {
    const decoded = jwt.verify(body.data.entitlementToken, env.JWT_SECRET) as { userId?: string; scope?: string; tier?: SubscriptionTier };
    if (decoded.userId !== req.auth.userId || decoded.scope !== "ott:session:create" || !decoded.tier) return void res.status(401).json({ error: "Invalid OTT entitlement token" });
    tokenTier = decoded.tier;
  } catch {
    return void res.status(401).json({ error: "Invalid or expired OTT entitlement token" });
  }
  const user = await UserModel.findById(req.auth.userId).lean();
  const userTier = (user?.subscriptionTier as SubscriptionTier | undefined) ?? "free";
  const effectiveTier = hasTierAccess(userTier, tokenTier) ? userTier : tokenTier;
  if (!hasTierAccess(effectiveTier, asset.tier as SubscriptionTier)) return void res.status(403).json({ error: `Requires ${asset.tier} subscription tier` });
  const sessionToken = jwt.sign({ userId: req.auth.userId, assetId: asset.assetId, entitlement: asset.tier }, env.JWT_SECRET, { expiresIn: "20m" });
  const sep = asset.streamUrl.includes("?") ? "&" : "?";
  res.json({ sourceType: "protected_hls", sourceUrl: `${asset.streamUrl}${sep}sessionToken=${sessionToken}`, title: asset.title, tier: asset.tier, sessionToken });
});

app.post("/api/media/upload", authMiddleware, upload.single("video"), async (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Missing file" });
  res.status(201).json({ sourceType: "local", sourceUrl: `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`, originalName: req.file.originalname });
});

app.get("/health", (_, res) => res.json({ ok: true, service: "watchparty-api" }));

async function bootstrap(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
  } catch {
    const mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    process.on("exit", () => void mem.stop());
  }
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: [...allowedOrigins], credentials: true } });
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return void next(new Error("Unauthorized"));
    try {
      socket.data = { user: jwt.verify(token, env.JWT_SECRET) as AuthClaims };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });
  registerRealtime(io);
  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on ${env.PORT}`);
  });
}
void bootstrap();
