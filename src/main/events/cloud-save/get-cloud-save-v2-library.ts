import { listCloudSaveV2Library } from "@main/services/cloud-save/list-cloud-save-v2-library";

import { registerEvent } from "../register-event";

registerEvent("getCloudSaveV2Library", () => listCloudSaveV2Library());
