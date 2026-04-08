import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import { setToken } from "../../lib/session";

interface Props { onAuthed: () => void; }

export function AuthPanel({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = mode === "register" ? { email, password, displayName } : { email, password };
      const data = await api<{ token: string }>(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setToken(data.token);
      onAuthed();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card auth-card" onSubmit={submit}>
      <h2>{mode === "register" ? "Create your universe" : "Welcome back"}</h2>
      {mode === "register" && <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />}
      <input placeholder="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="error">{error}</p>}
      <button type="submit">{mode === "register" ? "Enter Moon Space" : "Login"}</button>
      <button type="button" className="ghost" onClick={() => setMode((prev) => (prev === "register" ? "login" : "register"))}>{mode === "register" ? "Already have an account?" : "Need to create one?"}</button>
    </form>
  );
}

