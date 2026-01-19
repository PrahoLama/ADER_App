@echo off
REM ADER App - NodeODM Setup Script for Windows
REM This script sets up NodeODM with all required dependencies

echo ========================================
echo ADER App - NodeODM Setup
echo ========================================
echo.

REM Configuration
set CONTAINER_NAME=ader-nodeodm
set PORT=3002
set IMAGE=opendronemap/nodeodm:latest

REM Check if Docker is installed
docker --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not installed
    echo.
    echo Please install Docker Desktop from:
    echo https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

echo [OK] Docker is installed
echo.

REM Check if Docker daemon is running
docker ps >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker daemon is not running
    echo Please start Docker Desktop and try again
    pause
    exit /b 1
)

echo [OK] Docker daemon is running
echo.

REM Stop and remove existing container
docker ps -a --format "{{.Names}}" | findstr /r "^%CONTAINER_NAME%$" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Stopping existing container...
    docker rm -f %CONTAINER_NAME% >nul 2>&1
    echo [OK] Existing container removed
)

REM Pull latest NodeODM image
echo.
echo Pulling NodeODM image (this may take a few minutes on first run)...
docker pull %IMAGE%
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to pull NodeODM image
    pause
    exit /b 1
)
echo [OK] NodeODM image downloaded
echo.

REM Start NodeODM container
echo Starting NodeODM container on port %PORT%...
docker run -d ^
    --name %CONTAINER_NAME% ^
    -p %PORT%:3000 ^
    --restart unless-stopped ^
    --memory 4g ^
    --memory-swap 6g ^
    --cpus 2 ^
    %IMAGE%

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to start container
    pause
    exit /b 1
)

echo [OK] NodeODM container started
echo.

REM Wait for NodeODM to be ready
echo Waiting for NodeODM to initialize...
set /a COUNTER=0
set /a MAX_WAIT=120

:wait_loop
curl -s http://localhost:%PORT%/info >nul 2>&1
if %ERRORLEVEL% equ 0 goto ready

set /a COUNTER+=2
if %COUNTER% gtr %MAX_WAIT% goto timeout

timeout /t 2 /nobreak >nul
goto wait_loop

:timeout
echo [ERROR] NodeODM did not start in time
echo Check logs with: docker logs %CONTAINER_NAME%
pause
exit /b 1

:ready
echo [OK] NodeODM is ready!
echo.

REM Fix Python environment
echo Installing Python dependencies in container...
docker exec %CONTAINER_NAME% pip install --quiet python-dateutil pillow >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Could not install Python dependencies (may already be installed)
)
echo [OK] Python environment configured
echo.

REM Verify installation
echo Verifying installation...
curl -s http://localhost:%PORT%/info | findstr "version" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] NodeODM is working correctly!
) else (
    echo [WARNING] NodeODM may not be fully ready yet
)

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo NodeODM is now running and ready for orthomosaic processing.
echo.
echo Useful commands:
echo   View logs:    docker logs %CONTAINER_NAME%
echo   Stop:         docker stop %CONTAINER_NAME%
echo   Start:        docker start %CONTAINER_NAME%
echo   Remove:       docker rm -f %CONTAINER_NAME%
echo.
echo The container will automatically start with Docker Desktop.
echo You can now use ADER App for orthomosaic generation!
echo.
pause
