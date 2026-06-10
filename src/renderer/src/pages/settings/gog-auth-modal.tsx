import { useState } from "react";
import { Modal, Button, TextField } from "@renderer/components";

export interface GogAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { refresh_token: string; username: string } | null) => void;
}

export function GogAuthModal({ visible, onClose, onSuccess }: Readonly<GogAuthModalProps>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setEmail(""); setPassword(""); setError(null); setLoading(false); };
  const handleClose = () => { reset(); onClose(); };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    const result = await window.electron.gogDirectLogin(email, password).catch(() => ({ success: false as const, error: "Network error." }));
    setLoading(false);
    if (result.success) {
      reset(); onSuccess({ refresh_token: result.refresh_token, username: result.username });
    } else {
      setError(result.error);
    }
  };

  return (
    <Modal visible={visible} title="Sign in to GOG" description="Enter your GOG credentials." onClose={handleClose}>
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <TextField label="Email" type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required />
        <TextField label="Password" type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
        {error && <p style={{ color: "var(--color-error, #f87171)", fontSize: "13px", margin: 0 }}>{error}</p>}
        <Button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign In"}</Button>
      </form>
    </Modal>
  );
}
