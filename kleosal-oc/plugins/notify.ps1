[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($t.GetXml())
$txt = $doc.GetElementsByTagName('text')
$txt.Item(0).AppendChild($doc.CreateTextNode('opencode')) | Out-Null
$txt.Item(1).AppendChild($doc.CreateTextNode('Session completed.')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('opencode').Show($toast)
