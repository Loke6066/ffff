// Client Live Studio Engine
document.addEventListener("DOMContentLoaded", () => {
  const token = window.SESSION_TOKEN;
  const initialDuration = window.SESSION_DURATION;

  // DOM Elements
  const sessionTimerDisplay = document.getElementById("sessionTimerDisplay");
  const timerBarFill = document.getElementById("timerBarFill");
  const faceDropZone = document.getElementById("faceDropZone");
  const faceFileInput = document.getElementById("faceFileInput");
  const btnSelectFace = document.getElementById("btnSelectFace");
  const facePreviewContainer = document.getElementById("facePreviewContainer");
  const faceStatus = document.getElementById("faceStatus");
  const cameraSelect = document.getElementById("cameraSelect");
  const resSelect = document.getElementById("resSelect");
  const enhancerSelect = document.getElementById("enhancerSelect");
  const opacitySlider = document.getElementById("opacitySlider");
  const opacityVal = document.getElementById("opacityVal");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const liveCanvas = document.getElementById("liveCanvas");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  const previewOverlay = document.getElementById("previewOverlay");
  const hudFps = document.getElementById("hudFps");
  const hudLatency = document.getElementById("hudLatency");
  const connectionStatus = document.getElementById("connectionStatus");
  const btnFullscreen = document.getElementById("btnFullscreen");
  const btnPip = document.getElementById("btnPip");

  const canvasCtx = liveCanvas.getContext("2d");

  let localStream = null;
  let isStreaming = false;
  let ws = null;
  let peerConnection = null;
  let pendingFrame = false;
  let frameCounter = 0;
  let fpsTimer = performance.now();
  let remainingSeconds = initialDuration * 60;
  let faceLocked = false;

  // Off-screen canvas for frame capture
  const captureCanvas = document.createElement("canvas");
  const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

  // 1. Initial Device Detection
  async function initCameras() {
    try {
      // First ask for camera permission
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      
      cameraSelect.innerHTML = "";
      if (videoDevices.length === 0) {
        cameraSelect.innerHTML = `<option value="">No camera detected</option>`;
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
  faceDropZone.addEventListener("click", (e) => {
    if (e.target !== btnSelectFace) faceFileInput.click();
  });

  faceDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    faceDropZone.style.borderColor = "var(--primary)";
  });

  faceDropZone.addEventListener("dragleave", () => {
    faceDropZone.style.borderColor = "var(--border)";
  });

  faceDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    faceDropZone.style.borderColor = "var(--border)";
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

    faceStatus.textContent = "⏳ Analyzing face in cloud GPU...";
    faceStatus.style.color = "#60a5fa";

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/session/${token}/upload-face`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        facePreviewContainer.innerHTML = `<img src="${data.preview_url}" alt="Target Face" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
        faceStatus.textContent = "✅ Face Locked! Ready to Stream.";
        faceStatus.style.color = "#34d399";
        faceLocked = true;
        document.querySelectorAll(".preset-item").forEach(i => i.classList.remove("active"));
      } else {
        faceStatus.textContent = "❌ " + data.error;
        faceStatus.style.color = "#f87171";
      }
    } catch (err) {
      faceStatus.textContent = "❌ Upload failed: " + err.message;
      faceStatus.style.color = "#f87171";
    }
  }

  // 2.1 Preset & Reference Faces
  const presetGallery = document.getElementById("presetGallery");
  async function loadPresets() {
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (!data.presets || data.presets.length === 0) {
        if (presetGallery && presetGallery.parentElement) {
          presetGallery.parentElement.style.display = "none";
        }
        return;
      }
      presetGallery.innerHTML = data.presets.map(p => `
        <div class="preset-item" data-id="${p.id}" title="${p.name}">
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

    faceStatus.textContent = "⏳ Locking reference face in cloud GPU...";
    faceStatus.style.color = "#60a5fa";

    try {
      const res = await fetch(`/api/session/${token}/select-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: presetId })
      });
      const data = await res.json();
      if (data.success) {
        facePreviewContainer.innerHTML = `<img src="${data.preview_url}" alt="Target Face" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
        faceStatus.textContent = "✅ Face Locked! Ready to Stream.";
        faceStatus.style.color = "#34d399";
        faceLocked = true;
      } else {
        faceStatus.textContent = "❌ " + (data.error || "Failed to lock face");
        faceStatus.style.color = "#f87171";
      }
    } catch (err) {
      faceStatus.textContent = "❌ Error: " + err.message;
      faceStatus.style.color = "#f87171";
    }
  }

  // 3. Settings updates
  opacitySlider.addEventListener("input", (e) => {
    const val = e.target.value;
    opacityVal.textContent = val + "%";
    fetch(`/api/session/${token}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opacity: parseFloat(val) / 100 })
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
      timerBarFill.style.width = "0%";
      stopLive();
      window.location.reload();
      return;
    }
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    sessionTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const pct = Math.max(0, Math.min(100, (sec / (initialDuration * 60)) * 100));
    timerBarFill.style.width = pct + "%";
  }

  // Poll server for exact session sync
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

  // Local 1s decrement for smooth UI
  setInterval(() => {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerUI(remainingSeconds);
    }
  }, 1000);

  // 5. START / STOP STREAMING
  btnStart.addEventListener("click", startLive);
  btnStop.addEventListener("click", stopLive);

  async function startLive() {
    if (!faceLocked) {
      if (!confirm("No face photo uploaded yet. Cloud stream will run with original webcam feed until you select a face. Continue?")) {
        return;
      }
    }

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
      connectionStatus.textContent = "● Connecting to Cloud RTX 5070 Ti...";
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideo.srcObject = localStream;
      await localVideo.play();

      captureCanvas.width = width;
      captureCanvas.height = height;
      liveCanvas.width = width;
      liveCanvas.height = height;

      const protocol = document.querySelector('input[name="protocol"]:checked')?.value || "ws";

      if (protocol === "webrtc" && window.RTCPeerConnection) {
        await startWebRTCStream();
      } else {
        startWebSocketStream();
      }

      previewOverlay.classList.add("hidden");
      btnStart.classList.add("hidden");
      btnStop.classList.remove("hidden");
      isStreaming = true;
    } catch (err) {
      alert("Failed to start camera: " + err.message);
      connectionStatus.textContent = "● Camera access failed";
    }
  }

  function stopLive() {
    isStreaming = false;
    if (ws) {
      ws.close();
      ws = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    remoteVideo.classList.add("hidden");
    liveCanvas.classList.remove("hidden");
    previewOverlay.classList.remove("hidden");
    btnStart.classList.remove("hidden");
    btnStop.classList.add("hidden");
    connectionStatus.textContent = "● Stopped";
    hudFps.textContent = "FPS: 0.0";
    hudLatency.textContent = "Ping: 0ms";
  }

  // 6. Ultra-Fast WebSocket Pipeline (Zero Buffer Accumulation)
  function startWebSocketStream() {
    const loc = window.location;
    const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${loc.host}/ws/live/${token}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = "blob";

    ws.onopen = () => {
      connectionStatus.textContent = "● Live Stream Active (Ultra-Fast 0% Lag Mode)";
      connectionStatus.style.color = "#34d399";
      scheduleNextFrame();
    };

    ws.onmessage = (event) => {
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

      // Received processed frame blob from server
      const blob = event.data;
      createImageBitmap(blob).then(bitmap => {
        canvasCtx.drawImage(bitmap, 0, 0, liveCanvas.width, liveCanvas.height);
        bitmap.close();

        // Calculate FPS
        frameCounter++;
        const now = performance.now();
        if (now - fpsTimer >= 1000) {
          hudFps.textContent = `FPS: ${(frameCounter * 1000 / (now - fpsTimer)).toFixed(1)}`;
          frameCounter = 0;
          fpsTimer = now;
        }

        pendingFrame = false;
        if (isStreaming) {
          scheduleNextFrame();
        }
      }).catch(err => {
        pendingFrame = false;
      });
    };

    ws.onclose = () => {
      connectionStatus.textContent = "● Disconnected";
      connectionStatus.style.color = "var(--text-muted)";
    };
  }

  function scheduleNextFrame() {
    if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (pendingFrame) return; // Drop frame to prevent queue lag

    requestAnimationFrame(sendCameraFrame);
  }

  function sendCameraFrame() {
    if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN || pendingFrame) return;

    captureCtx.drawImage(localVideo, 0, 0, captureCanvas.width, captureCanvas.height);

    // Fast JPEG encoding (quality 0.82 for speed & sharpness)
    captureCanvas.toBlob((blob) => {
      if (blob && ws && ws.readyState === WebSocket.OPEN && !pendingFrame) {
        pendingFrame = true;
        const sendTime = performance.now();
        ws.send(blob);

        // Ping ping check
        hudLatency.textContent = `Ping: ${(performance.now() - sendTime).toFixed(0)}ms`;
      }
    }, "image/jpeg", 0.82);
  }

  // 7. WebRTC Pipeline (aiortc fallback)
  async function startWebRTCStream() {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.classList.remove("hidden");
      liveCanvas.classList.add("hidden");
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const res = await fetch(`/api/webrtc/offer/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: peerConnection.localDescription.sdp, type: peerConnection.localDescription.type })
    });

    const answer = await res.json();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    connectionStatus.textContent = "● Live Stream Active (WebRTC P2P Mode)";
    connectionStatus.style.color = "#34d399";
  }

  // 8. Fullscreen & PiP
  btnFullscreen.addEventListener("click", () => {
    const el = document.getElementById("previewContainer");
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(err => alert("Fullscreen error: " + err.message));
    } else {
      document.exitFullscreen();
    }
  });

  btnPip.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        // Use a dummy video stream from the canvas
        const canvasStream = liveCanvas.captureStream(30);
        localVideo.srcObject = canvasStream;
        await localVideo.play();
        await localVideo.requestPictureInPicture();
      }
    } catch (err) {
      alert("PiP not supported or disabled on this browser.");
    }
  });
});
