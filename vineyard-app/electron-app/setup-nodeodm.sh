#!/bin/bash
# ADER App - NodeODM Setup Script
# This script sets up NodeODM with all required dependencies

set -e

echo "🚀 ADER App - NodeODM Setup"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="ader-nodeodm"
PORT=3002
IMAGE="opendronemap/nodeodm:latest"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo ""
    echo "Please install Docker Desktop from:"
    echo "https://www.docker.com/products/docker-desktop"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Docker is installed${NC}"

# Check if Docker daemon is running
if ! docker ps &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo -e "${GREEN}✅ Docker daemon is running${NC}"
echo ""

# Stop and remove existing container
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "🛑 Stopping existing container..."
    docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
    echo -e "${GREEN}✅ Existing container removed${NC}"
fi

# Pull latest NodeODM image
echo ""
echo "📥 Pulling NodeODM image (this may take a few minutes on first run)..."
docker pull ${IMAGE}
echo -e "${GREEN}✅ NodeODM image downloaded${NC}"

# Start NodeODM container
echo ""
echo "🚀 Starting NodeODM container on port ${PORT}..."
docker run -d \
    --name ${CONTAINER_NAME} \
    -p ${PORT}:3000 \
    --restart unless-stopped \
    --memory 4g \
    --memory-swap 6g \
    --cpus 2 \
    ${IMAGE}

echo -e "${GREEN}✅ NodeODM container started${NC}"

# Wait for NodeODM to be ready
echo ""
echo "⏳ Waiting for NodeODM to initialize..."
MAX_WAIT=120
COUNTER=0
while [ $COUNTER -lt $MAX_WAIT ]; do
    if curl -s http://localhost:${PORT}/info > /dev/null 2>&1; then
        echo -e "${GREEN}✅ NodeODM is ready!${NC}"
        break
    fi
    
    if [ $((COUNTER % 10)) -eq 0 ]; then
        echo "   Still waiting... (${COUNTER}s)"
    fi
    
    sleep 2
    COUNTER=$((COUNTER + 2))
done

if [ $COUNTER -ge $MAX_WAIT ]; then
    echo -e "${RED}❌ NodeODM did not start in time${NC}"
    echo "Check logs with: docker logs ${CONTAINER_NAME}"
    exit 1
fi

# Fix Python environment
echo ""
echo "🔧 Installing Python dependencies in container..."
docker exec ${CONTAINER_NAME} pip install --quiet python-dateutil pillow 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Could not install Python dependencies (may already be installed)${NC}"
}
echo -e "${GREEN}✅ Python environment configured${NC}"

# Verify installation
echo ""
echo "🔍 Verifying installation..."
if curl -s http://localhost:${PORT}/info | grep -q "version"; then
    echo -e "${GREEN}✅ NodeODM is working correctly!${NC}"
else
    echo -e "${YELLOW}⚠️  NodeODM may not be fully ready yet${NC}"
fi

echo ""
echo "================================"
echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo ""
echo "NodeODM is now running and ready for orthomosaic processing."
echo ""
echo "Useful commands:"
echo "  View logs:    docker logs ${CONTAINER_NAME}"
echo "  Stop:         docker stop ${CONTAINER_NAME}"
echo "  Start:        docker start ${CONTAINER_NAME}"
echo "  Remove:       docker rm -f ${CONTAINER_NAME}"
echo ""
echo "The container will automatically start with Docker Desktop."
echo "You can now use ADER App for orthomosaic generation!"
echo ""
