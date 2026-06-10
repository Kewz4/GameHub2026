import { useState } from "react";
import { Modal, Button } from "@renderer/components";

export interface GogAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { refresh_token: string; username: string } | null) => void;
}

const FORGOT_PASSWORD_URL = "https://login.gog.com/forgot-password";

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

export function GogAuthModal({
  visible,
  onClose,
  onSuccess,
}: Readonly<GogAuthModalProps>) {
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setLoading(false);
    onClose();
  };

  const openGogWindow = async () => {
    setLoading(true);
    const result = await window.electron
      .openGogAuthWindow()
      .catch(() => null);
    setLoading(false);
    onSuccess(result);
    if (result) onClose();
  };

  const handleForgotPassword = () => {
    window.electron.openExternal(FORGOT_PASSWORD_URL);
  };

  return (
    <Modal
      visible={visible}
      title="Sign in to GOG"
      description="Log in to your GOG account to enable downloads."
      onClose={handleClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <Button
            type="button"
            onClick={openGogWindow}
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading ? "Opening…" : "Sign in with Email / Password"}
          </Button>
        </div>

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
            onClick={openGogWindow}
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
            onClick={openGogWindow}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="#1877F2">
              <path d="M18 9a9 9 0 1 0-10.406 8.892V11.62H5.309V9h2.285V7.022c0-2.256 1.343-3.503 3.4-3.503.985 0 2.015.176 2.015.176v2.216h-1.135c-1.118 0-1.467.694-1.467 1.406V9h2.496l-.399 2.62H10.407v6.272A9.003 9.003 0 0 0 18 9z"/>
            </svg>
            Sign in with Facebook
          </button>
        </div>

        <div style={{ marginTop: "16px", textAlign: "center" }}>
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
        </div>
      </div>
    </Modal>
  );
}
