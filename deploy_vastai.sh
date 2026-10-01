#!/usr/bin/env bash
# ==============================================================================
# Deep-Live-Cam Cloud Deployment Script for Vast.ai (RTX 5070 Ti / 5060)
# ==============================================================================
set -e

echo "================================================================="
echo "🚀 Initializing Deep-Live-Cam Cloud Service on RTX 5070 Ti / 5060"
echo "================================================================="

# 1. Update OS and install essential Linux dependencies
echo "[1/6] Installing OS packages..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    curl \
    wget \
    git

# 2. Setup Python environment
echo "[2/6] Setting up Python virtual environment..."
cd "$(dirname "$0")"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

pip install --upgrade pip setuptools wheel

# 3. Install PyTorch with CUDA 12.4 support (Optimized for RTX 50-series)
echo "[3/6] Installing PyTorch with CUDA support..."
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# 4. Install Cloud Dependencies & ONNX Runtime GPU
echo "[4/6] Installing Deep-Live-Cam Cloud dependencies..."
pip install -r requirements-cloud.txt

# 5. Pre-download AI Models to models directory
echo "[5/6] Pre-downloading InsightFace buffalo_l and inswapper ONNX models..."
mkdir -p models
if [ ! -f "models/inswapper_128.onnx" ]; then
    echo "Downloading inswapper_128.onnx (~528 MB)..."
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128.onnx" -O models/inswapper_128.onnx
fi

if [ ! -f "models/inswapper_128_fp16.onnx" ]; then
    echo "Downloading inswapper_128_fp16.onnx (~264 MB)..."
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128_fp16.onnx" -O models/inswapper_128_fp16.onnx
fi

# Pre-download buffalo_l models
python3 -c "
import insightface
from modules.model_downloader import ensure_insightface_pack
ensure_insightface_pack('buffalo_l')
print('Models preloaded successfully!')
"

# 6. Install Cloudflare Tunnel for Free Public HTTPS (Required for WebCam in Chrome)
echo "[6/6] Setting up Cloudflare Tunnel (Free HTTPS for Webcam access)..."
if ! command -v cloudflared &> /dev/null; then
    curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb || apt-get install -f -y
    rm -f /tmp/cloudflared.deb
fi

echo "================================================================="
echo "✅ Setup Complete! Starting Deep-Live-Cam Server & Cloud Tunnel..."
echo "================================================================="

# Kill any existing server on port 8000
fuser -k 8000/tcp 2>/dev/null || true

# Start FastAPI server in background
python3 server.py > server.log 2>&1 &
SERVER_PID=$!

echo "Deep-Live-Cam server running (PID: $SERVER_PID)."
echo "Starting Cloudflare Tunnel to generate public HTTPS link..."

# Launch Cloudflare tunnel and output the public URL
cloudflared tunnel --url http://localhost:8000 2>&1 | tee tunnel.log | grep -E --line-buffered "https://.*\.trycloudflare\.com" | while read -r line; do
    URL=$(echo "$line" | grep -o 'https://[^ ]*\.trycloudflare\.com')
    if [ ! -z "$URL" ]; then
        echo ""
        echo "================================================================="
        echo "🎉 YOUR DEEP-LIVE-CAM CLOUD SERVICE IS LIVE!"
        echo "================================================================="
        echo "👉 ADMIN DASHBOARD: $URL/admin"
        echo "Open this Admin link in your browser to generate 35m / 65m links!"
        echo "================================================================="
        echo ""
    fi
done

wait $SERVER_PID
