import { useEffect, useRef } from "react";
import { Modal } from "@renderer/components";

interface WebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  executeJavaScript(code: string): Promise<string>;
}

const REDIRECT_API =
  "https://www.epicgames.com/id/api/redirect" +
  "?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";

const EPIC_LOGIN_URL =
  "https://www.epicgames.com/id/login" +
  "?redirectUrl=" +
  encodeURIComponent(REDIRECT_API) +
  "&noRedirect=true";

export interface EpicAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { success: boolean; account?: string }) => void;
}

export function EpicAuthModal({
  visible,
  onClose,
  onSuccess,
}: Readonly<EpicAuthModalProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (!visible || !containerRef.current) return;
    handledRef.current = false;

    const wv = document.createElement("webview") as unknown as WebviewElement;
    wv.src = EPIC_LOGIN_URL;
    wv.style.width = "100%";
    wv.style.height = "640px";
    wv.style.display = "block";
    containerRef.current.appendChild(wv);

    const tryExtract = async (url: string) => {
      if (handledRef.current) return;
      if (!url.includes("/id/api/redirect")) return;

      await new Promise((r) => setTimeout(r, 200));

      let bodyText = "";
      try {
        bodyText = await wv.executeJavaScript("document.body.innerText");
      } catch {
        return;
      }

      let code: string | null = null;
      try {
        const json = JSON.parse(bodyText.trim());
        code =
          json?.authorizationCode || json?.exchangeCode || json?.code || null;
      } catch {
        try {
          code = new URL(url).searchParams.get("code");
        } catch {
          // ignore
        }
      }

      if (!code || typeof code !== "string" || code.length < 8) return;

      handledRef.current = true;
      const result = await window.electron
        .completeEpicAuth(code)
        .catch(() => ({ success: false as const }));
      onSuccess(result);
      onClose();
    };

    const onWillNavigate = (e: Event) =>
      void tryExtract((e as Event & { url: string }).url);
    const onDidNavigate = (e: Event) =>
      void tryExtract((e as Event & { url: string }).url);
    const onDidFinishLoad = () => void tryExtract(wv.getURL());

    wv.addEventListener("will-navigate", onWillNavigate);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-finish-load", onDidFinishLoad);

    const container = containerRef.current;
    return () => {
      wv.removeEventListener("will-navigate", onWillNavigate);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-finish-load", onDidFinishLoad);
      if (container.contains(wv)) container.removeChild(wv);
    };
  }, [visible, onClose, onSuccess]);

  return (
    <Modal
      visible={visible}
      title="Sign in to Epic Games"
      description="Log in to your Epic Games account to enable downloads."
      onClose={onClose}
      large
      noContentPadding
    >
      <div ref={containerRef} style={{ minHeight: "640px" }} />
    </Modal>
  );
}
