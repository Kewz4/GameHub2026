import { useEffect, useRef } from "react";
import { Modal } from "@renderer/components";

interface WebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
}

const GOG_CLIENT_ID = "46899977096215655";
const GOG_REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";

const GOG_AUTH_URL =
  `https://auth.gog.com/auth?client_id=${GOG_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(GOG_REDIRECT_URI)}` +
  `&response_type=code&layout=client2`;

export interface GogAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (
    result: { refresh_token: string; username: string } | null
  ) => void;
}

export function GogAuthModal({
  visible,
  onClose,
  onSuccess,
}: Readonly<GogAuthModalProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (!visible || !containerRef.current) return;
    handledRef.current = false;

    const wv = document.createElement("webview") as unknown as WebviewElement;
    wv.src = GOG_AUTH_URL;
    wv.style.width = "100%";
    wv.style.height = "100%";
    wv.style.display = "block";
    containerRef.current.appendChild(wv);

    const tryExtract = async (url: string) => {
      if (handledRef.current) return;
      if (!url.includes("on_login_success")) return;

      let code: string | null = null;
      try {
        code = new URL(url).searchParams.get("code");
      } catch {
        return;
      }
      if (!code) return;

      handledRef.current = true;
      const result = await window.electron
        .completeGogAuth(code)
        .catch(() => null);
      onSuccess(result);
      onClose();
    };

    const onWillNavigate = (e: Event) =>
      void tryExtract((e as Event & { url: string }).url);
    const onDidNavigate = (e: Event) =>
      void tryExtract((e as Event & { url: string }).url);

    wv.addEventListener("will-navigate", onWillNavigate);
    wv.addEventListener("did-navigate", onDidNavigate);

    const container = containerRef.current;
    return () => {
      wv.removeEventListener("will-navigate", onWillNavigate);
      wv.removeEventListener("did-navigate", onDidNavigate);
      if (container.contains(wv)) container.removeChild(wv);
    };
  }, [visible, onClose, onSuccess]);

  return (
    <Modal
      visible={visible}
      title="Sign in to GOG"
      description="Log in to your GOG account to enable downloads."
      onClose={onClose}
      large
      noContentPadding
    >
      <div ref={containerRef} style={{ height: "100%", minHeight: "480px" }} />
    </Modal>
  );
}
