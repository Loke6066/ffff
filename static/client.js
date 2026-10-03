// Deep-Live-Cam 2.1.5 GitHub Edition - Authentic Web Studio Controller
document.addEventListener("DOMContentLoaded", () => {
  const token = window.SESSION_TOKEN;
  const initialDuration = window.SESSION_DURATION;

  // DOM Elements
  const sessionTimerDisplay = document.getElementById("sessionTimerDisplay");
  const faceDropZone = document.getElementById("faceDropZone");
  const faceFileInput = document.getElementById("faceFileInput");
  const faceImgPreview = document.getElementById("faceImgPreview");
  const facePlaceholder = document.getElementById("facePlaceholder");
  const btnSelectFace = document.getElementById("btnSelectFace");
  const btnSelectTarget = document.getElementById("btnSelectTarget");
  const btnSwapFaces = document.getElementById("btnSwapFaces");
  const btnSwapIcon = document.getElementById("btnSwapIcon");
  const presetBar = document.getElementById("presetBar");
  const presetGallery = document.getElementById("presetGallery");

  const cameraSelect = document.getElementById("cameraSelect");
  const resSelect = document.getElementById("resSelect");
  const detSizeSelect = document.getElementById("detSizeSelect");
  const enhancerSelect = document.getElementById("enhancerSelect");
  const transparencySlider = document.getElementById("transparencySlider");
  const sharpnessSlider = document.getElementById("sharpnessSlider");
  const mouthMaskSlider = document.getElementById("mouthMaskSlider");

  const btnStart = document.getElementById("btnStart");
  const btnDestroy = document.getElementById("btnDestroy");
  const btnDestroyTop = document.getElementById("btnDestroyTop");
  const btnLive = document.getElementById("btnLive");

  const livePreviewWindow = document.getElementById("livePreviewWindow");
  const previewCanvasWrap = document.getElementById("previewCanvasWrap");
  const liveCanvas = document.getElementById("liveCanvas");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  const previewLoader = document.getElementById("previewLoader");
  const hudFps = document.getElementById("hudFps");
  const pingBadge = document.getElementById("pingBadge");
  const statusBarText = document.getElementById("statusBarText");

  const btnPopout = document.getElementById("btnPopout");
  const btnMinPreview = document.getElementById("btnMinPreview");
  const btnMaxPreview = document.getElementById("btnMaxPreview");
  const btnClosePreview = document.getElementById("btnClosePreview");

  const canvasCtx = liveCanvas.getContext("2d");

  let localStream = null;
  let isStreaming = false;
  let ws = null;
  let pendingFrame = false;
  let frameCounter = 0;
  let fpsTimer = performance.now();
  let remainingSeconds = initialDuration * 60;
  let faceLocked = true; // default reference face is preloaded

  // Off-screen canvas for frame capture
  const captureCanvas = document.createElement("canvas");
  const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

  // 1. Initial Device Detection
  async function initCameras() {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      
      cameraSelect.innerHTML = "";
      if (videoDevices.length === 0) {
        cameraSelect.innerHTML = `<option value="">Default Web Camera</option>`;
        return;
      }

      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement("option");
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Camera ${idx + 1}`;
        cameraSelect.appendChild(opt);
      });
    } catch (err) {
      console.warn("Camera permission prompt error:", err);
      cameraSelect.innerHTML = `<option value="">Default Web Camera</option>`;
    }
  }
  initCameras();

  // 2. Face Upload Handling
  btnSelectFace.addEventListener("click", () => faceFileInput.click());
  btnSwapIcon.addEventListener("click", () => faceFileInput.click());
  faceDropZone.addEventListener("click", () => faceFileInput.click());

  faceDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    faceDropZone.style.borderColor = "#1a73e8";
  });
  faceDropZone.addEventListener("dragleave", () => {
    faceDropZone.style.borderColor = "#333642";
  });
  faceDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    faceDropZone.style.borderColor = "#333642";
    if (e.dataTransfer.files.length > 0) {
      handleFaceUpload(e.dataTransfer.files[0]);
    }
  });

  faceFileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFaceUpload(e.target.files[0]);
    }
  });

  async function handleFaceUpload(file) {
    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file (JPG, PNG, WEBP).");
      return;
    }

    statusBarText.textContent = "Analyzing face embedding on Vast.ai 2x RTX 5060 Ti...";
    statusBarText.style.color = "#60a5fa";

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/session/${token}/upload-face`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        faceImgPreview.src = data.preview_url;
        faceImgPreview.classList.remove("hidden");
        if (facePlaceholder) facePlaceholder.classList.add("hidden");
        statusBarText.textContent = "Face locked! Ready to swap.";
        statusBarText.style.color = "#34d399";
        faceLocked = true;
        document.querySelectorAll(".preset-item").forEach(i => i.classList.remove("active"));
      } else {
        statusBarText.textContent = "Error: " + data.error;
        statusBarText.style.color = "#f87171";
        alert("Face detection error: " + data.error);
      }
    } catch (err) {
      statusBarText.textContent = "Upload failed: " + err.message;
      statusBarText.style.color = "#f87171";
    }
  }

  // 2.1 Presets Gallery
  async function loadPresets() {
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (!data.presets || data.presets.length === 0) {
        presetBar.classList.add("hidden");
        return;
      }
      presetGallery.innerHTML = data.presets.map((p, idx) => `
        <div class="preset-item ${idx === 0 ? 'active' : ''}" data-id="${p.id}" title="${p.name}">
          <img src="${p.url}" alt="${p.name}">
        </div>
      `).join("");

      document.querySelectorAll(".preset-item").forEach(item => {
        item.addEventListener("click", () => selectPreset(item.dataset.id, item));
      });
    } catch (e) {
      console.warn("Presets could not be loaded:", e);
    }
  }
  loadPresets();

  async function selectPreset(presetId, el) {
    document.querySelectorAll(".preset-item").forEach(i => i.classList.remove("active"));
    if (el) el.classList.add("active");

    statusBarText.textContent = "Locking reference face on Cloud GPU...";
    try {
      const res = await fetch(`/api/session/${token}/select-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: presetId })
      });
      const data = await res.json();
      if (data.success) {
        faceImgPreview.src = data.preview_url;
        faceImgPreview.classList.remove("hidden");
        if (facePlaceholder) facePlaceholder.classList.add("hidden");
        statusBarText.textContent = `Reference face '${presetId}' locked.`;
        statusBarText.style.color = "#34d399";
        faceLocked = true;
      }
    } catch (err) {
      console.error(err);
    }
  }

  btnSelectTarget.addEventListener("click", () => {
    alert("In Live webcam mode, target is automatically captured in real-time from your laptop camera!");
  });

  btnSwapFaces.addEventListener("click", () => {
    faceFileInput.click();
  });

  // 3. Settings updates
  transparencySlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value) / 100;
    fetch(`/api/session/${token}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opacity: val })
    });
  });

  enhancerSelect.addEventListener("change", (e) => {
    fetch(`/api/session/${token}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enhancer: e.target.value })
    });
  });

  // 4. Session Countdown Timer
  function updateTimerUI(sec) {
    if (sec <= 0) {
      sessionTimerDisplay.textContent = "00:00";
      stopLive();
      window.location.reload();
      return;
    }
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    sessionTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  setInterval(async () => {
    if (!isStreaming && remainingSeconds <= 0) return;
    try {
      const res = await fetch(`/api/session/${token}/status`);
      const data = await res.json();
      if (!data.is_active) {
        window.location.reload();
        return;
      }
      remainingSeconds = data.remaining_seconds;
      updateTimerUI(remainingSeconds);
    } catch (e) {}
  }, 4000);

  setInterval(() => {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerUI(remainingSeconds);
    }
  }, 1000);

  // 5. START / STOP STREAMING (Both "Live" and "Start" buttons trigger live preview!)
  btnLive.addEventListener("click", toggleLive);
  btnStart.addEventListener("click", toggleLive);
  btnDestroy.addEventListener("click", stopLive);
  btnDestroyTop.addEventListener("click", stopLive);
  btnClosePreview.addEventListener("click", stopLive);

  function toggleLive() {
    if (isStreaming) {
      stopLive();
    } else {
      startLive();
    }
  }

  async function startLive() {
    const [width, height] = resSelect.value.split("x").map(Number);
    const deviceId = cameraSelect.value;

    const constraints = {
      video: {
        width: { ideal: width },
        height: { ideal: height },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      },
      audio: false
    };

    try {
      statusBarText.textContent = "Opening webcam & connecting to Vast.ai 2x RTX 5060 Ti...";
      statusBarText.style.color = "#38bdf8";

      // Show Live Preview Window (Image 1)
      livePreviewWindow.classList.remove("hidden");
      previewLoader.classList.remove("hidden");

      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideo.srcObject = localStream;
      await localVideo.play();

      captureCanvas.width = width;
      captureCanvas.height = height;
      liveCanvas.width = width;
      liveCanvas.height = height;

      startWebSocketStream();

      isStreaming = true;
      btnLive.textContent = "Stop";
      btnLive.style.background = "#dc2626";
      btnStart.textContent = "Stop";
      btnStart.style.background = "#dc2626";
      statusBarText.textContent = "Live Preview Active. 0% Lag Cloud Face Swapping.";
      statusBarText.style.color = "#34d399";
    } catch (err) {
      alert("Failed to start camera: " + err.message);
      statusBarText.textContent = "Camera access error: " + err.message;
      previewLoader.classList.add("hidden");
      livePreviewWindow.classList.add("hidden");
    }
  }

  function stopLive() {
    isStreaming = false;
    if (ws) {
      ws.close();
      ws = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    livePreviewWindow.classList.add("hidden");
    previewLoader.classList.add("hidden");
    btnLive.textContent = "Live";
    btnLive.style.background = "#1a73e8";
    btnStart.textContent = "Start";
    btnStart.style.background = "#1a73e8";
    statusBarText.textContent = "Live Preview stopped.";
    statusBarText.style.color = "#94a3b8";
    hudFps.textContent = "FPS: 0.0";
    pingBadge.textContent = "0ms latency";
  }

  // 6. Zero-Lag Real-Time Streaming Pipeline
  let inFlight = false;
  let lastSendTime = 0;

  function startWebSocketStream() {
    const loc = window.location;
    const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${loc.host}/ws/live/${token}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = "blob";

    ws.onopen = () => {
      previewLoader.classList.add("hidden");
      inFlight = false;
      sendCameraFrame();
    };

    ws.onmessage = (event) => {
      const now = performance.now();
      pingBadge.textContent = `${Math.round(now - lastSendTime)}ms latency`;
      inFlight = false;

      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "expired") {
            stopLive();
            window.location.reload();
          }
        } catch (e) {}
        return;
      }

      // Received swapped frame from 2x RTX 5090 GPU
      const blob = event.data;
      createImageBitmap(blob).then(bitmap => {
        canvasCtx.drawImage(bitmap, 0, 0, liveCanvas.width, liveCanvas.height);
        bitmap.close();

        frameCounter++;
        if (now - fpsTimer >= 1000) {
          hudFps.textContent = `FPS: ${(frameCounter * 1000 / (now - fpsTimer)).toFixed(1)}`;
          frameCounter = 0;
          fpsTimer = now;
        }

        // Send next instantaneous camera frame immediately (0% lag)
        if (isStreaming) {
          sendCameraFrame();
        }
      }).catch(err => {
        if (isStreaming) sendCameraFrame();
      });
    };

    ws.onclose = () => {
      if (isStreaming) {
        stopLive();
      }
    };
  }

  function sendCameraFrame() {
    if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (inFlight) return;

    captureCtx.drawImage(localVideo, 0, 0, captureCanvas.width, captureCanvas.height);
    inFlight = true;
    lastSendTime = performance.now();

    // Fast JPEG encode for minimal network latency
    captureCanvas.toBlob((blob) => {
      if (blob && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(blob);
      } else {
        inFlight = false;
      }
    }, "image/jpeg", 0.60);
  }

  // Safe timeout watchdog (checks every 200ms, only recovers if a frame packet was truly lost)
  setInterval(() => {
    if (isStreaming && ws && ws.readyState === WebSocket.OPEN && inFlight) {
      if (performance.now() - lastSendTime > 400) {
        inFlight = false;
        sendCameraFrame();
      }
    }
  }, 200);

  // 7. Popout Standalone "Live Preview" OS Window (Matches User Screenshot Exactly)
  function openSeparateLivePreview() {
    const popoutUrl = `/preview/${token}`;
    const popoutFeatures = "width=660,height=540,menubar=no,toolbar=no,location=no,status=no,resizable=yes";
    const popoutWin = window.open(popoutUrl, "Live Preview", popoutFeatures);
    if (popoutWin) {
      popoutWin.focus();
    }
  }

  btnPopout.addEventListener("click", openSeparateLivePreview);
  const btnOpenPopout = document.getElementById("btnOpenPopout");
  if (btnOpenPopout) {
    btnOpenPopout.addEventListener("click", openSeparateLivePreview);
  }

  btnMinPreview.addEventListener("click", () => {
    previewCanvasWrap.classList.toggle("hidden");
  });

  btnMaxPreview.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      livePreviewWindow.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
});
