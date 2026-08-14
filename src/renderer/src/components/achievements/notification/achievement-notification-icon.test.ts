import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAchievementNotificationIconQueue,
  positionAchievementNotifications,
  preloadAchievementIcon,
  prepareAchievementNotificationIcons,
} from "./achievement-notification-icon";

const achievement = {
  title: "Friendly Neighborhood Spider-Man",
  description: "Complete the first district activity",
  iconUrl: "https://example.test/spider-badge.png",
  isHidden: false,
  isRare: false,
  isPlatinum: false,
};

describe("achievement notification icons", () => {
  it("waits for decode even when the badge is already cached", async () => {
    const originalImage = globalThis.Image;
    const originalWindow = globalThis.window;
    let resolveDecode: () => void = () => undefined;
    let decodeCalls = 0;

    class CachedImage {
      complete = true;
      naturalWidth = 64;
      decoding = "auto";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      decode() {
        decodeCalls += 1;
        return new Promise<void>((resolve) => {
          resolveDecode = resolve;
        });
      }
    }

    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: CachedImage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { setTimeout, clearTimeout },
    });
    try {
      let settled = false;
      const pending = preloadAchievementIcon("cached-badge").then((loaded) => {
        settled = true;
        return loaded;
      });
      await Promise.resolve();
      assert.equal(decodeCalls, 1);
      assert.equal(settled, false, "cached completion cannot bypass decode");
      resolveDecode();
      assert.equal(await pending, true);
    } finally {
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: originalImage,
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("retains a decoded achievement badge", async () => {
    const loaded: string[] = [];
    const [prepared] = await prepareAchievementNotificationIcons(
      [achievement],
      "gamehub-fallback.svg",
      async (url) => {
        loaded.push(url);
        return true;
      }
    );

    assert.equal(prepared.iconUrl, achievement.iconUrl);
    assert.deepEqual(loaded, [achievement.iconUrl]);
  });

  it("uses a decoded stable fallback instead of a blank image box", async () => {
    const loaded: string[] = [];
    const [prepared] = await prepareAchievementNotificationIcons(
      [achievement],
      "gamehub-fallback.svg",
      async (url) => {
        loaded.push(url);
        return url === "gamehub-fallback.svg";
      }
    );

    assert.equal(prepared.iconUrl, "gamehub-fallback.svg");
    assert.deepEqual(loaded, [achievement.iconUrl, "gamehub-fallback.svg"]);
  });

  it("serializes rapid unlock batches and exposes neither before its decode", async () => {
    const resolvers = new Map<string, (loaded: boolean) => void>();
    const queue = createAchievementNotificationIconQueue(
      "gamehub-fallback.svg",
      (url) =>
        new Promise<boolean>((resolve) => {
          resolvers.set(url, resolve);
        })
    );
    const mounted: string[] = [];
    const first = queue
      .enqueue([{ ...achievement, title: "A", iconUrl: "badge-a" }])
      .then((batch) => {
        if (batch) mounted.push(batch[0].title);
      });
    const second = queue
      .enqueue([{ ...achievement, title: "B", iconUrl: "badge-b" }])
      .then((batch) => {
        if (batch) mounted.push(batch[0].title);
      });

    await Promise.resolve();
    assert.equal(resolvers.has("badge-a"), true);
    assert.equal(
      resolvers.has("badge-b"),
      false,
      "B must not begin decoding ahead of event A"
    );
    assert.deepEqual(mounted, [], "no notification mounts before A decodes");

    resolvers.get("badge-a")?.(true);
    await first;
    assert.deepEqual(mounted, ["A"]);
    await Promise.resolve();
    assert.equal(resolvers.has("badge-b"), true);

    resolvers.get("badge-b")?.(true);
    await second;
    assert.deepEqual(mounted, ["A", "B"]);
    queue.dispose();
  });

  it("keeps each decoded batch anchored to its original position", () => {
    const first = positionAchievementNotifications(
      [{ ...achievement, title: "A" }],
      "top-left"
    );
    const second = positionAchievementNotifications(
      [{ ...achievement, title: "B" }],
      "bottom-right"
    );
    const queue = first.concat(second);

    assert.deepEqual(
      queue.map(({ achievement: item, position }) => [item.title, position]),
      [
        ["A", "top-left"],
        ["B", "bottom-right"],
      ]
    );
  });

  it("drops a decoded batch after notification teardown", async () => {
    let resolveBadge: (loaded: boolean) => void = () => undefined;
    const queue = createAchievementNotificationIconQueue(
      "gamehub-fallback.svg",
      () =>
        new Promise((resolve) => {
          resolveBadge = resolve;
        })
    );
    const pending = queue.enqueue([achievement]);
    await Promise.resolve();
    queue.dispose();
    resolveBadge(true);
    assert.equal(await pending, null);
  });
});
