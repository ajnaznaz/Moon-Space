import { Server } from "socket.io";
import { ChatMessageModel, ParticipantModel, RoomModel } from "./models.js";
import type { AuthClaims } from "./auth.js";
import type { PlaybackState } from "@watchparty/shared";

const roomPlaybackMemory = new Map<string, PlaybackState>();

interface SocketAuth {
  user: AuthClaims;
  roomId?: string;
}

const SOFT_DRIFT_SEC = 0.8;
const HARD_DRIFT_SEC = 2.0;

export function registerRealtime(io: Server): void {
  io.on("connection", (socket) => {
    const auth = socket.data as SocketAuth;

    socket.on("room:join", async ({ roomId }: { roomId: string }) => {
      await socket.join(roomId);
      auth.roomId = roomId;
      socket.emit("room:joined", { roomId });

      const room = await RoomModel.findOne({ roomId }).lean();
      if (!room) {
        socket.emit("room:error", { message: "Room not found" });
        return;
      }

      const state = roomPlaybackMemory.get(roomId) ?? room.playbackState;
      socket.emit("playback:state", {
        state,
        correction: {
          softThresholdSec: SOFT_DRIFT_SEC,
          hardThresholdSec: HARD_DRIFT_SEC
        }
      });

      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      const peers = [...(roomSockets ?? [])]
        .filter((socketId) => socketId !== socket.id)
        .map((socketId) => {
          const peerSocket = io.sockets.sockets.get(socketId);
          const peerAuth = peerSocket?.data as SocketAuth | undefined;
          return {
            socketId,
            displayName: peerAuth?.user?.displayName ?? "Guest"
          };
        });
      socket.emit("room:peers", { peers });
      socket.to(roomId).emit("room:peer-joined", {
        socketId: socket.id,
        displayName: auth.user.displayName
      });
    });

    socket.on("playback:update", async ({ roomId, nextState }: { roomId: string; nextState: PlaybackState }) => {
      roomPlaybackMemory.set(roomId, nextState);
      await RoomModel.updateOne({ roomId }, { $set: { playbackState: nextState } });
      socket.to(roomId).emit("playback:state", { state: nextState });
    });

    socket.on("chat:send", async ({ roomId, body }: { roomId: string; body: string }) => {
      if (!body?.trim()) return;
      const saved = await ChatMessageModel.create({
        roomId,
        userId: auth.user.userId,
        displayName: auth.user.displayName,
        body: body.trim()
      });
      io.to(roomId).emit("chat:new", {
        id: String(saved._id),
        roomId,
        userId: auth.user.userId,
        displayName: auth.user.displayName,
        body: saved.body,
        createdAt: saved.createdAt.toISOString()
      });
    });

    socket.on("voice:signal", ({ roomId, targetSocketId, signal }: { roomId: string; targetSocketId: string; signal: unknown }) => {
      io.to(targetSocketId).emit("voice:signal", {
        fromSocketId: socket.id,
        signal,
        roomId
      });
    });

    socket.on("voice:announce", ({ roomId, speaking }: { roomId: string; speaking: boolean }) => {
      socket.to(roomId).emit("voice:speaking", { userId: auth.user.userId, socketId: socket.id, speaking });
    });

    socket.on("reaction:send", ({ roomId, kind, value }: { roomId: string; kind: "emoji" | "gif"; value: string }) => {
      if (!value?.trim()) return;
      io.to(roomId).emit("reaction:new", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roomId,
        userId: auth.user.userId,
        displayName: auth.user.displayName,
        kind,
        value: value.trim(),
        createdAt: new Date().toISOString()
      });
    });

    socket.on("moderation:mute", async ({ roomId, userId }: { roomId: string; userId: string }) => {
      await ParticipantModel.updateOne({ roomId, userId }, { $set: { isMuted: true } });
      io.to(roomId).emit("moderation:user-muted", { userId });
    });

    socket.on("disconnect", () => {
      if (!auth.roomId) return;
      socket.to(auth.roomId).emit("room:peer-left", { socketId: socket.id });
    });
  });
}
