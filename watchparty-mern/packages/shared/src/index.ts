export type RoomRole = "host" | "cohost" | "moderator" | "viewer";

export type PlaybackAction = "play" | "pause" | "seek" | "rate";

export interface PlaybackState {
  isPlaying: boolean;
  positionSec: number;
  speed: number;
  serverTimestampMs: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
}
