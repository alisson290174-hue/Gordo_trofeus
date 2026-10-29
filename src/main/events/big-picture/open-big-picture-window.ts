import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("openBigPictureWindow", () => {
  WindowManager.openBigPictureWindow();
});
