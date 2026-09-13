"""Cowork screen-capture MCP server for opencode (Windows).

Tools:
  - capture_screen: grab the primary monitor, return PNG image (+ temp path fallback).
  - type_text:      type text into the currently focused window (Gmail in browser, CMD, ...).
  - press_key:      press a single key (enter, tab, escape, ...) in the focused window.

On-demand only: the agent calls these when the user says "cowork".
Requires the target window (Gmail/CMD) to be focused before typing.
"""

import base64
import io
import os
import sys
import tempfile

# Headless-safe: fail fast with a clear message if deps are missing.
try:
    import mss
    from PIL import Image as PILImage
except ImportError as exc:
    sys.stderr.write(f"screenshot-server: missing dependency: {exc}\n")
    sys.stderr.write("Run install.bat first.\n")
    sys.exit(1)

try:
    import pyautogui

    pyautogui.FAILSAFE = True  # slam mouse to a corner to abort a runaway type
    _TYPING_AVAILABLE = True
except ImportError:
    _TYPING_AVAILABLE = False

from mcp.server.fastmcp import FastMCP, Image

mcp = FastMCP("screenshot-server")


def _grab_png_bytes() -> bytes:
    with mss.MSS() as sct:
        shot = sct.grab(sct.monitors[1])  # primary monitor
        img = PILImage.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


@mcp.tool()
def capture_screen() -> Image:
    """Capture the primary monitor and return it as a PNG image.

    Call this when the user says "cowork" or asks what is on their screen.
    Analyze the returned image, then suggest what to type or do next.
    """
    return Image(data=_grab_png_bytes(), format="png")


@mcp.tool()
def capture_screen_to_file() -> str:
    """Capture the primary monitor and save it to a temp PNG file.

    Returns the file path. Fallback for when image content blocks are not
    supported: read the file at the returned path instead.
    """
    path = os.path.join(tempfile.gettempdir(), "cowork-screen.png")
    with open(path, "wb") as f:
        f.write(_grab_png_bytes())
    return path


@mcp.tool()
def type_text(text: str, interval_seconds: float = 0.01) -> str:
    """Type text into the currently focused window (Gmail compose, CMD, ...).

    The user MUST have clicked into the target window first. Types exactly
    what is passed, including newlines (sent as Enter). Keep FAILSAFE in mind:
    moving the mouse to a screen corner aborts typing.
    """
    if not _TYPING_AVAILABLE:
        return "ERROR: pyautogui is not installed. Run install.bat first."
    if not text:
        return "ERROR: nothing to type (empty text)."
    pyautogui.write(text, interval=max(0.0, interval_seconds))
    return f"Typed {len(text)} characters into the focused window."


@mcp.tool()
def press_key(key: str) -> str:
    """Press a single key in the focused window: enter, tab, escape, up, down,
    left, right, backspace, delete, home, end, pageup, pagedown, f1-f12.
    """
    if not _TYPING_AVAILABLE:
        return "ERROR: pyautogui is not installed. Run install.bat first."
    allowed = {
        "enter", "tab", "escape", "up", "down", "left", "right",
        "backspace", "delete", "home", "end", "pageup", "pagedown",
        *[f"f{i}" for i in range(1, 13)],
    }
    key = key.strip().lower()
    if key not in allowed:
        return f"ERROR: key '{key}' not allowed. Use one of: {sorted(allowed)}."
    pyautogui.press(key)
    return f"Pressed {key}."


if __name__ == "__main__":
    mcp.run()
