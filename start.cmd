@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if not errorlevel 1 (
  python server.py --open
) else (
  py -3 server.py --open
)
if errorlevel 1 (
  echo Server could not start. Check Python 3 and whether port 8765 is in use.
  pause
)
