' One-shot hidden launcher for the node watchdog (exits immediately;
' watchdog.js keeps running as a hidden node process).
Set shell = CreateObject("WScript.Shell")
shell.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\alex.xu\.config\opencode\slim-dashboard\watchdog.js""", 0, False
