import { useState } from "react";
import { Modal, Button, TextField } from "@renderer/components";

export interface EpicAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { success: boolean; account?: string }) => void;
}

export function EpicAuthModal({ visible, onClose, onSuccess }: Readonly<EpicAuthModalProps>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [challengeType, setChallengeType] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail(""); setPassword(""); setMfaCode("");
    setMfaToken(""); setChallengeType("");
    setNeedsMfa(false); setError(null); setLoading(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    const result = await window.electron.epicDirectLogin(email, password).catch(() => ({ success: false as const, error: "Network error." }));
    setLoading(false);
    if (result.success) {
      reset(); onSuccess({ success: true, account: result.account });
    } else if ("mfaRequired" in result && result.mfaRequired) {
      setMfaToken(result.mfaToken);
      setChallengeType(result.challengeType);
      setNeedsMfa(true);
    } else {
      setError("error" in result ? result.error : "Login failed.");
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    const result = await window.electron.epicDirectLoginMfa(mfaCode, mfaToken, challengeType).catch(() => ({ success: false as const, error: "Network error." }));
    setLoading(false);
    if (result.success) {
      reset(); onSuccess({ success: true, account: result.account });
    } else {
      setError("error" in result ? result.error : "MFA failed.");
    }
  };

  return (
    <Modal visible={visible} title="Sign in to Epic Games" description="Enter your Epic Games credentials." onClose={handleClose}>
      {!needsMfa ? (
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TextField label="Email" type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required />
          <TextField label="Password" type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
          {error && <p style={{ color: "var(--color-error, #f87171)", fontSize: "13px", margin: 0 }}>{error}</p>}
          <Button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign In"}</Button>
        </form>
      ) : (
        <form onSubmit={handleMfa} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>
            A {challengeType === "EMAIL" ? "code was sent to your email" : "verification code is required"}.
          </p>
          <TextField label="Verification Code" value={mfaCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMfaCode(e.target.value)} required autoFocus />
          {error && <p style={{ color: "var(--color-error, #f87171)", fontSize: "13px", margin: 0 }}>{error}</p>}
          <Button type="submit" disabled={loading}>{loading ? "Verifying…" : "Verify"}</Button>
        </form>
      )}
    </Modal>
  );
}
