import { app, BrowserWindow } from "electron";
import { join } from "node:path";

let mainWindow: BrowserWindow | null = null;

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true
    }
  });

  mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent("<!doctype html><meta charset='utf-8'><title>YKSprite</title><h1>YKSprite Desktop</h1>")
  );

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    createMainWindow();
  }
});
