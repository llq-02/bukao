# Debug: schedule-time-blank [OPEN]

**症状**: 用户反馈"查看排班结果"页面的考试时间（考试日期、时间段）显示为空白。
**预期**: 每行记录都应显示 `YYYY-MM-DD` 的考试日期和 `HH:MM-HH:MM` 的时间段；仅名单模式下用户也需要看到"待安排"或至少一个占位信息（不能留空白）。
**会话状态**: OPEN → 已修复，等待用户确认 A/D
**根因（已确认）**: 「教室数量/容量改为非必填」后，只要用户没填/填 0 就走"仅名单"分支，generateSchedulePayload 把 examDate、timeSlot、roomId 都写了空字符串 '' → 前端 `${item.examDate || ''}` 渲染为空白。排班模式（教室>0）下完全正常。

## 可证伪假设

| # | 假设 | 证伪方法 | 状态 |
|---|------|----------|------|
| A | 仅名单模式后端把 examDate/timeSlot 写为空字符串 | 对比 regularRoomNum>0 vs =0 两种情况下 mode=1~4 返回 item.timeSlot 字段 | ✅ 确认 |
| B | 前端 renderRow 读错字段/被排序/分组改结构 | 浏览器 console 打印 renderRow 入参 item 看字段 | ❌ 证伪 |
| C | 错误的 mode 参数触发 getDataListByMode fallback 逻辑 | 打印 mode 参数与返回结构 | ❌ 证伪 |
| D | 浏览器缓存了旧版 ExamSchedule.html | 对比服务器返回的 ExamSchedule.html 中 renderRow 的当前代码 | ❌ 证伪 |
| E | 排班算法没排上 → timeSlot/examDate 是空 | 查看 generate 接口 msg / 返回 schedules[0].timeSlot | ⚠️ 设计分支 |

## 证据记录

### Pre-fix 日志（8 条事件，.dbg/trae-debug-log-schedule-time-blank.ndjson）
- 场景 A（教室=0，仅名单）：mode=1..4 emptySlot=4，sample 全部 d="" t="" r="" → 直接原因 ✅A
- 场景 B（教室=1，正常排班）：mode=1..4 emptySlot=0，sample 全部 d="2026-09-01" t="08:00-10:00" → 正常 ❌B/C/D

### Post-fix 验证（TDD 13/13 PASS + Final verification 16 产品功能项全 PASS）
**仅名单模式（教室=0）:**
- `/api/schedule/view` 四个 mode 均返回 `listOnlyMode=true`，前端显示黄色 banner 提示
- 页面 renderRow：`examDate/timeSlot/roomId` 空 → 显示灰色斜体 `<span class="text-gray-400 italic">待安排</span>`
- 学生名单导出（exportList）：考试时间、考试地点单元格 → `待安排`
- 考场分表导出（exportExcel）：sheetName=`待安排_第1组`，标题"考场序号=未分配（仅名单模式）"、"考场名称=待安排（共 N 人）"、"考试时间=待安排"；数据行三列：`考试日期=待安排`、`时间段=待安排`、`考场=待安排`

**排班模式（教室>0）:**
- 不出现 `待安排` 字样；时间/教室正常显示
- `/schedule/view?mode=1` 返回 `listOnlyMode=false`
- `generateSchedulePayload` 返回的 schedule[0] 含 `examDate='2026-09-01' timeSlot='08:00-10:00' roomId='R1'`

## 修复方案（最小改动）
已实施：
1. `server.js` → state 新增 `lastGenerateMode`（'listOnly' | 'full'），在 generate 两个分支末尾分别赋值
2. `server.js` → `/api/schedule/view` 响应增加顶层 `listOnlyMode` flag
3. `server.js` → `formatExamTime()`：无日期无时段时返回 `待安排`
4. `server.js` → `getExportListExcelHtml()`：考试地点单元格空 → `待安排`
5. `server.js` → `getExportExcelHtml()`：标题区/数据行 examDate/timeSlot/roomName 空 → `待安排`；sheetName 空 key → `待安排_第N组`；序号栏空 → `未分配（仅名单模式）`
6. `ExamSchedule.html` → `loadSchedule().renderRow()`：三列空 → 灰色斜体 `待安排` span；schedRes.listOnlyMode 为 true 时顶部黄色提示 banner
