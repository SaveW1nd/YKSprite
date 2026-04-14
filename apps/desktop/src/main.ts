import { app, BrowserWindow } from "electron";
import path from "node:path";

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });

  mainWindow.loadURL(process.env.YKSPRITE_WEB_URL ?? "http://localhost:5173");
}

app.whenReady().then(createWindow);
