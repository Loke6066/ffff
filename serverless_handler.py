import os
import sys
import time
import base64
import cv2
import numpy as np
import runpod

# Ensure project root in sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from cloud_engine import cloud_engine

# Initialize and warm up engine on GPU during container startup
print("[Serverless] Initializing models in GPU memory...")
cloud_engine.warmup(use_cuda=True)
print("[Serverless] Models warmed up and ready in VRAM!")

# In-memory cache for reference face embeddings to avoid re-extracting per frame
face_cache = {}

def handler(job):
    """
    RunPod Serverless Job Handler
    Job Input schema:
    {
        "frame": "<base64_encoded_frame>",
        "source_image": "<optional_base64_source_face>",
        "preset_id": "<optional_preset_id>",
        "session_id": "<session_token>",
        "opacity": 1.0,
        "enhancer": "none"
    }
    """
    start_t = time.time()
    job_input = job.get("input", {})

    frame_b64 = job_input.get("frame")
    if not frame_b64:
        return {"error": "Missing 'frame' in job input", "status": "failed"}

    # Handle data URL prefix
    if "," in frame_b64:
        frame_b64 = frame_b64.split(",", 1)[1]

    frame_bytes = base64.b64decode(frame_b64)
    frame_arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    frame = cv2.imdecode(frame_arr, cv2.IMREAD_COLOR)

    if frame is None:
        return {"error": "Failed to decode input frame", "status": "failed"}

    session_id = job_input.get("session_id", "default")
    source_face = face_cache.get(session_id)

    # If source image provided or session not in cache, extract face
    if "source_image" in job_input and job_input["source_image"]:
        src_b64 = job_input["source_image"]
        if "," in src_b64:
            src_b64 = src_b64.split(",", 1)[1]
        src_bytes = base64.b64decode(src_b64)
        face_obj, _, err = cloud_engine.extract_face_from_bytes(src_bytes)
        if face_obj:
            face_cache[session_id] = face_obj
            source_face = face_obj
        elif err:
            return {"error": err, "status": "failed"}
    elif "preset_id" in job_input and not source_face:
        preset_file = os.path.join(CURRENT_DIR, "media", "presets", job_input["preset_id"])
        if os.path.exists(preset_file):
            with open(preset_file, "rb") as f:
                face_obj, _, _ = cloud_engine.extract_face_from_bytes(f.read())
                if face_obj:
                    face_cache[session_id] = face_obj
                    source_face = face_obj

    if source_face is None:
        return {"error": "No source face set. Please provide 'source_image' or 'preset_id'.", "status": "failed"}

    opacity = float(job_input.get("opacity", 1.0))
    enhancer = job_input.get("enhancer", "none")

    # Swap face
    swapped_frame, fps = cloud_engine.process_frame(
        frame=frame,
        source_face=source_face,
        enhancer=enhancer,
        opacity=opacity,
        session_id=session_id
    )

    # Encode to JPEG
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 85]
    _, buffer = cv2.imencode(".jpg", swapped_frame, encode_params)
    out_b64 = base64.b64encode(buffer).decode("ascii")

    elapsed_ms = round((time.time() - start_t) * 1000, 2)
    return {
        "status": "success",
        "image": f"data:image/jpeg;base64,{out_b64}",
        "latency_ms": elapsed_ms,
        "fps": round(fps, 1)
    }

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
