import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { clearToken, getToken } from "../lib/session";
import { AuthPanel } from "../features/auth/AuthPanel";
import { RoomLobby } from "../features/watch-room/RoomLobby";
import { WatchRoomPage } from "../features/watch-room/WatchRoomPage";
import moonSpaceLogo from "../assets/moon-space-logo.png";
import { StarfieldCanvas } from "../components/StarfieldCanvas";

interface Me {
  userId: string;
  email: string;
  displayName: string;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  async function loadMe(): Promise<void> {
    if (!getToken()) return;
    try {
      const user = await api<Me>("/api/auth/me");
      setMe(user);
    } catch (err) {
      setBootError((err as Error).message);
      clearToken();
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  if (!me) {
    return (
      <>
        <StarfieldCanvas />
        <main className="page auth-page">
          <section className="brand-hero">
            <img src={moonSpaceLogo} alt="Moon Space logo" className="brand-logo" />
            <h1 className="moon-space-wordmark">Moon Space</h1>
            <p className="subtext">Let&apos;s escape into a space made only for us and the moonlight.</p>
          </section>
          {bootError && <p className="error">{bootError}</p>}
          <AuthPanel onAuthed={() => void loadMe()} />
        </main>
      </>
    );
  }

  return (
    <>
      <StarfieldCanvas />
      <main className="page">
        <header className="topbar">
          <div className="topbar-brand">
            <img src={moonSpaceLogo} alt="Moon Space logo" className="brand-logo small" />
            <div>
              <h1 className="moon-space-wordmark">Moon Space</h1>
              <p>{me.displayName}</p>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() => {
              clearToken();
              setMe(null);
            }}
          >
            Logout
          </button>
        </header>
        {activeRoomId ? (
          <WatchRoomPage roomId={activeRoomId} onLeaveRoom={() => setActiveRoomId(null)} />
        ) : (
          <RoomLobby onEnterRoom={(roomId) => setActiveRoomId(roomId)} />
        )}
      </main>
    </>
  );
}
