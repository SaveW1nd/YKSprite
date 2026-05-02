import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("yksprite", {
  version: "0.1.1"
});
