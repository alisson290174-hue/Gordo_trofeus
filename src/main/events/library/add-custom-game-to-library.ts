import { registerEvent } from "../register-event";
import { addCustomGame } from "@main/helpers/add-custom-game";

const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string
) =>
  addCustomGame(
    title,
    executablePath,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl
  );

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
