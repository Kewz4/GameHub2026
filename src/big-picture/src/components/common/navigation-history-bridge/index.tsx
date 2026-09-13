import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  getBigPictureDefaultPageTitle,
  isSameBigPictureNavigationLocation,
} from "../../../layout/navigation";
import { useNavigationHistoryStore } from "../../../stores";

export function NavigationHistoryBridge() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const store = useNavigationHistoryStore.getState();
    const entry = {
      key: location.key,
      pathname: location.pathname,
      title: getBigPictureDefaultPageTitle(location.pathname),
    };

    const top = store.stack[store.stack.length - 1];
    if (top && isSameBigPictureNavigationLocation(top, entry)) return;

    if (store.stack.length === 0) {
      store.push(entry);
      return;
    }

    if (navigationType === "POP") {
      const idx = store.stack.findIndex((candidate) =>
        isSameBigPictureNavigationLocation(candidate, entry)
      );
      if (idx >= 0) {
        const popCount = store.stack.length - 1 - idx;
        for (let i = 0; i < popCount; i++) store.pop();
      } else {
        store.replaceTop(entry);
      }
      return;
    }

    if (navigationType === "REPLACE") {
      store.replaceTop(entry);
      return;
    }

    store.push(entry);
  }, [location.key, location.pathname, navigationType]);

  return null;
}
