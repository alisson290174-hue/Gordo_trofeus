import { registerEvent } from "../register-event";
import { groupedSouvenirWorker } from "@main/services";

const updateNetworkStatus = (
  _event: Electron.IpcMainInvokeEvent,
  payload: { online: boolean; switched?: boolean }
) => {
  if (payload.online) void groupedSouvenirWorker.trigger();
};

registerEvent("updateNetworkStatus", updateNetworkStatus);
