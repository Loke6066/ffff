#!/usr/bin/env bash
# ==============================================================================
# Deep-Live-Cam Cloud Deployment Script for Vast.ai (2x RTX 5060 Ti / CUDA 12.8)
# ==============================================================================
set -e

echo "================================================================="
echo "🚀 Initializing Deep-Live-Cam Cloud Service on 2x RTX 5060 Ti"
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
    git \
    psmisc

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
pkill -f "cloudflared tunnel" 2>/dev/null || true

# Start FastAPI server in background
python3 server.py > server.log 2>&1 &
SERVER_PID=$!

echo "Deep-Live-Cam server running (PID: $SERVER_PID)."
echo "Starting Cloudflare Tunnel to generate public HTTPS link..."

# Launch Cloudflare tunnel in background
cloudflared tunnel --url http://localhost:8000 --no-autoupdate > tunnel.log 2>&1 &
TUNNEL_PID=$!

echo "Waiting for Cloudflare HTTPS tunnel link to activate..."
PUBLIC_URL=""
for i in {1..35}; do
    PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9@:%._\+~#=]*\.trycloudflare\.com' tunnel.log | head -n 1 || true)
    if [ -n "$PUBLIC_URL" ]; then
        echo "$PUBLIC_URL" > URL.txt
        echo ""
        echo "================================================================="
        echo "🎉 YOUR DEEP-LIVE-CAM CLOUD SERVICE IS LIVE!"
        echo "================================================================="
        echo "👉 ADMIN DASHBOARD: $PUBLIC_URL/admin"
        echo ""
        echo "📌 Saved to URL.txt (Run: cat URL.txt anytime to see your link)"
        echo "================================================================="
        echo "Instructions:"
        echo "1. Open the Admin link above in your browser (Chrome/Edge)."
        echo "2. Select Duration (35 mins or 65 mins)."
        echo "3. Click 'Generate Client Link' and send the link to your client."
        echo "4. Client opens link, uploads/selects photo, and clicks 'Start Live'."
        echo "================================================================="
        echo ""
        break
    fi
    sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
    echo "⚠️ Cloudflare tunnel took longer to start. Check tunnel.log:"
    cat tunnel.log | tail -n 20
fi

# Keep script running and stream server log
tail -f server.log
