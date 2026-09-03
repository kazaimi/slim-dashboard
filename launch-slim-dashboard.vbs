' Slim Dashboard quick launcher (windowless).
' Double-click (or desktop shortcut) to:
'   1. Ensure the watchdog (auto-revive) is running.
'   2. Ensure the backend (server.js) is running and healthy.
'   3. Open the dashboard in the default browser.
' Both frontend and backend are served by the same Node process on port 6388.
Option Explicit

Const HEALTH_URL = "http://127.0.0.1:6388/api/health"
Const DASH_URL = "http://localhost:6388"
Const NODE_FALLBACK = "C:\Program Files\nodejs\node.exe"

Dim shell, fso, root
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

Dim node
If fso.FileExists(NODE_FALLBACK) Then
  node = NODE_FALLBACK
Else
  node = "node.exe"
End If

Function NodeProcessesMatching(fragment)
  Dim wmi, items, proc, count
  count = 0
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set items = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%" & fragment & "%'")
  For Each proc In items
    count = count + 1
  Next
  Err.Clear
  NodeProcessesMatching = count
End Function

Function HealthUp()
  Dim http, ok
  ok = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.SetTimeouts 2000, 2000, 2000, 2000
  http.Open "GET", HEALTH_URL, False
  http.Send
  If Err.Number = 0 Then
    If http.status = 200 Then ok = True
  End If
  Err.Clear
  HealthUp = ok
End Function

' 1. Watchdog keeps the backend alive after logon; start it if missing.
If NodeProcessesMatching("watchdog.js") = 0 Then
  shell.Run """" & node & """ """ & root & "\watchdog.js""", 0, False
End If

' 2. Backend (serves the static frontend too); start hidden if not running.
If NodeProcessesMatching("server.js") = 0 Then
  shell.Run """" & node & """ """ & root & "\server.js""", 0, False
End If

' 3. Wait up to 20s for the health endpoint, then open the browser.
Dim attempt
For attempt = 1 To 40
  If HealthUp() Then Exit For
  WScript.Sleep 500
Next

shell.Run DASH_URL
