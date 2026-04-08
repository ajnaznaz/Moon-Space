import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { API_BASE } from "../../lib/config";
import { getToken } from "../../lib/session";

interface OttAsset {
  assetId: string;
  title: string;
  tier: "standard" | "premium";
  posterUrl: string;
  isUnlocked?: boolean;
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

interface Props {
  onEnterRoom: (roomId: string) => void;
}

export function RoomLobby({ onEnterRoom }: Props) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomName, setRoomName] = useState("Moon Space Session");
  const [mediaType, setMediaType] = useState<"url" | "youtube" | "ott_demo">("url");
  const [mediaUrl, setMediaUrl] = useState("https://www.w3schools.com/html/mov_bbb.mp4");
  const [mediaTitle, setMediaTitle] = useState("Big Buck Bunny");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [joinId, setJoinId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [ottItems, setOttItems] = useState<OttAsset[]>([]);
  const [selectedOttAssetId, setSelectedOttAssetId] = useState("");
  const [ottEntitlementToken, setOttEntitlementToken] = useState<string | null>(null);
  const [ottAccessKey, setOttAccessKey] = useState("");
  const [ottAuthLoading, setOttAuthLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [ottGrantedTier, setOttGrantedTier] = useState<"free" | "standard" | "premium">("free");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: OttAsset[] }>("/api/ott/catalog")
      .then((data) => {
        setOttItems(data.items);
        if (data.items[0]) setSelectedOttAssetId(data.items[0].assetId);
      })
      .catch(() => undefined);
  }, []);

  const selectedOttAsset = useMemo(
    () => ottItems.find((asset) => asset.assetId === selectedOttAssetId) ?? null,
    [ottItems, selectedOttAssetId]
  );

  async function authorizeOtt(): Promise<void> {
    setOttAuthLoading(true);
    try {
      const data = await api<{ entitlementToken: string; grantedTier?: "standard" | "premium" }>("/api/ott/authorize", {
        method: "POST",
        body: JSON.stringify({ accessKey: ottAccessKey })
      });
      setOttEntitlementToken(data.entitlementToken);
      setOttGrantedTier(data.grantedTier ?? "standard");
      const refreshed = await api<{ items: OttAsset[] }>("/api/ott/catalog");
      setOttItems(refreshed.items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOttAuthLoading(false);
    }
  }

  async function createRoom(e: FormEvent): Promise<void> {
    e.preventDefault();
    setCreateLoading(true);
    try {
      let sourceType: "local" | "url" | "youtube" | "protected_hls" = mediaType === "ott_demo" ? "protected_hls" : mediaType;
      let sourceUrl = mediaUrl;
      let title = mediaTitle;

      if (mediaType === "url" && localFile) {
        const form = new FormData();
        form.append("video", localFile);
        const token = getToken();
        const uploadRes = await fetch(`${API_BASE}/api/media/upload`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form
        });
        if (!uploadRes.ok) throw new Error("Local upload failed");
        const uploadData = (await uploadRes.json()) as { sourceType: "local"; sourceUrl: string };
        sourceType = uploadData.sourceType;
        sourceUrl = uploadData.sourceUrl;
      }

      if (mediaType === "youtube") sourceUrl = toYouTubeEmbedUrl(sourceUrl);
      if (mediaType === "ott_demo") {
        if (!ottEntitlementToken) throw new Error("Authorize OTT access before creating room");
        const session = await api<{ sourceType: "protected_hls"; sourceUrl: string; title: string }>("/api/ott/session", {
          method: "POST",
          body: JSON.stringify({ assetId: selectedOttAssetId, entitlementToken: ottEntitlementToken })
        });
        sourceType = session.sourceType;
        sourceUrl = session.sourceUrl;
        title = session.title;
      }

      const data = await api<{ roomId: string }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name: roomName, passcode: passcode || undefined, media: { sourceType, sourceUrl, title } })
      });
      onEnterRoom(data.roomId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function joinRoom(e: FormEvent): Promise<void> {
    e.preventDefault();
    setJoinLoading(true);
    try {
      await api(`/api/rooms/${joinId}/join`, { method: "POST", body: JSON.stringify({ passcode: passcode || undefined }) });
      onEnterRoom(joinId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div className="lobby-wrap">
      <section className="card">
        <h2>Create or join room</h2>
        <p className="subtext">Polished sources: local/upload, direct URL, YouTube sync, and protected OTT streams.</p>
        <div className="mode-switch">
          <button type="button" className={mode === "create" ? "" : "ghost"} onClick={() => setMode("create")}>Create</button>
          <button type="button" className={mode === "join" ? "" : "ghost"} onClick={() => setMode("join")}>Join</button>
        </div>
      </section>
      {mode === "create" ? (
        <form className="card" onSubmit={createRoom}>
          {createLoading && (
            <div className="form-loader-overlay">
              <div className="moon-orbit-loader large">
                <span className="moon-core" />
                <span className="moon-orbit" />
              </div>
              <p>Creating moon room...</p>
            </div>
          )}
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name" required />
          <div className="source-grid">
            <button type="button" className={`source-card ${mediaType === "url" ? "active" : ""}`} onClick={() => setMediaType("url")}>
              <span className="source-icon source-custom">PL</span>
              <span className="source-title">Custom Media</span>
              <span className="source-sub">Upload file or use direct MP4/HLS URL</span>
            </button>
            <button type="button" className={`source-card ${mediaType === "youtube" ? "active" : ""}`} onClick={() => setMediaType("youtube")}>
              <span className="source-icon source-youtube">YT</span>
              <span className="source-title">YouTube</span>
              <span className="source-sub">Paste watch/share/shorts/live links</span>
            </button>
            <button type="button" className={`source-card ${mediaType === "ott_demo" ? "active" : ""}`} onClick={() => setMediaType("ott_demo")}>
              <span className="source-icon source-ott">OTT</span>
              <span className="source-title">OTT Premium</span>
              <span className="source-sub">Access-key + entitlement token flow</span>
            </button>
          </div>
          {mediaType === "ott_demo" ? (
            <div className="ott-box">
              <div className="ott-auth-row">
                <input value={ottAccessKey} onChange={(e) => setOttAccessKey(e.target.value)} placeholder="OTT access key" />
                <button type="button" onClick={() => void authorizeOtt()} disabled={ottAuthLoading || createLoading}>
                  {ottAuthLoading ? "Authorizing..." : "Authorize"}
                </button>
              </div>
              <p className="subtext">Current OTT tier: {ottGrantedTier}</p>
              <select value={selectedOttAssetId} onChange={(e) => setSelectedOttAssetId(e.target.value)}>
                {ottItems.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.title} ({asset.tier}) {asset.isUnlocked ? "Unlocked" : "Locked"}
                  </option>
                ))}
              </select>
              {selectedOttAsset && (
                <p className="subtext">
                  Selected: {selectedOttAsset.title} | Required tier: {selectedOttAsset.tier} |{" "}
                  {selectedOttAsset.isUnlocked ? "Unlocked for your account" : "Locked - authorize higher tier"}
                </p>
              )}
            </div>
          ) : (
            <>
              <input type="file" accept="video/*" onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)} />
              <input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={mediaType === "youtube" ? "Paste YouTube URL" : "Media URL"}
                required
              />
              <input value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} placeholder="Media title" required />
            </>
          )}
          <input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Optional passcode" />
          <button type="submit" disabled={createLoading || ottAuthLoading}>{createLoading ? "Please wait..." : "Create & Enter"}</button>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <form className="card" onSubmit={joinRoom}>
          {joinLoading && (
            <div className="form-loader-overlay">
              <div className="moon-orbit-loader large">
                <span className="moon-core" />
                <span className="moon-orbit" />
              </div>
              <p>Joining room...</p>
            </div>
          )}
          <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Room ID" required />
          <input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode (if any)" />
          <button type="submit" disabled={joinLoading}>{joinLoading ? "Please wait..." : "Join room"}</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}
