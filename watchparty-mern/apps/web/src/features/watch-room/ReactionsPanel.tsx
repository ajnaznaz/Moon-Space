import { FormEvent, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";

interface Props {
  socket: Socket;
  roomId: string;
  attachToPlayer?: boolean;
}

const fallbackGifs = [
  "https://media.giphy.com/media/l3vR85PnGsBwu1PFK/giphy.gif",
  "https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif",
  "https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif"
];

export function ReactionsPanel({ socket, roomId, attachToPlayer = false }: Props) {
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const giphyApiKey = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;
  const quickEmojis = useMemo(() => ["🔥", "😂", "😍", "👏", "😱", "🚀"], []);

  function sendEmoji(emoji: string): void {
    socket.emit("reaction:send", { roomId, kind: "emoji", value: emoji });
  }

  function sendGif(url: string): void {
    socket.emit("reaction:send", { roomId, kind: "gif", value: url });
  }

  async function searchGifs(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!gifQuery.trim()) return;
    setSearching(true);
    try {
      if (!giphyApiKey) {
        setGifResults(fallbackGifs);
        return;
      }
      const endpoint = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyApiKey)}&q=${encodeURIComponent(
        gifQuery.trim()
      )}&limit=6&rating=pg`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("GIF search failed");
      const payload = (await res.json()) as { data: Array<{ images?: { fixed_height?: { url?: string } } }> };
      const urls = payload.data
        .map((item) => item.images?.fixed_height?.url)
        .filter((url): url is string => Boolean(url));
      setGifResults(urls.length ? urls : fallbackGifs);
    } catch {
      setGifResults(fallbackGifs);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className={attachToPlayer ? "card reaction-dock" : "card"}>
      <h3>Live reactions</h3>
      <div className="emoji-row">
        {quickEmojis.map((emoji) => (
          <button key={emoji} className="ghost emoji-btn" type="button" onClick={() => sendEmoji(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
      <button type="button" className="ghost" onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? "Hide GIF picker" : "Open GIF picker"}
      </button>
      {expanded && (
        <>
          <form className="gif-search" onSubmit={(e) => void searchGifs(e)}>
            <input value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} placeholder="Search GIF reactions..." />
            <button type="submit">{searching ? "..." : "Search"}</button>
          </form>
          <div className="gif-grid">
            {gifResults.map((url) => (
              <button key={url} type="button" className="gif-pick" onClick={() => sendGif(url)}>
                <img src={url} alt="GIF reaction option" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
