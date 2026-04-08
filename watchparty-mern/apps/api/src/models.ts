import mongoose, { Schema } from "mongoose";
import { nanoid } from "nanoid";
import type { RoomRole } from "@watchparty/shared";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    subscriptionTier: {
      type: String,
      enum: ["free", "standard", "premium"],
      default: "free"
    }
  },
  { timestamps: true }
);

const roomSchema = new Schema(
  {
    roomId: { type: String, required: true, unique: true, default: () => nanoid(10) },
    name: { type: String, required: true },
    hostUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    passcode: { type: String, default: null },
    media: {
      sourceType: { type: String, enum: ["local", "url", "youtube", "protected_hls"], required: true },
      sourceUrl: { type: String, required: true },
      title: { type: String, required: true }
    },
    playbackState: {
      isPlaying: { type: Boolean, default: false },
      positionSec: { type: Number, default: 0 },
      speed: { type: Number, default: 1 },
      serverTimestampMs: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

const participantSchema = new Schema(
  {
    roomId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["host", "cohost", "moderator", "viewer"] as RoomRole[], required: true },
    isMuted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const chatMessageSchema = new Schema(
  {
    roomId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    displayName: { type: String, required: true },
    body: { type: String, required: true, maxlength: 1200 }
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", userSchema);
export const RoomModel = mongoose.model("Room", roomSchema);
export const ParticipantModel = mongoose.model("Participant", participantSchema);
export const ChatMessageModel = mongoose.model("ChatMessage", chatMessageSchema);
