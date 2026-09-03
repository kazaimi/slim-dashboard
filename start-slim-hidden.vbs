On Error Resume Next
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

launcher = root & "\launch-slim-dashboard.vbs"
If fso.FileExists(launcher) Then
  shell.Run "wscript.exe """ & launcher & """", 0, False
End If
