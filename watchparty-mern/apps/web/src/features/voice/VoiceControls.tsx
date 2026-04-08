import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

interface Props {
  socket: Socket;
  roomId: string;
  attachToPlayer?: boolean;
}

interface PeerInfo {
  socketId: string;
  displayName: string;
  stream?: MediaStream;
}

type SignalPayload =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export function VoiceControls({ socket, roomId, attachToPlayer = false }: Props) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizingRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(!attachToPlayer);
  const [hideSelfView, setHideSelfView] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: 14, y: 14 });
  const [panelSize, setPanelSize] = useState({ width: 320, height: 220 });
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [status, setStatus] = useState("Voice inactive");
  const [speakerMap, setSpeakerMap] = useState<Record<string, boolean>>({});

  const iceServers = useMemo(
    () => [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    []
  );

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      remoteStreamsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent): void {
      const drag = draggingRef.current;
      const resize = resizingRef.current;
      if (drag) {
        setPanelPos((prev) => ({
          x: Math.max(4, prev.x + (event.movementX || 0)),
          y: Math.max(4, prev.y + (event.movementY || 0))
        }));
      } else if (resize) {
        setPanelSize({
          width: Math.max(220, resize.startW + (event.clientX - resize.startX)),
          height: Math.max(170, resize.startH + (event.clientY - resize.startY))
        });
      }
    }
    function onUp(): void {
      draggingRef.current = null;
      resizingRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  async function ensureLocalStream(): Promise<MediaStream> {
    if (!localStreamRef.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
      stream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    }
    return localStreamRef.current;
  }

  function upsertPeer(socketId: string, displayName: string, stream?: MediaStream): void {
    setPeers((prev) => {
      const existing = prev.find((peer) => peer.socketId === socketId);
      if (!existing) return [...prev, { socketId, displayName, stream }];
      return prev.map((peer) => (peer.socketId === socketId ? { ...peer, displayName, stream: stream ?? peer.stream } : peer));
    });
  }

  function removePeer(socketId: string): void {
    setPeers((prev) => prev.filter((peer) => peer.socketId !== socketId));
    setSpeakerMap((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    peerConnectionsRef.current.get(socketId)?.close();
    peerConnectionsRef.current.delete(socketId);
    remoteStreamsRef.current.delete(socketId);
  }

  async function getPeerConnection(targetSocketId: string, displayName = "Guest"): Promise<RTCPeerConnection> {
    const existing = peerConnectionsRef.current.get(targetSocketId);
    if (existing) return existing;

    const localStream = await ensureLocalStream();
    const pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const payload: SignalPayload = { type: "ice", candidate: event.candidate.toJSON() };
      socket.emit("voice:signal", { roomId, targetSocketId, signal: payload });
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      remoteStreamsRef.current.set(targetSocketId, stream);
      upsertPeer(targetSocketId, displayName, stream);
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        removePeer(targetSocketId);
      }
    };

    peerConnectionsRef.current.set(targetSocketId, pc);
    return pc;
  }

  async function createOffer(targetSocketId: string, displayName: string): Promise<void> {
    const pc = await getPeerConnection(targetSocketId, displayName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const payload: SignalPayload = { type: "offer", sdp: offer };
    socket.emit("voice:signal", { roomId, targetSocketId, signal: payload });
  }

  async function toggleMic(): Promise<void> {
    await ensureLocalStream();
    if (micEnabled) {
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
      socket.emit("voice:announce", { roomId, speaking: false });
      setMicEnabled(false);
      setStatus("Mic muted");
      return;
    }
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = true));
    socket.emit("voice:announce", { roomId, speaking: true });
    setMicEnabled(true);
    setStatus("Mic live");
  }

  async function toggleCamera(): Promise<void> {
    await ensureLocalStream();
    const nextValue = !camEnabled;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = nextValue));
    setCamEnabled(nextValue);
  }

  useEffect(() => {
    const onPeers = ({ peers: nextPeers }: { peers: Array<{ socketId: string; displayName: string }> }): void => {
      for (const peer of nextPeers) {
        upsertPeer(peer.socketId, peer.displayName, remoteStreamsRef.current.get(peer.socketId));
        if (socket.id && socket.id < peer.socketId) {
          void createOffer(peer.socketId, peer.displayName);
        }
      }
    };

    const onPeerJoined = ({ socketId, displayName }: { socketId: string; displayName: string }): void => {
      upsertPeer(socketId, displayName, remoteStreamsRef.current.get(socketId));
      if (socket.id && socket.id < socketId) {
        void createOffer(socketId, displayName);
      }
    };

    const onPeerLeft = ({ socketId }: { socketId: string }): void => {
      removePeer(socketId);
    };

    const onSignal = async ({ fromSocketId, signal }: { fromSocketId: string; signal: SignalPayload }): Promise<void> => {
      const peerDisplayName = peers.find((peer) => peer.socketId === fromSocketId)?.displayName ?? "Guest";
      const pc = await getPeerConnection(fromSocketId, peerDisplayName);
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice:signal", {
          roomId,
          targetSocketId: fromSocketId,
          signal: { type: "answer", sdp: answer } as SignalPayload
        });
        return;
      }
      if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        return;
      }
      if (signal.type === "ice" && signal.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // Ignore transient ICE ordering issues.
        }
      }
    };

    const onSpeaking = ({ socketId, speaking }: { socketId: string; speaking: boolean }): void => {
      setSpeakerMap((prev) => ({ ...prev, [socketId]: speaking }));
    };

    socket.on("room:peers", onPeers);
    socket.on("room:peer-joined", onPeerJoined);
    socket.on("room:peer-left", onPeerLeft);
    socket.on("voice:signal", onSignal);
    socket.on("voice:speaking", onSpeaking);
    return () => {
      socket.off("room:peers", onPeers);
      socket.off("room:peer-joined", onPeerJoined);
      socket.off("room:peer-left", onPeerLeft);
      socket.off("voice:signal", onSignal);
      socket.off("voice:speaking", onSpeaking);
    };
  }, [peers, roomId, socket]);

  return (
    <section className={attachToPlayer ? "voice-floating-wrap" : "card"}>
      {!panelOpen && (
        <button type="button" className="voice-fab ghost" onClick={() => setPanelOpen(true)}>
          Open Camera
        </button>
      )}
      <div
        ref={panelRef}
        className={`card voice-panel ${panelOpen ? "" : "hidden"}`}
        style={attachToPlayer ? { left: panelPos.x, top: panelPos.y, width: panelSize.width, minHeight: panelSize.height } : undefined}
      >
        <div
          className="voice-panel-head"
          onPointerDown={(event) => {
            if (!attachToPlayer) return;
            draggingRef.current = { dx: event.clientX, dy: event.clientY };
          }}
        >
          <h3>Live voice & cam</h3>
          <div className="voice-panel-actions">
            <button type="button" className="ghost" onClick={() => setHideSelfView((prev) => !prev)}>
              {hideSelfView ? "Show me" : "Hide me"}
            </button>
            <button type="button" className="ghost" onClick={() => setPanelOpen(false)}>Close</button>
          </div>
        </div>
        <div className="voice-status-wrap"><span className={`voice-dot ${micEnabled ? "live" : ""}`} /><p>{status}</p></div>
        <div className="control-row">
          <button onClick={() => void toggleMic()}>{micEnabled ? "Mute mic" : "Enable mic"}</button>
          <button className="ghost" onClick={() => void toggleCamera()}>{camEnabled ? "Disable camera" : "Enable camera"}</button>
        </div>
        <div className="cam-grid">
          {!hideSelfView && (
            <div className="cam-tile">
              <video ref={localVideoRef} muted autoPlay playsInline />
              <span>You {micEnabled ? "🎙️" : "🔇"}</span>
            </div>
          )}
          {peers.map((peer) => (
            <div key={peer.socketId} className="cam-tile">
              <video
                autoPlay
                playsInline
                ref={(node) => {
                  if (!node) return;
                  node.srcObject = peer.stream ?? null;
                }}
              />
              <span>{peer.displayName} {speakerMap[peer.socketId] ? "🎤" : ""}</span>
            </div>
          ))}
        </div>
        {attachToPlayer && (
          <button
            type="button"
            className="resize-grip"
            onPointerDown={(event) => {
              resizingRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                startW: panelSize.width,
                startH: panelSize.height
              };
            }}
          />
        )}
      </div>
    </section>
  );
}

