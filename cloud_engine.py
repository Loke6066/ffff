import os
import sys
import time
import base64
import threading
from typing import Optional, Tuple, Any
import cv2
import numpy as np

# Ensure project root is in sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import modules.globals
from modules.face_analyser import get_face_analyser, get_one_face
from modules.processors.frame.face_swapper import get_face_swapper, swap_face
from modules.model_downloader import ensure_model, ensure_insightface_pack

class CloudSwapEngine:
    def __init__(self):
        self.initialized = False
        self.lock = threading.Lock()
        self.analyser = None
        self.swapper = None
        self.enhancers = {}

    def warmup(self, use_cuda: bool = True):
        """Pre-downloads models and warms up ONNX Runtime CUDA provider."""
        with self.lock:
            if self.initialized:
                return

            print("[Engine] Initializing CloudSwapEngine with GPU acceleration...")
            
            # Setup execution providers
            if use_cuda:
                modules.globals.execution_providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
            else:
                modules.globals.execution_providers = ['CPUExecutionProvider']

            modules.globals.det_size = 640
            modules.globals.face_swapper_enabled = True
            modules.globals.many_faces = False
            modules.globals.mouth_mask = False
            modules.globals.opacity = 1.0

            # Ensure models downloaded
            print("[Engine] Checking / downloading models...")
            ensure_insightface_pack('buffalo_l')
            ensure_model('inswapper_128.onnx')

            # Initialize InsightFace analyser & swapper
            print("[Engine] Preloading face analyser and swapper models into VRAM...")
            self.analyser = get_face_analyser()
            self.swapper = get_face_swapper()

            # Warm-up run with synthetic dummy frame to remove first-frame jitter
            print("[Engine] Running CUDA warm-up inference...")
            try:
                dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.circle(dummy_frame, (320, 240), 100, (200, 200, 200), -1)
                _ = get_one_face(dummy_frame)
            except Exception as e:
                print(f"[Engine] Warmup warning: {e}")

            self.initialized = True
            print("[Engine] CloudSwapEngine is READY! High-performance real-time pipeline active.")

    def extract_face_from_bytes(self, image_bytes: bytes) -> Tuple[Optional[Any], Optional[str], Optional[str]]:
        """
        Extracts face embedding from uploaded client image.
        Returns: (face_object, cropped_face_base64_data_url, error_message)
        """
        if not self.initialized:
            self.warmup()

        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None, None, "Invalid image format"

            face = get_one_face(img)
            if face is None:
                return None, None, "No face detected in the uploaded photo. Please try a clearer front-facing portrait."

            # Crop face bounding box for preview
            bbox = face.bbox.astype(int)
            h, w = img.shape[:2]
            x1 = max(0, bbox[0] - 20)
            y1 = max(0, bbox[1] - 20)
            x2 = min(w, bbox[2] + 20)
            y2 = min(h, bbox[3] + 20)
            crop = img[y1:y2, x1:x2]

            # Encode preview
            _, buffer = cv2.imencode('.jpg', crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            b64 = base64.b64encode(buffer).decode('utf-8')
            preview_url = f"data:image/jpeg;base64,{b64}"

            return face, preview_url, None
        except Exception as e:
            return None, None, f"Error analyzing face: {str(e)}"

    def process_frame(
        self,
        frame: np.ndarray,
        source_face: Any,
        opacity: float = 1.0,
        enhancer_type: str = "none"
    ) -> np.ndarray:
        """
        Processes a single camera frame with RTX GPU inference.
        Returns swapped frame in BGR format.
        """
        if not self.initialized:
            self.warmup()

        if source_face is None or frame is None:
            return frame

        # Set runtime opacity
        modules.globals.opacity = opacity

        try:
            # Detect target face on camera frame
            target_face = get_one_face(frame)
            if target_face is None:
                return frame

            # Perform high-speed CUDA face swap
            swapped = swap_face(source_face, target_face, frame)

            # Optional face enhancer
            if enhancer_type == "face_enhancer_gpen256":
                from modules.processors.frame.face_enhancer_gpen256 import process_frame as gpen256_process
                swapped = gpen256_process(source_face, swapped, [target_face])
            elif enhancer_type == "face_enhancer_gpen512":
                from modules.processors.frame.face_enhancer_gpen512 import process_frame as gpen512_process
                swapped = gpen512_process(source_face, swapped, [target_face])

            return swapped
        except Exception as e:
            # Fallback to original frame on error to prevent streaming disruption
            return frame

cloud_engine = CloudSwapEngine()
