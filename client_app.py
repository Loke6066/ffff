#!/usr/bin/env python3
"""
==============================================================================
🚀 Deep-Live-Cam Cloud Native Desktop Client (0% Lag)
==============================================================================
Connects client laptop webcam to Cloud 2x RTX 5090 GPU and displays
output directly in a native OS window titled "Live Preview".
Optionally routes swapped video to Virtual Camera for Zoom / Teams / Meet.
==============================================================================
"""

import sys
import os
import argparse
import time
import asyncio
import threading
import cv2
import numpy as np

try:
    import websockets
except ImportError:
    print("Installing websockets...")
    os.system(f"{sys.executable} -m pip install websockets opencv-python")
    import websockets

try:
    import pyvirtualcam
    HAS_VIRTUAL_CAM = True
except ImportError:
    HAS_VIRTUAL_CAM = False

class ClientStreamingEngine:
    def __init__(self, server_url: str, token: str, cam_id: int = 0, width: int = 640, height: int = 480, virtual_cam: bool = False):
        # Format websocket URL
        clean_url = server_url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")
        if "/ws/live/" in clean_url:
            self.ws_url = clean_url
        else:
            self.ws_url = f"{clean_url}/ws/live/{token}"

        self.cam_id = cam_id
        self.width = width
        self.height = height
        self.use_virtual_cam = virtual_cam and HAS_VIRTUAL_CAM

        self.running = True
        self.raw_frame = None
        self.processed_frame = None
        self.fps = 0.0
        self.latency_ms = 0.0
        self.in_flight = False
        self.last_send_time = 0

    def camera_loop(self):
        """Grabs frames from webcam with zero driver buffer."""
        cap = cv2.VideoCapture(self.cam_id, cv2.CAP_DSHOW if sys.platform == 'win32' else cv2.CAP_ANY)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        while self.running:
            ret, frame = cap.read()
            if ret:
                self.raw_frame = frame
            else:
                time.sleep(0.01)
        cap.release()

    async def network_loop(self):
        """Ultra-low latency request-response streaming loop."""
        print(f"🔌 Connecting to Cloud GPU: {self.ws_url}...")
        while self.running:
            try:
                async with websockets.connect(self.ws_url, max_size=None, ping_interval=20, ping_timeout=10) as ws:
                    print("✅ Connected to 2x RTX 5090 Cloud Engine! Zero-lag streaming active.")
                    self.in_flight = False

                    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 55]

                    while self.running:
                        # Only send if previous frame completed (zero queue buffer)
                        if not self.in_flight and self.raw_frame is not None:
                            _, buffer = cv2.imencode('.jpg', self.raw_frame, encode_param)
                            self.in_flight = True
                            self.last_send_time = time.perf_counter()
                            await ws.send(buffer.tobytes())

                        # Wait for processed swapped frame with short timeout
                        try:
                            data = await asyncio.wait_for(ws.recv(), timeout=0.15)
                            self.latency_ms = (time.perf_counter() - self.last_send_time) * 1000
                            self.in_flight = False

                            if isinstance(data, bytes):
                                np_arr = np.frombuffer(data, np.uint8)
                                decoded = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                                if decoded is not None:
                                    self.processed_frame = decoded
                        except asyncio.TimeoutError:
                            # If server or network delayed, reset in_flight so next fresh frame is sent
                            self.in_flight = False

                        await asyncio.sleep(0.005)

            except Exception as e:
                print(f"⚠️ Network error: {e}. Reconnecting in 2 seconds...")
                self.in_flight = False
                await asyncio.sleep(2.0)

    def display_loop(self):
        """Displays output in native OS window titled 'Live Preview'."""
        window_title = "Live Preview"
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, self.width, self.height)

        frame_count = 0
        t0 = time.time()

        while self.running:
            display_frame = self.processed_frame if self.processed_frame is not None else self.raw_frame

            if display_frame is not None:
                frame_count += 1
                now = time.time()
                if now - t0 >= 1.0:
                    self.fps = frame_count / (now - t0)
                    frame_count = 0
                    t0 = now

                # Draw minimal HUD in top-left
                hud_text = f"RTX 5090 | {self.fps:.1f} FPS | {self.latency_ms:.0f}ms"
                view = display_frame.copy()
                cv2.putText(view, hud_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
                cv2.putText(view, hud_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 128), 1, cv2.LINE_AA)

                cv2.imshow(window_title, view)

            key = cv2.waitKey(1) & 0xFF
            if key == 27 or key == ord('q'): # ESC or Q to quit
                self.running = False
                break

            # If user closes window via X button
            if cv2.getWindowProperty(window_title, cv2.WND_PROP_VISIBLE) < 1:
                self.running = False
                break

        cv2.destroyAllWindows()

    def virtual_cam_loop(self):
        """Optional virtual camera output for Zoom/Meet."""
        if not self.use_virtual_cam:
            return
        print(f"🎥 Virtual Camera starting at {self.width}x{self.height}...")
        try:
            with pyvirtualcam.Camera(width=self.width, height=self.height, fps=30) as cam:
                while self.running:
                    frame = self.processed_frame if self.processed_frame is not None else self.raw_frame
                    if frame is not None:
                        cam.send(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    cam.sleep_until_next_frame()
        except Exception as e:
            print(f"⚠️ Virtual camera error: {e}")

    def run(self):
        t_cam = threading.Thread(target=self.camera_loop, daemon=True)
        t_display = threading.Thread(target=self.display_loop, daemon=False)
        t_vcam = threading.Thread(target=self.virtual_cam_loop, daemon=True) if self.use_virtual_cam else None

        t_cam.start()
        if t_vcam:
            t_vcam.start()

        def async_worker():
            asyncio.run(self.network_loop())

        t_net = threading.Thread(target=async_worker, daemon=True)
        t_net.start()

        # Display loop runs on main thread for OpenCV GUI compatibility
        self.display_loop()
        self.running = False
        print("Application closed.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deep-Live-Cam Cloud Native Desktop Client")
    parser.add_argument("--server", type=str, default="https://best-nobody-lending-eye.trycloudflare.com", help="Cloud server URL")
    parser.add_argument("--token", type=str, required=True, help="Session token from Admin link")
    parser.add_argument("--cam", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--vcam", action="store_true", help="Enable Virtual Camera for Zoom/Meet")
    args = parser.parse_args()

    client = ClientStreamingEngine(
        server_url=args.server,
        token=args.token,
        cam_id=args.cam,
        virtual_cam=args.vcam
    )
    client.run()
