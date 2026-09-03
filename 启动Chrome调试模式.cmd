@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动浏览器调试模式 (端口 9222)...
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:6388/api/open-debug-chrome' -TimeoutSec 5; if ($r.ok) { Write-Host '调试浏览器已启动！请在打开的浏览器中登录中转站，然后返回面板点击 Sync token。' -ForegroundColor Green } else { Write-Host '启动失败: ' $r.errors -ForegroundColor Red } } catch { Write-Host '请确保 Slim Dashboard 服务正在运行 (http://localhost:6388)' -ForegroundColor Yellow }"
pause
