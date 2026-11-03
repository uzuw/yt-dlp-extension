// ytdlp-extension Popup logic
console.log("[Popup] Loaded");

const DOM = {
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  errorText: document.getElementById("error-text"),
  retryBtn: document.getElementById("retry-btn"),
  formatsPanel: document.getElementById("formats-panel"),
  formatList: document.getElementById("format-list"),
  urlDisplay: document.getElementById("url-display"),
  siteBadge: document.getElementById("site-badge"),
  downloadBtn: document.getElementById("download-btn"),
  progressPanel: document.getElementById("progress-panel"),
  progressFill: document.getElementById("progress-fill"),
  progressPct: document.getElementById("progress-pct"),
  progressSpeed: document.getElementById("progress-speed"),
  progressEta: document.getElementById("progress-eta"),
  progressText: document.getElementById("progress-text"),
  cancelBtn: document.getElementById("cancel-btn"),
  doneBtn: document.getElementById("done-btn"),
  openBtn: document.getElementById("open-btn"),
};

let currentUrl = null;
let selectedFormatId = null;
let isDownloading = false;
let lastProgress = 0;

// ---- helpers ----

function showView(panel) {
  [DOM.loading, DOM.error, DOM.formatsPanel, DOM.progressPanel].forEach((el) => {
    el.classList.add("hidden");
  });
  if (panel) panel.classList.remove("hidden");
}

function showError(msg) {
  console.error("[Popup] Error:", msg);
  showView(DOM.error);
  DOM.errorText.textContent = msg;
}

function humanSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch (_) { return ""; }
}

// ---- format rendering ----

function qualityTag(f) {
  if (f.format_id === "bv*+ba/b" || f.format_id === "best") return '<span class="format-tag tag-best">Best</span>';
  if (f.format_note && f.format_note.includes("Best")) return '<span class="format-tag tag-best">Best</span>';
  return "";
}

function formatLabel(f) {
  const parts = [];
  if (f.format_note) {
    parts.push(f.format_note);
  } else if (f.height) {
    parts.push(f.height >= 2160 ? "4K" : f.height >= 1440 ? "2K" : f.height + "p");
  } else {
    parts.push(f.format_id);
  }
  if (f.ext) parts.push(f.ext.toUpperCase());
  if (f.fps && f.fps > 30) parts.push(f.fps + "fps");
  return parts.join(" \u2022 ");
}

function formatDetail(f) {
  const parts = [];
  const v = f.vcodec || "";
  const a = f.acodec || "";
  if (v && a) {
    const vShort = v.includes("av1") ? "AV1" : v.includes("vp9") ? "VP9" : v.includes("h264") || v.includes("avc1") ? "H.264" : v.includes("hevc") || v.includes("h265") ? "H.265" : v;
    const aShort = a.includes("opus") ? "Opus" : a.includes("aac") ? "AAC" : a.includes("mp4a") ? "AAC" : a.includes("mp3") ? "MP3" : a;
    parts.push(vShort + " / " + aShort);
  } else if (v) {
    parts.push((v.includes("av1") ? "AV1" : v.includes("vp9") ? "VP9" : v.includes("h264") ? "H.264" : v.includes("avc1") ? "H.264" : v) + " (video only)");
  } else if (a) {
    parts.push((a.includes("opus") ? "Opus" : a.includes("aac") ? "AAC" : a.includes("mp4a") ? "AAC" : a.includes("mp3") ? "MP3" : a) + " (audio only)");
  }
  if (f.tbr) parts.push(Math.round(f.tbr) + "kbps");
  if (f.filesize) parts.push(humanSize(f.filesize));
  return parts.join(" | ");
}

function groupFormats(formats) {
  const groups = { combined: [], video: [], audio: [] };
  for (const f of formats) {
    const hv = !!f.vcodec;
    const ha = !!f.acodec;
    if (hv && ha) groups.combined.push(f);
    else if (hv) groups.video.push(f);
    else if (ha) groups.audio.push(f);
    else groups.combined.push(f);
  }
  const byRes = (a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0);
  groups.combined.sort(byRes);
  groups.video.sort(byRes);
  groups.audio.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
  return groups;
}

function renderFormats(formats, title, extractor) {
  showView(DOM.formatsPanel);
  document.getElementById("title").textContent = title || "Untitled";

  // Site badge
  if (extractor) {
    DOM.siteBadge.textContent = extractor;
    DOM.siteBadge.classList.remove("hidden");
  } else {
    DOM.siteBadge.classList.add("hidden");
  }

  const groups = groupFormats(formats);
  DOM.formatList.innerHTML = "";

  if (groups.combined.length) appendGroup("Video + Audio", groups.combined, true);
  if (groups.video.length) appendGroup("Video Only", groups.video, true);
  if (groups.audio.length) appendGroup("Audio Only", groups.audio, true);

  if (!groups.combined.length && !groups.video.length && !groups.audio.length) {
    DOM.formatList.innerHTML = '<div class="format-row" style="color:#888;cursor:default;justify-content:center">No formats available</div>';
  }

  // Preselect best format
  const radios = DOM.formatList.querySelectorAll("input[type='radio']");
  if (radios.length > 0) {
    radios[0].checked = true;
    selectedFormatId = radios[0].value;
    DOM.downloadBtn.disabled = false;
  }

  function appendGroup(label, items, showTag) {
    const header = document.createElement("div");
    header.className = "format-group-label";
    header.textContent = label;
    DOM.formatList.appendChild(header);

    const maxShow = 20;
    items.slice(0, maxShow).forEach((f) => {
      const row = document.createElement("label");
      row.className = "format-row";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "format";
      radio.value = f.format_id;
      radio.addEventListener("change", () => { selectedFormatId = f.format_id; });

      const info = document.createElement("div");
      info.className = "format-info";

      const labelEl = document.createElement("div");
      labelEl.className = "format-label";
      labelEl.innerHTML = qualityTag(f) + formatLabel(f);

      const detailEl = document.createElement("div");
      detailEl.className = "format-detail";
      detailEl.textContent = formatDetail(f);

      info.appendChild(labelEl);
      info.appendChild(detailEl);
      row.appendChild(radio);
      row.appendChild(info);
      DOM.formatList.appendChild(row);
    });

    if (items.length > maxShow) {
      const more = document.createElement("div");
      more.className = "format-detail";
      more.style.cssText = "padding:6px 14px;color:#999;font-style:italic";
      more.textContent = "+ " + (items.length - maxShow) + " more formats";
      DOM.formatList.appendChild(more);
    }
  }
}

// ---- progress ----

function showProgress() {
  showView(DOM.progressPanel);
  DOM.progressFill.style.width = "0%";
  DOM.progressPct.textContent = "0%";
  DOM.progressSpeed.textContent = "";
  DOM.progressEta.textContent = "";
  DOM.progressText.textContent = "Starting download...";
  DOM.cancelBtn.classList.remove("hidden");
  DOM.doneBtn.classList.add("hidden");
  DOM.openBtn.classList.add("hidden");
}

function updateProgress(pct, speed, eta) {
  const clamped = Math.min(pct, 100);
  DOM.progressFill.style.width = clamped + "%";
  DOM.progressPct.textContent = Math.round(clamped) + "%";
  DOM.progressSpeed.textContent = speed || "";
  DOM.progressEta.textContent = eta ? "ETA " + eta : "";
  lastProgress = clamped;
}

// ---- main init ----

async function init(retry = false) {
  // Listen for streaming progress from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.source !== "nmh") return;

    switch (msg.type) {
      case "progress":
        updateProgress(msg.percent || 0, msg.speed || "", msg.eta || "");
        break;
      case "filepath":
        DOM.progressText.textContent = msg.path ? "Saving to: " + msg.path.split("/").pop() : "Downloading...";
        break;
      case "status":
        DOM.progressText.textContent = msg.text || "";
        break;
      case "done":
        updateProgress(100, "", "");
        DOM.progressText.textContent = "Download complete!";
        DOM.cancelBtn.classList.add("hidden");
        DOM.doneBtn.classList.remove("hidden");
        DOM.openBtn.classList.remove("hidden");
        isDownloading = false;
        break;
      case "error":
        showError(msg.message || "Download failed");
        isDownloading = false;
        break;
      case "canceled":
        DOM.progressText.textContent = "Cancelled";
        DOM.cancelBtn.classList.add("hidden");
        DOM.doneBtn.classList.remove("hidden");
        isDownloading = false;
        break;
      case "formats":
        renderFormats(msg.formats || [], msg.title || "", msg.extractor || "");
        break;
    }
  });

  // Get tab URL
  try {
    const tabResp = await chrome.runtime.sendMessage({ command: "getTabUrl" });
    if (tabResp.error) { showError(tabResp.error); return; }
    currentUrl = tabResp.url;
    DOM.urlDisplay.textContent = currentUrl;
  } catch (e) {
    showError("Cannot access tab URL: " + e.message);
    return;
  }

  if (!currentUrl || !currentUrl.startsWith("http")) {
    showError("Navigate to a page with media first (only http/https URLs are supported)");
    return;
  }

  try {
    const dlState = await chrome.runtime.sendMessage({ command: "getDownloadState" });
    if (dlState && dlState.active) {
      isDownloading = true;
      showView(DOM.progressPanel);
      DOM.progressText.textContent = "Downloading...";
      if (dlState.percent > 0) updateProgress(dlState.percent, dlState.speed, dlState.eta);
      return;
    }
    if (dlState?.type === "error" && !retry) {
      showError(dlState.message || "Download failed");
      return;
    }
  } catch (_) {}

  // Show loading, fetch formats
  showView(DOM.loading);
  DOM.loading.querySelector("span").textContent = "Fetching formats from " + extractDomain(currentUrl) + "...";

  try {
    const resp = await chrome.runtime.sendMessage({ command: "list_formats", url: currentUrl });
    if (resp.type === "error") { showError(resp.message); return; }
    if (resp.type === "formats" && Array.isArray(resp.formats)) {
      renderFormats(resp.formats, resp.title, resp.extractor);
    } else {
      showError("Unexpected response from native host");
    }
  } catch (e) {
    showError("Failed to fetch formats: " + e.message);
  }
}

// ---- download ----

DOM.downloadBtn.addEventListener("click", async () => {
  if (!currentUrl || !selectedFormatId) return;
  isDownloading = true;
  showProgress();
  lastProgress = 0;

  try {
    await chrome.runtime.sendMessage({
      command: "download",
      url: currentUrl,
      format_id: selectedFormatId,
    });
  } catch (e) {
    showError("Download failed to start: " + e.message);
    isDownloading = false;
  }
});

DOM.cancelBtn.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ command: "cancel" });
  } catch (e) {
    console.error("[Popup] Cancel error:", e);
  }
});

DOM.doneBtn.addEventListener("click", () => window.close());

DOM.openBtn.addEventListener("click", () => {
  // chrome.downloads.showDefaultFolder() is Chrome-only
  chrome.tabs.create({ url: "downloads" }); // opens chrome://downloads
});

DOM.retryBtn.addEventListener("click", () => {
  showView(DOM.loading);
  init(true);
});

// Start
init();
