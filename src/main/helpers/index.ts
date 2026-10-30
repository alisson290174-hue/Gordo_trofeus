import path from "node:path";

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isPortableVersion = () => {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
};

export const normalizePath = (str: string) =>
  path.posix.normalize(str).replaceAll("\\", "/");

export const addTrailingSlash = (str: string) =>
  str.endsWith("/") ? str : `${str}/`;

export * from "./reg-parser";
export * from "./launch-game";
export * from "./launch-classics-game";
export * from "./open-classics-game";
export * from "./download-error-handler";
export * from "./platform-to-system";
export * from "./platform-to-retroarch-platform";
export * from "./launch-retroarch-game";
