On Error Resume Next
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
launcher = "C:\Users\alex.xu\Desktop\work\软件分析\启动SlimDashboard.cmd"
If fso.FileExists(launcher) Then
  shell.Run """" & launcher & """", 0, False
End If
