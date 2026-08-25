' slim-dashboard watchdog: revives the server if port 6388 stops listening.
' Runs hidden; start it from the Startup folder so it survives reboots.
Option Explicit
Dim shell, exec, line, listening
Set shell = CreateObject("WScript.Shell")

Function IsListening()
  IsListening = False
  On Error Resume Next
  Set exec = shell.Exec("netstat.exe -ano -p tcp")
  Do While Not exec.StdOut.AtEndOfStream
    line = exec.StdOut.ReadLine()
    If InStr(line, ":6388") > 0 And InStr(line, "LISTENING") > 0 Then
      IsListening = True
      Exit Function
    End If
  Loop
  On Error GoTo 0
End Function

Do While True
  listening = IsListening
  If Not listening Then
    shell.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\alex.xu\.config\opencode\slim-dashboard\server.js""", 0, False
  End If
  WScript.Sleep 60000
Loop
