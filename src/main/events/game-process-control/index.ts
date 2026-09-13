import { GameProcessControlManager, OverlayManager } from "@main/services";

import { registerEvent } from "../register-event";

GameProcessControlManager.initialize();

registerEvent("getActiveGameProcessState", () =>
  GameProcessControlManager.getState(
    OverlayManager.getActiveGame(),
    OverlayManager.getTargetProcessId()
  )
);

registerEvent("pauseActiveGame", () =>
  GameProcessControlManager.pause(
    OverlayManager.getActiveGame(),
    OverlayManager.getTargetProcessId()
  )
);

registerEvent("resumeActiveGame", () =>
  GameProcessControlManager.resume(OverlayManager.getActiveGame())
);

registerEvent("closeActiveGame", () =>
  GameProcessControlManager.close(
    OverlayManager.getActiveGame(),
    OverlayManager.getTargetProcessId()
  )
);
