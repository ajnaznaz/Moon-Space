import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

interface Props { socket: Socket; roomId: string; }

export function VoiceControls({ socket, roomId }: Props) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [status, setStatus] = useState("Voice inactive");

  useEffect(() => () => { localStreamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function toggleMic(): Promise<void> {
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

  return (
    <section className="card">
      <h3>Live voice</h3>
      <div className="voice-status-wrap"><span className={`voice-dot ${micEnabled ? "live" : ""}`} /><p>{status}</p></div>
      <button onClick={() => void toggleMic()}>{micEnabled ? "Mute mic" : "Enable mic"}</button>
    </section>
  );
}

