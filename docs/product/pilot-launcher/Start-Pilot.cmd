@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0Start-Pilot.ps1"
if errorlevel 1 (
  echo Pilot did not start. Keep the message and contact your Owner or IT.
  echo Do not lower Windows security settings.
  pause
)
endlocal
