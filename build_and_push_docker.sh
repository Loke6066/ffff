#!/bin/bash
set -e
echo "========================================================="
echo " Build and Push Face Swap Docker Image to Docker Hub"
echo "========================================================="
read -p "Enter your Docker Hub username: " DOCKER_USER
IMAGE_NAME="${DOCKER_USER}/deep-live-cam-runpod:latest"

echo ""
echo "[1/3] Logging into Docker Hub..."
docker login

echo ""
echo "[2/3] Building Docker image ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" -f Dockerfile .

echo ""
echo "[3/3] Pushing to Docker Hub..."
docker push "${IMAGE_NAME}"

echo ""
echo "========================================================="
echo "SUCCESS! Image pushed to: ${IMAGE_NAME}"
echo "Use this image in RunPod Serverless or Pod Image!"
echo "========================================================="
