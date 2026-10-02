FROM runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install OS libraries for OpenCV & media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install Python requirements
COPY requirements-cloud.txt /app/requirements-cloud.txt
RUN pip install --no-cache-dir -r requirements-cloud.txt
RUN pip install --no-cache-dir runpod

# Copy application source code
COPY . /app

# Pre-download models so worker container boots instantly with zero download lag
RUN mkdir -p /app/models && \
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128_fp16.onnx" -O /app/models/inswapper_128_fp16.onnx && \
    wget -c "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128.onnx" -O /app/models/inswapper_128.onnx

# Pre-download buffalo_l insightface models to ~/.insightface/models/
RUN python3 -c "import insightface; app = insightface.app.FaceAnalysis(name='buffalo_l'); app.prepare(ctx_id=-1, det_size=(320, 320))"

# Expose Web port 7860
EXPOSE 7860

# Default entrypoint for RunPod Serverless
CMD ["python3", "-u", "/app/serverless_handler.py"]
