import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

/** The version downloaded and ready to install, or null. */
const getDownloadedUpdate = async (_event: Electron.IpcMainInvokeEvent) =>
  UpdateManager.getDownloadedVersion();

registerEvent("getDownloadedUpdate", getDownloadedUpdate);
