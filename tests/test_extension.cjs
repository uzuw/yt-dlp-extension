const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

async function main() {
  let listener;
  let disconnected;
  let nativeMessage;
  let nativeCalls = 0;
  const messages = [];
  const port = {
    onMessage: { addListener: (fn) => { nativeMessage = fn; } },
    onDisconnect: { addListener: (fn) => { disconnected = fn; } },
    postMessage() {},
    disconnect() { throw new Error("An active download must stay connected"); },
  };
  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      connectNative: () => port,
      sendMessage: (msg) => { messages.push(msg); return Promise.reject(new Error("Popup closed")); },
      sendNativeMessage: (name, msg, cb) => {
        nativeCalls++;
        chrome.runtime.lastError = { message: "Host failed" };
        cb();
        delete chrome.runtime.lastError;
      },
      getURL: (url) => url,
    },
    notifications: { create() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "extension/background/service_worker.js"), "utf8"), {
    chrome, console, self: { addEventListener() {} },
  });
  const send = (msg) => new Promise((resolve) => listener(msg, {}, resolve));

  await send({ command: "download", url: "https://example.com/video" });
  assert.equal((await send({ command: "getDownloadState" })).active, true);
  assert.equal((await send({ command: "list_formats", url: "https://example.com/other" })).type, "error");
  assert.equal(nativeCalls, 1);
  assert.equal((await send({ command: "getDownloadState" })).active, true);

  nativeMessage({ type: "error", message: "ERROR: HTTP 403; update the extension" });
  await Promise.resolve();
  assert.equal((await send({ command: "getDownloadState" })).type, "error", "Closed popup must retain the failure");
  await send({ command: "download", url: "https://example.com/video" });
  chrome.runtime.lastError = { message: "Native host has exited" };
  disconnected();
  delete chrome.runtime.lastError;
  await Promise.resolve();
  const state = await send({ command: "getDownloadState" });
  assert.equal(state.active, false);
  assert.match(state.message, /Native host has exited/);
  assert.equal(messages.at(-1).type, "error");

  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        classList: { add() {}, remove() {} }, style: {}, textContent: "",
        addEventListener(event, callback) { this[event] = callback; },
        querySelector() { return element(id + "-span"); },
      });
    }
    return elements.get(id);
  }
  let formatRequests = 0;
  const popup = {
    chrome: { runtime: {
      onMessage: { addListener() {} },
      async sendMessage(msg) {
        if (msg.command === "getTabUrl") return { url: "https://example.com/video" };
        if (msg.command === "getDownloadState") return { type: "error", message: "Saved download failure" };
        formatRequests++;
        return { type: "error", message: "Fresh lookup attempted" };
      },
    } },
    document: { getElementById: element }, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "extension/popup/popup.js"), "utf8"), popup);
  await new Promise(setImmediate);
  assert.equal(element("error-text").textContent, "Saved download failure");
  assert.equal(formatRequests, 0);
  element("retry-btn").click();
  await new Promise(setImmediate);
  assert.equal(formatRequests, 1, "Retry must get past the saved failure");
  assert.equal(element("error-text").textContent, "Fresh lookup attempted");
  console.log("Extension checks passed: retained errors, disconnects, lookup isolation, popup retry");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
