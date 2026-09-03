' One-shot hidden launcher for the node watchdog (exits immediately;
' watchdog.js keeps running as a hidden node process).
Option Explicit

Dim shell, fso, root, node
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

Function FindNode()
  Dim candidates, p
  candidates = Array( _
    "C:\Program Files\nodejs\node.exe", _
    "C:\Program Files (x86)\nodejs\node.exe", _
    shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe"), _
    shell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe") _
  )
  For Each p In candidates
    If fso.FileExists(p) Then
      FindNode = p
      Exit Function
    End If
  Next
  FindNode = "node.exe"
End Function

node = FindNode()
shell.Run """" & node & """ """ & root & "\watchdog.js""", 0, False
