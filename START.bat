@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Бюро невозвратных вещей — сервер

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 18 или новее с https://nodejs.org/
  echo После установки снова запустите START.bat.
  pause
  exit /b 1
)

if not exist "tools\serve.mjs" (
  echo Файл сервера не найден. Не перемещайте START.bat отдельно от папки игры.
  pause
  exit /b 1
)

echo Запускаю «Бюро невозвратных вещей»...
echo Браузер откроется автоматически. Не закрывайте это окно во время игры.
echo Ctrl+C — остановить игру.
echo.
node tools\serve.mjs --open

if errorlevel 1 (
  echo.
  echo Сервер остановился с ошибкой. Проверьте сообщение выше.
  pause
)
endlocal
