#!/usr/bin/env bash
# start.sh — Linux 一键启动脚本（补考排班系统）
# 用法：chmod +x start.sh && ./start.sh

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装："
  echo "   Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  echo "   CentOS/RHEL : curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs"
  exit 1
fi

echo "[1/3] 启动服务（后台运行，日志写入 server.log）..."
# 先杀掉同名旧进程，避免端口冲突
pkill -f "node server.js" 2>/dev/null || true
sleep 1
nohup node server.js > server.log 2>&1 &
APP_PID=$!
echo "  PID = $APP_PID"
sleep 3

echo "[2/3] 验证服务..."
if command -v curl >/dev/null 2>&1; then
  HTTP_CODE=$(curl -s -o /tmp/exam_health.json -w "%{http_code}" http://127.0.0.1:8080/api/health || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✔ 服务正常，HTTP $HTTP_CODE  ->  $(cat /tmp/exam_health.json)"
  else
    echo "  ⚠ HTTP=$HTTP_CODE，查看日志: tail -50 server.log"
    tail -20 server.log
  fi
else
  echo "  (未安装 curl，跳过 HTTP 自检)"
fi

PUBLIC_IP=""
# 尝试获取公网 IP（腾讯云轻量一般可以直接出网查询）
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || true)
fi

echo
echo "[3/3] 部署完成！"
if [ -n "$PUBLIC_IP" ]; then
  echo "  公网访问:  http://${PUBLIC_IP}:8080"
else
  echo "  公网访问:  http://<你的服务器公网IP>:8080"
fi
echo "  本机访问:  http://127.0.0.1:8080"
echo "  日志位置:  $APP_DIR/server.log"
echo "  停止服务:  pkill -f 'node server.js'"
echo
echo "如正式使用，推荐用 PM2 常驻并开机自启："
echo "  sudo npm install -g pm2"
echo "  pm2 start $APP_DIR/server.js --name exam && pm2 save && pm2 startup systemd"
