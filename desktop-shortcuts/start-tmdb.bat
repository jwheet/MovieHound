@echo off
REM TMDB Movie Finder Launcher for Windows
REM This script starts both the main server and torrent API

echo Starting TMDB Movie Finder...
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..

REM Start the main server in a new window
start "TMDB Server" cmd /k "cd /d %PROJECT_DIR% && node server.js"

REM Wait 2 seconds
timeout /t 2 /nobreak >nul

REM Start the Torrent API in a new window
start "Torrent API" cmd /k "cd /d %PROJECT_DIR%\Torrent-Api-py && api-py\Scripts\activate && python main.py"

REM Wait 3 seconds
timeout /t 3 /nobreak >nul

REM Open the web browser
start http://localhost:8321

echo.
echo TMDB Movie Finder is now running!
echo Main Server: http://localhost:8321
echo.
echo Close the server windows to stop the application.
