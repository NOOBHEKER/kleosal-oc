@echo off
REM ============================================================
REM  opencode-cowork-kit deploy script (Windows)
REM  Copies the kit into %USERPROFILE%\.config\opencode,
REM  installs the screenshot-server Python deps, and creates
REM  opencode.jsonc from the example (never overwrites yours).
REM ============================================================
setlocal EnableDelayedExpansion

set "TARGET=%USERPROFILE%\.config\opencode"
set "SRC=%~dp0"

echo [1/5] Creating %TARGET% ...
if not exist "%TARGET%\mcp\screenshot-server" mkdir "%TARGET%\mcp\screenshot-server"
if not exist "%TARGET%\plugins" mkdir "%TARGET%\plugins"

echo [2/5] Copying screenshot-server ...
xcopy "%SRC%mcp\screenshot-server\*" "%TARGET%\mcp\screenshot-server\" /E /I /Y >nul

echo [3/5] Copying plugins ...
xcopy "%SRC%plugins\clipboard-paste.js" "%TARGET%\plugins\" /Y >nul
xcopy "%SRC%plugins\env-protection.js" "%TARGET%\plugins\" /Y >nul
xcopy "%SRC%plugins\notifications.js" "%TARGET%\plugins\" /Y >nul
xcopy "%SRC%plugins\notify.ps1" "%TARGET%\plugins\" /Y >nul
echo       (nodeterm-status.js skipped - only needed if you use nodeterm)

echo [4/5] Installing Python deps (mss, pyautogui, mcp^<2, Pillow) ...
pip install -r "%TARGET%\mcp\screenshot-server\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: pip install returned error %ERRORLEVEL%.
    echo Make sure Python 3.12+ is installed and on PATH.
    exit /b %ERRORLEVEL%
)

echo [5/5] Creating opencode.jsonc from example ...
if exist "%TARGET%\opencode.jsonc" (
    echo       opencode.jsonc already exists - leaving yours untouched.
    echo       Compare it with opencode.jsonc.example for new entries.
) else (
    copy "%SRC%opencode.jsonc.example" "%TARGET%\opencode.jsonc" >nul
    echo       Created. Now patching the screenshot-server path for user %USERNAME% ...
    powershell -NoProfile -Command "(Get-Content '%TARGET%\opencode.jsonc').Replace('<YOUR_USERNAME>', '%USERNAME%') | Set-Content '%TARGET%\opencode.jsonc'"
)

echo.
echo Done. Next steps:
echo   1. Set your Crawlbase key:  setx CRAWLBASE_TOKEN "your-key"  (and CRAWLBASE_JS_TOKEN)
echo   2. Restart opencode.
echo   3. Run /mcp list  - expect context7, gh_grep, crawlbase, screenshot, memory, thinking.
echo   4. Say "cowork" to capture your screen.
