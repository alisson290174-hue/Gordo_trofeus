import { registerEvent } from "../register-event";
import { readAuth } from "@main/services/auth-store";

// The renderer never gets the tokens themselves — only whether a session exists and until when.
const getAuth = async (_event: Electron.IpcMainInvokeEvent) => {
  const auth = await readAuth();
  return auth
    ? {
        isLoggedIn: true,
        tokenExpirationTimestamp: auth.tokenExpirationTimestamp,
      }
    : null;
};

registerEvent("getAuth", getAuth);
