import jwt from "jsonwebtoken";
import { readAuth } from "@main/services/auth-store";

import { registerEvent } from "../register-event";

const getSessionHash = async (_event: Electron.IpcMainInvokeEvent) => {
  const auth = await readAuth();

  if (!auth) return null;
  const payload = jwt.decode(auth.accessToken) as jwt.JwtPayload;

  if (!payload) return null;

  return payload.sessionId;
};

registerEvent("getSessionHash", getSessionHash);
