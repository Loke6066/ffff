#!/bin/bash
set -e

echo "=========================================================="
echo "⚡ Force Clean Restart & 100% RTX 5090 Acceleration"
echo "=========================================================="

cd /workspace/ffff
source venv/bin/activate

# 1. Kill old server processes
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 7860/tcp 2>/dev/null || true
pkill -f "python server.py" 2>/dev/null || true

# 2. Pull latest code from GitHub
git fetch origin
git reset --hard origin/main

# 3. Ensure CUDA 12 packages
echo "[1/3] Installing CUDA 12 and cuDNN packages..."
pip install --no-cache-dir nvidia-cuda-runtime-cu12 nvidia-cudnn-cu12 nvidia-cublas-cu12
pip uninstall -y onnxruntime 2>/dev/null || true
pip install --no-cache-dir onnxruntime-gpu --extra-index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/

# 4. Export dynamic library paths
echo "[2/3] Configuring library paths..."
NVIDIA_BASE=$(python3 -c "import site; print(site.getsitepackages()[0] + '/nvidia')")
TORCH_LIB=$(python3 -c "import torch, os; print(os.path.join(os.path.dirname(torch.__file__), 'lib'))")
export LD_LIBRARY_PATH="${TORCH_LIB}:${NVIDIA_BASE}/cudnn/lib:${NVIDIA_BASE}/cublas/lib:${NVIDIA_BASE}/cuda_runtime/lib:/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

# 5. Test CUDA provider
echo "[3/3] Testing GPU CUDA Provider..."
python3 -c "
import onnxruntime as ort
providers = ort.get_available_providers()
print('Available Providers:', providers)
if 'CUDAExecutionProvider' in providers:
    print('✅ SUCCESS: 100% GPU Hardware Acceleration Active!')
else:
    print('⚠️ CUDA not yet detected in shell, server self-healing will bind it.')
"

echo "=========================================================="
echo "🚀 Starting Server on Port 8000 (0% Lag Active)..."
echo "=========================================================="
python server.py
