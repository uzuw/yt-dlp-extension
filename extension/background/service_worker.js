// ytdlp-extension Service Worker
// Bridges popup <-> Native Messaging Host
console.log("[SW] Service worker starting");

const NATIVE_HOST = "com.ytdlp.extension";
let longLivedPort = null;
// ponytail: no cache — always query fresh so popup shows current tab URL
let downloadState = null;

// ---- helpers ----

function log(...args) { console.log("[SW]", ...args); }
function err(...args) { console.error("[SW]", ...args); }

function sendNativeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

function connectNative() {
  if (longLivedPort) {
    try { longLivedPort.disconnect(); } catch (_) {}
    longLivedPort = null;
  }
  log("Connecting native port");
  longLivedPort = chrome.runtime.connectNative(NATIVE_HOST);

  longLivedPort.onMessage.addListener((msg) => {
    if (msg.type === "progress") {
      downloadState = { command: "download", ...msg, active: true };
    } else if (["done", "canceled", "error", "download_started"].includes(msg.type)) {
      downloadState = { ...msg, command: "download", active: msg.type !== "done" && msg.type !== "canceled" && msg.type !== "error" };
    }
    chrome.runtime.sendMessage({ source: "nmh", ...msg }).catch(() => {
      // ponytail: popup closed, alert via notification
      if (msg.type === "done") {
        showNotification("ytdlp Downloader", "Download complete!");
        downloadState = null;
      } else if (msg.type === "error") {
        showNotification("ytdlp Downloader", "Download failed: " + (msg.message || "").slice(0, 80));
        downloadState = null;
      }
    });
  });

  longLivedPort.onDisconnect.addListener(() => {
    const errMsg = chrome.runtime.lastError?.message;
    if (errMsg && !errMsg.includes("disconnected")) {
      err("Port disconnect:", errMsg);
    }
    log("Native port disconnected");
    longLivedPort = null;
  });
}

// ---- notification helper ----

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: title || "ytdlp Downloader",
    message: message || "Download complete",
    priority: 2,
  });
}

// ---- message handlers ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  log("Message:", msg.command || msg.type);

  // Tab URL — always query fresh for current tab
  if (msg.command === "getTabUrl") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      if (!tabs?.length) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      sendResponse({ url: tabs[0].url || tabs[0].pendingUrl || "" });
    });
    return true;
  }

  // List formats
  if (msg.command === "list_formats") {
    sendNativeMessage({ command: "list_formats", url: msg.url })
      .then((resp) => sendResponse(resp))
      .catch((e) => {
        // Might need to connect port first try — retry once if first attempt fails
        connectNative();
        sendNativeMessage({ command: "list_formats", url: msg.url })
          .then((resp) => sendResponse(resp))
          .catch((e2) => sendResponse({ type: "error", message: e2.message }));
      });
    return true;
  }

  // Start download — always sends through the long-lived port for streaming
  if (msg.command === "download") {
    if (!longLivedPort) connectNative();
    downloadState = { command: "download", active: true, type: "started", percent: 0 };
    longLivedPort.postMessage({ command: "download", url: msg.url, format_id: msg.format_id });
    sendResponse({ ok: true });
    return true;
  }

  // Download state — for popup re-open mid-download
  if (msg.command === "getDownloadState") {
    sendResponse(downloadState || { active: false });
    return true;
  }

  // Cancel
  if (msg.command === "cancel") {
    if (longLivedPort) {
      longLivedPort.postMessage({ command: "cancel" });
    } else {
      sendNativeMessage({ command: "cancel" }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ---- lifecycle ----

self.addEventListener("install", () => {
  log("Installed");
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  log("Activated");
});
