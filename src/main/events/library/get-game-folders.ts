import { registerEvent } from "../register-event";
import {
  findNewFolderGames,
  getGameFolders,
} from "@main/services/folder-game-finder";

registerEvent("getGameFolders", () => getGameFolders());
registerEvent("findNewFolderGames", () => findNewFolderGames());
