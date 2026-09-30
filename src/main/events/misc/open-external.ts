import { registerEvent } from "../register-event";
import { openExternalSafe } from "@main/helpers/open-external-safe";

const openExternal = async (_event: Electron.IpcMainInvokeEvent, src: string) =>
  openExternalSafe(src);

registerEvent("openExternal", openExternal);
