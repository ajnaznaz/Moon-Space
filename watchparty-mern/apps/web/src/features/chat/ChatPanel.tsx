import { FormEvent, useState } from "react";
import type { ChatMessage } from "@watchparty/shared";
import type { Socket } from "socket.io-client";

interface Props { socket: Socket; roomId: string; messages: ChatMessage[]; }

export function ChatPanel({ socket, roomId, messages }: Props) {
  const [body, setBody] = useState("");
  function send(e: FormEvent): void {
    e.preventDefault();
    if (!body.trim()) return;
    socket.emit("chat:send", { roomId, body });
    setBody("");
  }
  return (
    <section className="card chat">
      <h3>Live chat</h3>
      <div className="chat-list">
        {messages.map((msg) => (
          <article key={msg.id} className="chat-item"><strong>{msg.displayName}</strong><p>{msg.body}</p></article>
        ))}
      </div>
      <form onSubmit={send}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Drop a message..." /></form>
    </section>
  );
}

