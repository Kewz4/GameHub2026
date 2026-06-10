import { useState } from "react";
import { Modal, Button, TextField } from "@renderer/components";

export interface EpicAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { success: boolean; account?: string }) => void;
}

type Screen = "credentials" | "mfa";

interface MfaState {
  mfaToken: string;
  challengeType: string;
}

const FORGOT_PASSWORD_URL = "https://www.epicgames.com/id/forgot-password";

const socialButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  width: "100%",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.05)",
  color: "inherit",
  cursor: "pointer",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  margin: "16px 0",
  opacity: 0.5,
  fontSize: "0.8rem",
};

export function EpicAuthModal({
  visible,
  onClose,
  onSuccess,
}: Readonly<EpicAuthModalProps>) {
  const [screen, setScreen] = useState<Screen>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaState, setMfaState] = useState<MfaState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setScreen("credentials");
    setEmail("");
    setPassword("");
    setOtp("");
    setMfaState(null);
    setLoading(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSuccess = (result: { success: boolean; account?: string }) => {
    reset();
    onSuccess(result);
    onClose();
  };

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);

    const result = await window.electron
      .epicDirectLogin(email.trim(), password)
      .catch(() => ({ success: false as const, error: "Connection error" }));

    setLoading(false);

    if (result.success) {
      handleSuccess(result);
      return;
    }

    if ("mfaRequired" in result && result.mfaRequired) {
      setMfaState({
        mfaToken: result.mfaToken,
        challengeType: result.challengeType,
      });
      setScreen("mfa");
      return;
    }

    setError("error" in result ? result.error : "Login failed");
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || !mfaState) return;
    setLoading(true);
    setError(null);

    const result = await window.electron
      .epicDirectLoginMfa(otp.trim(), mfaState.mfaToken, mfaState.challengeType)
      .catch(() => ({ success: false as const, error: "Connection error" }));

    setLoading(false);

    if (result.success) {
      handleSuccess(result);
      return;
    }

    setError("error" in result ? result.error : "Verification failed");
  };

  const handleSocial = async (provider: "google" | "facebook" | "apple") => {
    setLoading(true);
    setError(null);
    const result = await window.electron
      .openEpicSocialAuthWindow(provider)
      .catch(() => ({ success: false as const }));
    setLoading(false);
    if (result.success) {
      handleSuccess(result);
    } else {
      setError("Social login was cancelled or failed.");
    }
  };

  const handleForgotPassword = () => {
    window.electron.openExternal(FORGOT_PASSWORD_URL);
  };

  return (
    <Modal
      visible={visible}
      title="Sign in to Epic Games"
      description="Log in to your Epic Games account to enable downloads."
      onClose={handleClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {screen === "credentials" && (
          <>
            <form
              onSubmit={handleCredentialSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
              {error && (
                <p style={{ color: "var(--color-error, #f87171)", margin: 0, fontSize: "0.85rem" }}>
                  {error}
                </p>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-muted, rgba(255,255,255,0.5))",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  Forgot password?
                </button>
                <Button type="submit" disabled={loading || !email || !password}>
                  {loading ? "Signing in…" : "Sign In"}
                </Button>
              </div>
            </form>

            <div style={dividerStyle}>
              <div style={{ flex: 1, height: "1px", background: "currentColor" }} />
              <span>or continue with</span>
              <div style={{ flex: 1, height: "1px", background: "currentColor" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                type="button"
                style={socialButtonStyle}
                disabled={loading}
                onClick={() => handleSocial("google")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2a10.34 10.34 0 0 0-.164-1.84H9v3.48h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.614z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.596.102-1.175.282-1.712V4.956H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.044l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.956L3.964 7.288C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </button>

              <button
                type="button"
                style={socialButtonStyle}
                disabled={loading}
                onClick={() => handleSocial("facebook")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="#1877F2">
                  <path d="M18 9a9 9 0 1 0-10.406 8.892V11.62H5.309V9h2.285V7.022c0-2.256 1.343-3.503 3.4-3.503.985 0 2.015.176 2.015.176v2.216h-1.135c-1.118 0-1.467.694-1.467 1.406V9h2.496l-.399 2.62H10.407v6.272A9.003 9.003 0 0 0 18 9z"/>
                </svg>
                Sign in with Facebook
              </button>

              <button
                type="button"
                style={socialButtonStyle}
                disabled={loading}
                onClick={() => handleSocial("apple")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M12.317 1c.045.63-.177 1.266-.555 1.74-.39.494-.99.87-1.614.83-.065-.617.196-1.25.562-1.706.396-.49 1.014-.866 1.607-.864zm2.066 4.315c-1.09-.671-2.335-.65-3.255-.097-.672.4-1.22.412-1.897.012-.883-.52-2.057-.607-3.082.033-1.504.929-2.22 2.838-1.79 4.982.428 2.165 1.756 4.79 3.332 4.77.57-.007 1.018-.38 1.635-.373.628.008 1.058.38 1.67.38 1.585 0 2.861-2.544 3.255-4.67-.893-.436-1.742-1.304-1.868-2.037zm-1.23-4.135c-.012 0-.025 0-.038.001-1.08.068-1.903.786-1.966 1.791-.055.9.59 1.717 1.49 1.88.01 0 .022.002.033.002 1.08-.057 1.903-.773 1.966-1.778.056-.9-.581-1.718-1.485-1.896z"/>
                </svg>
                Sign in with Apple
              </button>
            </div>
          </>
        )}

        {screen === "mfa" && (
          <form
            onSubmit={handleMfaSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.9rem" }}>
              {mfaState?.challengeType === "EMAIL"
                ? "A verification code was sent to your email."
                : "Enter the code from your authenticator app."}
            </p>
            <TextField
              label="Verification Code"
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="123456"
              disabled={loading}
            />
            {error && (
              <p style={{ color: "var(--color-error, #f87171)", margin: 0, fontSize: "0.85rem" }}>
                {error}
              </p>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <Button
                type="button"
                theme="outline"
                onClick={() => { setScreen("credentials"); setError(null); setOtp(""); }}
                disabled={loading}
              >
                Back
              </Button>
              <Button type="submit" disabled={loading || !otp.trim()}>
                {loading ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
