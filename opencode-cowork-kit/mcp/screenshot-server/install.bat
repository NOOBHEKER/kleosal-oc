@echo off
REM Install screenshot-server dependencies
echo Installing screenshot-server dependencies...
pip install -r "%~dp0requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo FAILED: pip install returned error %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
echo.
echo Verifying imports...
python -c "import mss, pyautogui, mcp; print('All imports OK')"
echo Done.
