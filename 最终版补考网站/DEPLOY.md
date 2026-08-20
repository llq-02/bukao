# Linux 云服务器部署手册（补考排班系统）

## 服务器信息
- 实例：腾讯云轻量应用服务器 **Ubuntu / CentOS**（推荐 Ubuntu 22.04 LTS x86_64）
- 公网 IP：`129.204.194.149`
- 登录用户：`root`（或腾讯云创建的自定义用户名）
- 密码：`213141Panxinai`（如果密钥登录则走 SSH）

> ⚠️ 重要：请在腾讯云控制台 → **重装系统** → 选择 **Ubuntu 22.04 LTS 或 CentOS 7/8 Stream（64 位）**，
> 把 Windows Server 切换为 Linux；否则以下命令都不适用。

---

## 一、SSH 登录服务器

在你本地 Windows 打开 PowerShell：

```
ssh root@129.204.194.149
```

（首次连接输入 `yes`，再输入密码 `213141Panxinai`）

---

## 二、安装 Node.js（Ubuntu 22.04 / Debian 系）

```bash
# 1) 更新系统
apt update -y && apt upgrade -y

# 2) 安装 Node.js 20 LTS（推荐用 NodeSource 源）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3) 验证版本
node -v        # 输出 v20.x.x
npm -v
```

**CentOS / RHEL 系**改用以下命令：
```bash
yum update -y
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
node -v
```

---

## 三、上传项目文件

在**你本地 Windows PowerShell**（不是服务器上）进入项目目录，用 `scp` 上传到服务器：

```powershell
cd "C:\Users\LingL\Desktop\新建文件夹"

# 上传：把 server.js / ExamSchedule.html / tailwind.js / package.json / start.sh 放到服务器 /opt/exam-schedule/
scp server.js ExamSchedule.html tailwind.js package.json start.sh root@129.204.194.149:/root/
```

（输入密码后会开始拷贝。如果提示「主机真实性无法确认」输入 `yes`）

**服务器上**把它们移动到规范目录：
```bash
mkdir -p /opt/exam-schedule
mv /root/server.js /root/ExamSchedule.html /root/tailwind.js /root/package.json /root/start.sh /opt/exam-schedule/
cd /opt/exam-schedule
chmod +x start.sh
```

> 说明：本项目 **零外部依赖**，`server.js` 只用 Node.js 内置 `http / fs / path / url` 模块，**不需要 `npm install`**。

---

## 四、开放 8080 端口

两边都要开，缺一不可：

### 1. 腾讯云控制台（Web 管理后台）
实例详情 → **防火墙** → 添加规则：
- 协议：`TCP`
- 端口：`8080`
- 策略：**允许**
- 来源：`0.0.0.0/0`（不限 IP，或只放你自己的公网 IP 更安全）

### 2. 服务器本机
```bash
# Ubuntu 22.04 默认 ufw：
ufw allow 8080/tcp
ufw reload
ufw status      # 确认 8080/tcp ALLOW

# CentOS 一般是 firewalld：
# firewall-cmd --permanent --add-port=8080/tcp
# firewall-cmd --reload
# firewall-cmd --list-ports
```

---

## 五、启动服务

### 方式 A：手动启动（临时测试用）
```bash
cd /opt/exam-schedule
node server.js
```
看到 `Exam Schedule service is running on http://localhost:8080` 说明正常。
**本地浏览器** 打开 `http://129.204.194.149:8080`

### 方式 B：一键脚本（推荐，等于 A）
```bash
cd /opt/exam-schedule
./start.sh
```
脚本会：后台启动 server.js → 3 秒后 curl 验证 → 打印公网访问地址。

### 方式 C：PM2 后台常驻 + 开机自启（正式环境，强烈推荐）
```bash
npm install -g pm2
cd /opt/exam-schedule
pm2 start server.js --name exam
pm2 save
pm2 startup systemd     # 按输出的命令复制再执行一遍，实现开机自启
```
常用命令：
```bash
pm2 list                # 查看状态
pm2 logs exam --lines 50
pm2 restart exam
pm2 stop exam
```

---

## 六、验证部署成功

在服务器本机执行：
```bash
curl -s http://localhost:8080/api/subject/list
# 返回 {"code":0,"msg":"success","data":[]} 即正常
```

在你电脑浏览器打开：
```
http://129.204.194.149:8080
```
看到仪表盘，四项都是 `0`，初始状态 ✅

然后点**「加载模拟数据」**或自己导入数据 → **「生成排班」** → 去「查看结果」。

---

## 七、常见问题

### Q1：浏览器访问 `http://129.204.194.149:8080` 连不上？
- 检查「腾讯云控制台防火墙」是否放行 8080 TCP
- 检查服务器本机防火墙 `ufw status` 或 `firewall-cmd --list-ports`
- 检查 Node 进程：`ss -tlnp | grep 8080`（或 `netstat -tlnp | grep 8080`）

### Q2：端口被占用？
修改 [server.js](file:///c:/Users/LingL/Desktop/新建文件夹/server.js) 第 6 行 `const PORT = 8080;` 改为其他端口（如 3000、8000），记得同步开放对应防火墙端口。

### Q3：数据重启就没了？
本项目默认数据保存在**内存**中（`server.js` 里的 `state` 对象），进程重启会清空。如果需要持久化，后续可以加上 SQLite 或 JSON 文件自动保存。

### Q4：想把 8080 改成 80（不用带端口号访问）？
```bash
# Ubuntu 允许 Node 直接绑定 80 端口：
apt install -y libcap2-bin
setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))
# 然后把 server.js 里 PORT 改成 80，重启进程即可。
# 或更推荐：用 Nginx 反向代理 80 → 127.0.0.1:8080（标准做法）。
```

### Q5：FileName.cpp 需要放到 Linux 吗？
不需要。`FileName.cpp` 是早期 Windows-only 的旧版本，**全文件已经用 `#ifdef _WIN32` 包裹**，放到 Linux 上 `g++` 编译时会直接报：
```
FileName.cpp:37:2: error: #error "FileName.cpp 是早期 Windows-only 版本，Linux 下请使用同目录 Node.js 版本：node server.js"
```
Linux 下直接用 `node server.js`，功能、性能、可维护性都远超 C++ 版。
