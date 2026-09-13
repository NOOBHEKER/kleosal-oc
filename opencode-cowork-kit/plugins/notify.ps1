param(
    [string]$Title = "opencode",
    [string]$Message = "Session completed.",
    [string]$Action = "notify"
)

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">$Title</text>
            <text id="2">$Message</text>
        </binding>
    </visual>
    <audio silent="true"/>
</toast>
"@

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Tag = "opencode"
$toast.Group = "opencode"

$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('opencode')

if ($Action -eq "focus") {
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class WinFocus {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
"@

    $proc = Get-Process -Name "opencode" -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } |
            Select-Object -First 1

    if ($proc) {
        [WinFocus]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
        [WinFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    }
} else {
    $notifier.Show($toast) | Out-Null
}
