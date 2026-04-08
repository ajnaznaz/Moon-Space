import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, PlaybackState } from "@watchparty/shared";
import Hls from "hls.js";
import { api } from "../../lib/api";
import { createSocket } from "../../lib/socket";
import { getToken } from "../../lib/session";
import { ChatPanel } from "../chat/ChatPanel";
import { VoiceControls } from "../voice/VoiceControls";

const SOFT_DRIFT_SEC = 0.8;
const HARD_DRIFT_SEC = 2.0;

interface JoinPayload {
  roomId: string;
  media: { sourceType: "local" | "url" | "youtube" | "protected_hls"; sourceUrl: string; title: string };
  playbackState: PlaybackState;
  recentMessages: ChatMessage[];
}

interface Props {
  roomId: string;
  onLeaveRoom: () => void;
}

function toYouTubeEmbedUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    if (url.hostname.includes("youtube.com") && url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/shorts/")[1]?.split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : input;
    }
    if (url.hostname.includes("youtube.com") && url.pathname.startsWith("/live/")) {
      const id = url.pathname.split("/live/")[1]?.split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : input;
    }
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "").trim();
      return id ? `https://www.youtube.com/embed/${id}` : input;
    }
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/embed/")) return input;
      const id = url.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : input;
    }
    return input;
  } catch {
    return input;
  }
}

export function WatchRoomPage({ roomId, onLeaveRoom }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socket = useMemo(() => createSocket(getToken() || ""), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"local" | "url" | "youtube" | "protected_hls">("url");
  const [syncState, setSyncState] = useState<"perfect" | "adjusting">("perfect");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);

  useEffect(() => {
    void api<JoinPayload>(`/api/rooms/${roomId}/join`, { method: "POST", body: JSON.stringify({}) })
      .then((data) => {
        setMessages(data.recentMessages);
        setTitle(data.media.title);
        setMediaUrl(data.media.sourceUrl);
        setMediaType(data.media.sourceType);
        setPlayerError(null);
        const video = videoRef.current;
        if (video) {
          video.currentTime = data.playbackState.positionSec;
          video.playbackRate = data.playbackState.speed;
          if (data.playbackState.isPlaying) void video.play();
        }
      })
      .catch((err) => setPlayerError((err as Error).message));
  }, [roomId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl || mediaType === "youtube") return;
    const isHls = mediaUrl.includes(".m3u8") || mediaType === "protected_hls";
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.on(Hls.Events.MANIFEST_PARSED, () => setIsBuffering(false));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setPlayerError("Unable to load stream.");
      });
      setIsBuffering(true);
      hls.loadSource(mediaUrl);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = mediaUrl;
    video.load();
    setIsBuffering(true);
  }, [mediaUrl, mediaType]);

  useEffect(() => {
    socket.emit("room:join", { roomId });
    socket.on("chat:new", (msg: ChatMessage) => setMessages((prev) => [...prev, msg]));
    socket.on("playback:state", ({ state }: { state: PlaybackState }) => {
      const video = videoRef.current;
      if (!video) return;
      const drift = Math.abs(video.currentTime - state.positionSec);
      if (drift > HARD_DRIFT_SEC) {
        setSyncState("adjusting");
        video.currentTime = state.positionSec;
      } else if (drift > SOFT_DRIFT_SEC) {
        setSyncState("adjusting");
      } else {
        setSyncState("perfect");
      }
      if (state.isPlaying && video.paused) void video.play();
      if (!state.isPlaying && !video.paused) video.pause();
    });
    return () => {
      socket.disconnect();
    };
  }, [roomId, socket]);

  function emitPlayback(action: "play" | "pause" | "seek"): void {
    const video = videoRef.current;
    if (!video) return;
    socket.emit("playback:update", {
      roomId,
      action,
      nextState: {
        isPlaying: !video.paused,
        positionSec: video.currentTime,
        speed: video.playbackRate,
        serverTimestampMs: Date.now()
      }
    });
  }

  async function endRoom(): Promise<void> {
    try {
      await api(`/api/rooms/${roomId}/end`, { method: "POST", body: JSON.stringify({}) });
      onLeaveRoom();
    } catch (err) {
      setPlayerError((err as Error).message);
    }
  }

  return (
    <div className="watch-layout">
      <section className="card video-card">
        <div className="video-meta">
          <h2>{title}</h2>
          <div className="pill-row">
            <span className="pill">Room: {roomId}</span>
            <span className="pill">Sync: {syncState}</span>
            {mediaType === "protected_hls" && <span className="pill">OTT Protected</span>}
          </div>
        </div>
        {mediaType === "youtube" ? (
          <iframe src={toYouTubeEmbedUrl(mediaUrl)} title={title} allow="autoplay; encrypted-media" allowFullScreen className="video" />
        ) : (
          <div className="player-shell">
            <div className="video-wrap">
              <video
                ref={videoRef}
                className="video"
                onCanPlay={() => setIsBuffering(false)}
                onWaiting={() => setIsBuffering(true)}
                onError={() => setPlayerError("Video failed to load.")}
                onPlay={() => emitPlayback("play")}
                onPause={() => emitPlayback("pause")}
                onSeeked={() => emitPlayback("seek")}
                controls
              />
              {(isBuffering || playerError) && <div className="video-overlay">{playerError ? <p>{playerError}</p> : <p>Loading stream...</p>}</div>}
            </div>
          </div>
        )}
        <div className="player-controls">
          <button type="button" className="ghost" onClick={() => onLeaveRoom()}>Leave Room</button>
          <button type="button" className="ghost danger-btn" onClick={() => void endRoom()}>End Room</button>
        </div>
      </section>
      <div className="side-stack">
        <ChatPanel socket={socket} roomId={roomId} messages={messages} />
        <VoiceControls socket={socket} roomId={roomId} />
      </div>
    </div>
  );
}
