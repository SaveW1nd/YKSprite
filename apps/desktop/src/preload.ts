import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("ykDesktop", {
  ping: () => "pong"
});
