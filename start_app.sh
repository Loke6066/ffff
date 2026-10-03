#!/bin/bash
set -e

echo "=========================================================="
echo "⚡ Deep-Live-Cam Cloud: 100% GPU Zero-Lag Setup"
echo "=========================================================="

# 1. Clean up old processes
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 7860/tcp 2>/dev/null || true
pkill -f "python server.py" 2>/dev/null || true

# 2. Enter folder & clean fetch latest code
cd /workspace
if [ ! -d "ffff" ]; then
    git clone https://github.com/Loke6066/ffff.git
fi
cd /workspace/ffff
git fetch origin
git reset --hard origin/main

# 3. Setup virtual environment
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# 4. Install CUDA 12 GPU packages
echo "[1/3] Setting up CUDA 12 packages..."
pip install --upgrade pip
pip install --no-cache-dir nvidia-cuda-runtime-cu12 nvidia-cudnn-cu12 nvidia-cublas-cu12
pip uninstall -y onnxruntime 2>/dev/null || true
pip install --no-cache-dir onnxruntime-gpu --extra-index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/
pip install -r requirements-cloud.txt

# 5. Pre-download models if missing
mkdir -p models
if [ ! -f "models/inswapper_128_fp16.onnx" ]; then
    echo "Downloading inswapper_128_fp16.onnx..."
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128_fp16.onnx" -O models/inswapper_128_fp16.onnx
fi
if [ ! -f "models/inswapper_128.onnx" ]; then
    echo "Downloading inswapper_128.onnx..."
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128.onnx" -O models/inswapper_128.onnx
fi

# Pre-download buffalo_l
python3 -c "import insightface; app = insightface.app.FaceAnalysis(name='buffalo_l'); app.prepare(ctx_id=-1, det_size=(320, 320))" 2>/dev/null || true

# 6. Configure dynamic linker paths
NVIDIA_BASE=$(python3 -c "import site; print(site.getsitepackages()[0] + '/nvidia')")
TORCH_LIB=$(python3 -c "import torch, os; print(os.path.join(os.path.dirname(torch.__file__), 'lib'))")
export LD_LIBRARY_PATH="${TORCH_LIB}:${NVIDIA_BASE}/cudnn/lib:${NVIDIA_BASE}/cublas/lib:${NVIDIA_BASE}/cuda_runtime/lib:/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

# 7. Verify GPU acceleration
echo "[2/3] Verifying GPU..."
python3 -c "
import onnxruntime as ort
providers = ort.get_available_providers()
print('Providers:', providers)
if 'CUDAExecutionProvider' in providers:
    print('✅ SUCCESS: 100% GPU Acceleration is ACTIVE!')
else:
    print('⚠️ Running with server self-healing...')
"

# 8. Start server
echo "[3/3] Launching Zero-Lag Server on Port 8000..."
python server.py
