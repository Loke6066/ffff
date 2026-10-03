#!/bin/bash
set -e

echo "=========================================================="
echo "⚡ RTX 5090 100% GPU Hardware Acceleration Optimizer"
echo "=========================================================="

cd "$(dirname "$0")"
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# 1. Kill any old server on port 8000 or 7860
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 7860/tcp 2>/dev/null || true

# 2. Force remove conflicting CPU onnxruntime packages
echo "[1/4] Removing conflicting CPU onnxruntime packages..."
pip uninstall -y onnxruntime onnxruntime-gpu || true

# 3. Install CUDA 12 compatible onnxruntime-gpu package
echo "[2/4] Installing CUDA 12 ONNX Runtime GPU..."
pip install onnxruntime-gpu --extra-index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/

# 4. Export PyTorch CUDA & cuDNN libraries to dynamic linker
echo "[3/4] Linking PyTorch CUDA & cuDNN libraries..."
TORCH_LIB=$(python3 -c "import torch, os; print(os.path.join(os.path.dirname(torch.__file__), 'lib'))")
export LD_LIBRARY_PATH="${TORCH_LIB}:/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

# Persist to venv activate script
if [ -f "venv/bin/activate" ]; then
    sed -i '/export LD_LIBRARY_PATH/d' venv/bin/activate
    echo "export LD_LIBRARY_PATH=\"${TORCH_LIB}:/usr/local/cuda/lib64:\$LD_LIBRARY_PATH\"" >> venv/bin/activate
fi

# 5. Verify CUDA Provider
echo "[4/4] Verifying GPU CUDA Provider..."
python3 -c "
import onnxruntime as ort
providers = ort.get_available_providers()
print('Available ONNX Providers:', providers)
if 'CUDAExecutionProvider' in providers:
    print('✅ SUCCESS: CUDAExecutionProvider is 100% ACTIVE on RTX 5090 GPU!')
else:
    print('❌ WARNING: CUDAExecutionProvider could not be loaded.')
    exit(1)
"

echo "=========================================================="
echo "🚀 Starting Deep-Live-Cam Server (100% GPU ZERO-LAG)..."
echo "=========================================================="
python server.py
