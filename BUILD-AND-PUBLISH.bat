@echo off
title Voice Dashboard - Build & Publish

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Administratorrechte werden benoetigt...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

color 0A
cd /d "%~dp0client"
echo.
echo  ==========================================
echo   Voice Dashboard - Build ^& Publish
echo  ==========================================
echo.

if "%GH_TOKEN%"=="" (
  echo  GH_TOKEN nicht gesetzt!
  echo  Setze deinen GitHub Personal Access Token:
  echo.
  set /p GH_TOKEN="GitHub Token eingeben: "
  if "!GH_TOKEN!"=="" ( echo [FEHLER] Kein Token. & pause & exit /b )
)

node -e "console.log('ok')" >nul 2>&1
if %errorlevel% neq 0 ( echo [FEHLER] Node.js fehlt. & pause & exit /b )

echo  Installiere Pakete...
call npm install
if %errorlevel% neq 0 ( echo [FEHLER] & pause & exit /b )

echo.
echo  Baue und veroeffentliche auf GitHub Releases...
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set WIN_CSC_LINK=
call npm run publish

echo.
echo  ==========================================
echo   Fertig! Release auf GitHub erstellt.
echo  ==========================================
pause
