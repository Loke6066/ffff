import os
import sys
import time
import json
import asyncio
import traceback
from typing import Optional, Set, Any
import cv2
import numpy as np

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Ensure local imports work
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from session_manager import session_manager, Session
from cloud_engine import cloud_engine

# WebRTC aiortc import with safe fallback
AIORTC_AVAILABLE = False
try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
    from aiortc.contrib.media import MediaRelay
    from av import VideoFrame
    AIORTC_AVAILABLE = True
    print("[Server] aiortc available: WebRTC Zero-Lag Engine ENABLED.")
except ImportError:
    print("[Server] aiortc not installed. High-Speed WebSocket Zero-Lag Engine ACTIVE.")

app = FastAPI(title="Deep-Live-Cam Cloud Service", version="2.5.0")

# Enable CORS for cross-origin client access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
STATIC_DIR = os.path.join(CURRENT_DIR, "static")
TEMPLATES_DIR = os.path.join(CURRENT_DIR, "templates")
PRESETS_DIR = os.path.join(CURRENT_DIR, "media")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if os.path.exists(PRESETS_DIR):
    app.mount("/media", StaticFiles(directory=PRESETS_DIR), name="media")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Track active WebRTC peer connections
pcs: Set[Any] = set() if AIORTC_AVAILABLE else set()

@app.on_event("startup")
async def startup_event():
    # Warm up GPU engine in background thread so server boots instantly
    asyncio.get_event_loop().run_in_executor(None, cloud_engine.warmup)

@app.on_event("shutdown")
async def on_shutdown():
    if AIORTC_AVAILABLE:
        coros = [pc.close() for pc in pcs]
        await asyncio.gather(*coros)
        pcs.clear()

# ----------------- PRESETS & REFERENCE IMAGES -----------------

@app.get("/api/presets")
async def get_presets():
    presets = []
    preset_dir = os.path.join(CURRENT_DIR, "media", "presets")
    if os.path.exists(preset_dir):
        for f in sorted(os.listdir(preset_dir)):
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                name_clean = f.rsplit(".", 1)[0].replace("_", " ").title()
                presets.append({
                    "id": f,
                    "name": name_clean,
                    "url": f"/media/presets/{f}"
                })
    return {"presets": presets}

# ----------------- ADMIN ROUTES -----------------

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse(request=request, name="admin.html", context={"request": request})

@app.post("/api/admin/create-session")
async def create_session(request: Request):
    data = await request.json()
    duration_minutes = int(data.get("duration_minutes", 35))
    client_name = data.get("client_name", "Client")
    preset_id = data.get("preset_id")
    
    session = session_manager.create_session(duration_minutes=duration_minutes, client_name=client_name)
    
    if preset_id:
        preset_path = os.path.join(CURRENT_DIR, "media", "presets", preset_id)
        if os.path.exists(preset_path):
            try:
                with open(preset_path, "rb") as f:
                    contents = f.read()
                face, _, _ = cloud_engine.extract_face_from_bytes(contents)
                if face is not None:
                    session.source_face = face
                    session.source_image_bytes = contents
            except Exception as e:
                print(f"[Admin] Error pre-loading preset {preset_id}: {e}")

    host = request.headers.get("host", "localhost:8000")
    protocol = "https" if request.headers.get("x-forwarded-proto") == "https" else request.url.scheme
    client_link = f"{protocol}://{host}/session/{session.token}"
    
    return {
        "success": True,
        "token": session.token,
        "link": client_link,
        "session": session.to_dict()
    }

@app.get("/api/admin/sessions")
async def list_sessions():
    return {
        "success": True,
        "sessions": session_manager.list_sessions()
    }

@app.post("/api/admin/terminate-session")
async def terminate_session(request: Request):
    data = await request.json()
    token = data.get("token")
    success = session_manager.terminate_session(token)
    return {"success": success}

# ----------------- CLIENT ROUTES -----------------

@app.get("/session/{token}", response_class=HTMLResponse)
async def client_page(request: Request, token: str):
    session = session_manager.get_session(token)
    if not session or not session.is_active:
        return templates.TemplateResponse(request=request, name="expired.html", context={"request": request, "token": token})
    
    # Start timer countdown when client loads link
    session.start_session_timer()
    session.client_ip = request.client.host if request.client else "Unknown"

    return templates.TemplateResponse(request=request, name="client.html", context={
        "request": request,
        "token": token,
        "duration_minutes": session.duration_seconds // 60,
        "client_name": session.client_name,
        "webrtc_supported": AIORTC_AVAILABLE
    })

@app.get("/api/session/{token}/status")
async def session_status(token: str):
    session = session_manager.get_session(token)
    if not session:
        return {"active": False, "reason": "not_found"}
    return session.to_dict()

@app.post("/api/session/{token}/upload-face")
async def upload_face(token: str, file: UploadFile = File(...)):
    session = session_manager.get_session(token)
    if not session or not session.is_active:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    contents = await file.read()
    face, preview_url, err = cloud_engine.extract_face_from_bytes(contents)
    if err:
        return {"success": False, "error": err}

    session.source_face = face
    session.source_image_bytes = contents
    return {
        "success": True,
        "preview_url": preview_url,
        "message": "Face locked successfully! Ready for live swapping."
    }

@app.post("/api/session/{token}/select-preset")
async def select_preset(token: str, request: Request):
    session = session_manager.get_session(token)
    if not session or not session.is_active:
        raise HTTPException(status_code=403, detail="Session expired or invalid")

    data = await request.json()
    preset_id = data.get("preset_id")
    preset_path = os.path.join(CURRENT_DIR, "media", "presets", preset_id)
    if not os.path.exists(preset_path):
        raise HTTPException(status_code=404, detail="Preset image not found")

    with open(preset_path, "rb") as f:
        contents = f.read()

    face, preview_url, err = cloud_engine.extract_face_from_bytes(contents)
    if err:
        return {"success": False, "error": err}

    session.source_face = face
    session.source_image_bytes = contents
    return {
        "success": True,
        "preview_url": preview_url,
        "message": f"Reference face '{preset_id}' locked successfully!"
    }

@app.post("/api/session/{token}/settings")
async def update_settings(token: str, request: Request):
    session = session_manager.get_session(token)
    if not session or not session.is_active:
        raise HTTPException(status_code=403, detail="Session expired")
    data = await request.json()
    if "opacity" in data:
        session.opacity = float(data["opacity"])
    if "enhancer" in data:
        session.enhancer = str(data["enhancer"])
    return {"success": True}

# ----------------- ULTRA-LOW LATENCY WEBSOCKET STREAMING -----------------

@app.websocket("/ws/live/{token}")
async def websocket_live_stream(websocket: WebSocket, token: str):
    await websocket.accept()
    session = session_manager.get_session(token)
    if not session or not session.is_active:
        await websocket.send_text(json.dumps({"type": "error", "message": "Session expired or invalid"}))
        await websocket.close()
        return

    session.client_connected = True
    print(f"[WS] Client connected for session {token}")

    frame_count = 0
    t0 = time.time()

    try:
        while True:
            # Check session expiry
            if session.is_expired():
                await websocket.send_text(json.dumps({"type": "expired", "message": "Session time has ended"}))
                break

            # Receive binary frame from client webcam
            message = await websocket.receive()
            
            if "text" in message:
                try:
                    cmd = json.loads(message["text"])
                    if cmd.get("type") == "ping":
                        rem = session.get_remaining_seconds()
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "remaining_seconds": rem,
                            "fps": round(session.fps, 1)
                        }))
                        continue
                except Exception:
                    pass

            if "bytes" in message:
                frame_bytes = message["bytes"]
                if not frame_bytes:
                    continue

                # Fast decode directly from memory
                nparr = np.frombuffer(frame_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if img is not None:
                    # Run face swap asynchronously on Cloud GPU without blocking event loop
                    if session.source_face is not None:
                        swapped = await asyncio.to_thread(
                            cloud_engine.process_frame,
                            img,
                            session.source_face,
                            session.opacity,
                            session.enhancer,
                            token
                        )
                    else:
                        swapped = img

                    # Turbo-JPEG encode (quality 76 for instant network transport across internet)
                    _, encoded = cv2.imencode('.jpg', swapped, [int(cv2.IMWRITE_JPEG_QUALITY), 76])
                    
                    # Send swapped frame back to client browser instantly
                    await websocket.send_bytes(encoded.tobytes())

                    # Track FPS
                    frame_count += 1
                    session.total_frames_processed += 1
                    now = time.time()
                    if now - t0 >= 1.0:
                        session.fps = frame_count / (now - t0)
                        frame_count = 0
                        t0 = now

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected from session {token}")
    except Exception as e:
        print(f"[WS] Error in stream: {e}")
    finally:
        session.client_connected = False

# ----------------- WEBRTC ZERO-LAG PIPELINE (aiortc) -----------------

if AIORTC_AVAILABLE:
    class VideoSwapTrack(VideoStreamTrack):
        """
        WebRTC Video Track: Takes client webcam frames in real-time,
        runs RTX GPU Face Swapping, and streams back over WebRTC RTP.
        """
        def __init__(self, track, session: Session):
            super().__init__()
            self.track = track
            self.session = session
            self.frame_count = 0
            self.t0 = time.time()

        async def recv(self):
            frame = await self.track.recv()

            if self.session.is_expired():
                return frame

            # Convert WebRTC VideoFrame to OpenCV BGR numpy array
            img = frame.to_ndarray(format="bgr24")

            # Apply GPU Face Swap
            if self.session.source_face is not None:
                swapped = cloud_engine.process_frame(
                    frame=img,
                    source_face=self.session.source_face,
                    opacity=self.session.opacity,
                    enhancer_type=self.session.enhancer
                )
            else:
                swapped = img

            # FPS calculation
            self.frame_count += 1
            self.session.total_frames_processed += 1
            now = time.time()
            if now - self.t0 >= 1.0:
                self.session.fps = self.frame_count / (now - self.t0)
                self.frame_count = 0
                self.t0 = now

            # Convert back to VideoFrame
            new_frame = VideoFrame.from_ndarray(swapped, format="bgr24")
            new_frame.pts = frame.pts
            new_frame.time_base = frame.time_base
            return new_frame

    @app.post("/api/webrtc/offer/{token}")
    async def webrtc_offer(token: str, request: Request):
        session = session_manager.get_session(token)
        if not session or not session.is_active:
            raise HTTPException(status_code=403, detail="Session expired")

        params = await request.json()
        offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

        pc = RTCPeerConnection()
        pcs.add(pc)
        session.client_connected = True

        @pc.on("iceconnectionstatechange")
        async def on_ice():
            if pc.iceConnectionState in ["failed", "closed"]:
                await pc.close()
                pcs.discard(pc)
                session.client_connected = False

        @pc.on("track")
        def on_track(track):
            if track.kind == "video":
                pc.addTrack(VideoSwapTrack(track, session))

        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"\n========================================================")
    print(f"🚀 Deep-Live-Cam Cloud Service running on port {port}")
    print(f"👉 Admin Portal: http://localhost:{port}/admin")
    print(f"========================================================\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
