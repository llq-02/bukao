const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8080;
const FILE_PATH = path.join(__dirname, 'ExamSchedule.html');

const state = {
  subjects: [],
  rooms: [],
  students: [],
  schedules: [],
  lastGenerateMode: null   // 'listOnly' 或 'full'，用于前端提示是否仅名单
};

const timeSlots = [
  '08:00-10:00',
  '10:30-12:30',
  '14:00-16:00',
  '16:30-18:30'
];

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With'
  });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, csvText) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="exam_schedule.csv"',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(csvText);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result.map(item => item.trim().replace(/^"|"$/g, ''));
}

function makeSubjectCodeMap() {
  const map = new Map();
  state.subjects.forEach(subject => map.set(subject.code, subject.id));
  return map;
}

// 表头别名映射：支持多种常见中文表头
const HEADER_ALIASES = {
  studentId: ['学号', 'StudentID', '学生学号'],
  name: ['姓名', 'Name', '学生姓名'],
  campus: ['校区', 'Campus'],
  department: ['学生所在院系', '院系', 'Department', '学院'],
  major: ['专业', 'Major'],
  className: ['班级名称', '班级', 'ClassName'],
  courseCollege: ['开课学院', 'CourseCollege'],
  courseUnit: ['开课单位', 'CourseUnit'],
  courseCode: ['课程编号', 'CourseCode', '课程代码'],
  courseName: ['课程名称', 'CourseName', '科目名称'],
  courseAttr: ['课程属性', 'CourseAttr'],
  grade: ['年级', 'Grade'],
  totalHours: ['总学时', 'TotalHours'],
  credits: ['学分', 'Credits'],
  originalScore: ['原始成绩', 'OriginalScore'],
  scoreFlag: ['成绩标志', 'ScoreFlag'],
  teacher: ['上课教师', '教师', 'Teacher'],
  isLabExam: ['是否机考', 'IsLabExam']
};

function buildHeaderIndex(headerRow) {
  const map = {};
  const headers = parseCsvLine(headerRow).map(h => h.trim());
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex(h => aliases.some(a => h === a || h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function importStudentsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { count: 0, msg: 'CSV为空' };
  }

  // 解析表头
  const headerMap = buildHeaderIndex(lines[0]);
  const get = (row, field) => (headerMap[field] !== undefined ? row[headerMap[field]] || '' : '');

  const subjectCodeMap = makeSubjectCodeMap();
  const studentMap = new Map();
  let addedSubjects = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 2) continue;

    const studentId = get(row, 'studentId');
    const name = get(row, 'name');
    if (!studentId || !name) continue;

    const campus = get(row, 'campus');
    const department = get(row, 'department');
    const major = get(row, 'major');
    const className = get(row, 'className');
    const courseCollege = get(row, 'courseCollege');
    const courseUnit = get(row, 'courseUnit');
    const courseCode = get(row, 'courseCode');
    const courseName = get(row, 'courseName');
    const isLabExamStr = get(row, 'isLabExam');
    const courseAttr = get(row, 'courseAttr');
    const grade = get(row, 'grade');
    const totalHours = get(row, 'totalHours');
    const credits = get(row, 'credits');
    const teacher = get(row, 'teacher');

    let subjectId = subjectCodeMap.get(courseCode);
    if (!subjectId) {
      const existing = state.subjects.find(sub => sub.code === courseCode);
      if (existing) {
        if (courseName) existing.name = courseName;
        existing.isLabRequired = /1|yes|true|是|机考/i.test(String(isLabExamStr));
        subjectId = existing.id;
      } else {
        const newSubject = {
          id: `SUB${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          code: courseCode || `SUB${state.subjects.length + 1}`,
          name: courseName || '新增补考科目',
          isLabRequired: /1|yes|true|是|机考/i.test(String(isLabExamStr))
        };
        state.subjects.push(newSubject);
        subjectId = newSubject.id;
        addedSubjects += 1;
      }
      subjectCodeMap.set(courseCode, subjectId);
    }

    if (!studentMap.has(studentId)) {
      studentMap.set(studentId, {
        id: `S${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        studentId,
        name,
        campus,
        department,
        major,
        className,
        courseCollege,
        courseUnit,
        subjectIds: [],
        enrollments: {} // subjectId -> { courseAttr, grade, totalHours, credits, teacher }
      });
    }

    const student = studentMap.get(studentId);
    if (subjectId && !student.subjectIds.includes(subjectId)) {
      student.subjectIds.push(subjectId);
    }
    if (subjectId) {
      student.enrollments[subjectId] = { courseAttr, grade, totalHours, credits, teacher };
    }
  }

  state.students = Array.from(studentMap.values());
  return { count: state.students.length, addedSubjects, msg: `成功导入 ${state.students.length} 名学生` };
}

function createRooms(regularRoomNum, labRoomNum, regularCapacity, labCapacity) {
  const generated = [];
  const regCap = regularCapacity || 50;
  const labCap = labCapacity || 30;
  for (let i = 1; i <= regularRoomNum; i += 1) {
    generated.push({ id: `R${i}`, name: `普通教室${i}`, type: 'regular', capacity: regCap });
  }
  for (let i = 1; i <= labRoomNum; i += 1) {
    generated.push({ id: `L${i}`, name: `机房${i}`, type: 'lab', capacity: labCap });
  }
  state.rooms = generated;
}

// 校验 HH:MM-HH:MM 时间段格式并规范化；无效时返回 null
function normalizeSlot(slot) {
  if (!slot) return null;
  const s = String(slot).trim().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2}):(\d{2})[-~至](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sh = parseInt(m[1], 10), sm = parseInt(m[2], 10);
  const eh = parseInt(m[3], 10), em = parseInt(m[4], 10);
  if (sh < 0 || sh > 23 || sm < 0 || sm > 59 || eh < 0 || eh > 23 || em < 0 || em > 59) return null;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (end <= start) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(sh)}:${pad(sm)}-${pad(eh)}:${pad(em)}`;
}

function generateSchedulePayload({ startDate, slotPerDay, regularRoomNum, labRoomNum, regularCapacity, labCapacity, customSlots }) {
  if (state.students.length === 0) {
    return { ok: false, msg: '请先导入学生数据' };
  }

  // 判定是否为「仅生成名单」模式：教室数量和容量都不填或为 0
  const hasRegular = Number(regularRoomNum) > 0;
  const hasLab = Number(labRoomNum) > 0;
  const listOnlyMode = !hasRegular && !hasLab;

  // 仅名单模式不校验起始日期；有排班模式才需要起始日期
  if (!listOnlyMode && !startDate) {
    return { ok: false, msg: '请选择考试起始日期' };
  }

  if (listOnlyMode) {
    // 仅名单模式：不分配教室（roomId 留空），但按「同一科目集中在同一天同一时段」的策略排时间
    if (!startDate) {
      return { ok: false, msg: '请选择考试起始日期（即便不填教室，也需要日期来安排考试时间）' };
    }

    // 解析并规范化每天的时间段
    let effectiveSlots = [];
    if (Array.isArray(customSlots) && customSlots.length > 0) {
      const normalized = customSlots.map(normalizeSlot).filter(Boolean);
      if (normalized.length === 0) {
        return { ok: false, msg: '自定义时间段格式无效，请使用 HH:MM-HH:MM（例如 08:00-10:00）' };
      }
      effectiveSlots = normalized;
    } else {
      const n = Math.max(1, Number(slotPerDay || 2));
      effectiveSlots = timeSlots.slice(0, n);
    }
    const nSlots = effectiveSlots.length;

    // 按科目分组：科目 → 学生列表（学号排序）
    const studentBySubject = new Map();
    state.students.forEach(student => {
      (student.subjectIds || []).forEach(subjectId => {
        if (!studentBySubject.has(subjectId)) studentBySubject.set(subjectId, []);
        studentBySubject.get(subjectId).push(student);
      });
    });
    const subjectOrder = Array.from(state.subjects)
      .map(subject => ({ subject, count: (studentBySubject.get(subject.id) || []).length }))
      .sort((a, b) => b.count - a.count); // 人数多的科目优先排

    const scheduleEntries = [];
    const studentSlotMap = new Map(); // studentId -> Set<"date|slot">
    const MAX_DAYS = 365; // 扫描上限放宽到 1 年，不再人为限制天数

    for (const { subject } of subjectOrder) {
      const studentsInSubject = (studentBySubject.get(subject.id) || [])
        .slice()
        .sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
      if (studentsInSubject.length === 0) continue;

      // 为该科目挑选最早的空闲时段：该科目所有学生在该时段都不冲突
      // 允许多个无冲突科目共享同一时段（跟人工排表一样）
      let chosenDate = null, chosenSlot = null;
      for (let offset = 0; offset < MAX_DAYS * nSlots; offset++) {
        const slot = effectiveSlots[offset % nSlots];
        const date = addDays(startDate, Math.floor(offset / nSlots));
        const slotKey = `${date}|${slot}`;
        // 检查：该科目下的学生有没有人在这个时段有其他科冲突
        let anyConflict = false;
        for (const s of studentsInSubject) {
          const used = studentSlotMap.get(s.id);
          if (used && used.has(slotKey)) { anyConflict = true; break; }
        }
        if (!anyConflict) {
          chosenDate = date;
          chosenSlot = slot;
          break;
        }
      }

      if (!chosenDate) {
        // 极端兜底：所有时段都有冲突 → 放到最后一天的第一个时段
        chosenSlot = effectiveSlots[0];
        chosenDate = addDays(startDate, Math.max(0, MAX_DAYS - 1));
      }

      // 把该科目下的所有学生一次性排入（同一天同一时段）
      for (const s of studentsInSubject) {
        scheduleEntries.push({
          id: `SCH${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          studentId: s.id,
          subjectId: subject.id,
          roomId: '',            // 仅名单模式：不排教室，显示"待安排"
          timeSlot: chosenSlot,
          examDate: chosenDate
        });
        const sk = `${chosenDate}|${chosenSlot}`;
        if (!studentSlotMap.has(s.id)) studentSlotMap.set(s.id, new Set());
        studentSlotMap.get(s.id).add(sk);
      }
      // 不推进 cursor：下一科目也从第 0 个时段开始找，尽量复用同一时段
    }

    state.schedules = scheduleEntries;
    state.rooms = [];
    state.lastGenerateMode = 'listOnly';
    // === 理论下限计算（仅名单模式）===
    //   仅名单模式无教室容量限制，多科可共享同一时段
    //   唯一约束：同一学生同一时段只能考一科
    //   理论下限 = ceil(max(每人科目数) / 每天时段数)
    let lowerBound = 1;
    if (scheduleEntries.length > 0) {
      let maxExams = 0;
      state.students.forEach(st => { maxExams = Math.max(maxExams, (st.subjectIds || []).length); });
      lowerBound = Math.max(1, Math.ceil(maxExams / Math.max(1, nSlots)));
    }
    // 紧凑度说明：给用户明确的"用了多少天"信息，避免翻表格时误以为跨度太大
    let spanMsg = '';
    if (scheduleEntries.length > 0) {
      const mn = scheduleEntries.reduce((a,s) => s.examDate < a ? s.examDate : a, '9999-99-99');
      const mx = scheduleEntries.reduce((a,s) => s.examDate > a ? s.examDate : a, '0000-00-00');
      const span = Math.round((new Date(mx) - new Date(mn)) / 86400000) + 1;
      const optimalTag = span <= lowerBound ? '，已最优' : `，当前 ${span} 天（理论下限 ${lowerBound} 天）`;
      spanMsg = `（${mn} ~ ${mx}，共 ${span} 天 / 理论下限 ${lowerBound} 天${span <= lowerBound ? '，已最优' : ''}）`;
    }
    return { ok: true, msg: `未设置教室，已生成学生名单并分配考试时间${spanMsg}，共 ${scheduleEntries.length} 条，考场待安排`, data: scheduleEntries };
  }

  createRooms(
    hasRegular ? Number(regularRoomNum) : 1,
    hasLab ? Number(labRoomNum) : 1,
    Number(regularCapacity) > 0 ? Number(regularCapacity) : 50,
    Number(labCapacity) > 0 ? Number(labCapacity) : 30
  );

  // 优先使用传入的自定义时间段，否则回退到 slotPerDay 切默认时间段
  let effectiveSlots = [];
  if (Array.isArray(customSlots) && customSlots.length > 0) {
    const normalized = customSlots.map(normalizeSlot).filter(Boolean);
    if (normalized.length === 0) {
      return { ok: false, msg: '自定义时间段格式无效，请使用 HH:MM-HH:MM（例如 08:00-10:00）' };
    }
    effectiveSlots = normalized;
  } else {
    const n = Math.max(1, Number(slotPerDay || 2));
    effectiveSlots = timeSlots.slice(0, n);
  }
  const studentBySubject = new Map();
  const studentExamKey = new Map();
  const scheduleEntries = [];

  state.students.forEach(student => {
    student.subjectIds.forEach(subjectId => {
      const key = `${student.studentId}_${subjectId}`;
      studentExamKey.set(key, false);
      if (!studentBySubject.has(subjectId)) {
        studentBySubject.set(subjectId, []);
      }
      studentBySubject.get(subjectId).push(student);
    });
  });

  const subjectOrder = Array.from(state.subjects)
    .map(subject => ({
      subject,
      count: (studentBySubject.get(subject.id) || []).length
    }))
    .sort((a, b) => b.count - a.count);

  // 跟踪每个时间段各教室的使用人数
  // key: "date|slot" → Map<roomId, count>
  const slotRoomUsage = new Map();
  // 跟踪每个学生在哪个 date|slot 已有考试，避免同一时间段冲突
  // key: studentId → Set<"date|slot">
  const studentSlotMap = new Map();

  // === 【紧凑算法 · v3】按 slot 顺序，每个 slot 尽量塞满"普通+机房"的并行多科任务 ===
  //   - 拆任务：每个科目维护一个 pending 学生队列（按学号排序）
  //   - 按 local=0,1,2,... 顺序扫 slot；对每个 slot：
  //       反复尝试把仍有 pending 的科目（按剩余人数降序）塞进当前 slot 的空教室
  //       一轮扫描没有任何 progress → local++
  //   - 目标：让每天普通教室 × 时段数、机房教室 × 时段数 的并行度拉满 → 严格接近理论下限
  const tasks = subjectOrder
    .filter(t => t.count > 0)
    .map(t => {
      const subject = t.subject;
      const students = (studentBySubject.get(subject.id) || [])
        .filter(s => !studentExamKey.get(`${s.studentId}_${subject.id}`))
        .slice()
        .sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
      const roomType = subject.isLabRequired ? 'lab' : 'regular';
      const availableRooms = state.rooms.filter(room => room.type === roomType);
      return { subject, roomType, availableRooms, pending: students };
    })
    .filter(t => t.availableRooms.length > 0);

  const MAX_DAYS = 365; // 扫描上限放宽到 1 年，不再人为限制天数
  const maxLocal = MAX_DAYS * effectiveSlots.length;
  let local = 0;
  // 只要还有 pending 且还在扫描范围内，就继续塞下一个 slot
  while (tasks.some(t => t.pending.length > 0) && local < maxLocal) {
    const slot = effectiveSlots[local % effectiveSlots.length];
    const date = addDays(startDate, Math.floor(local / effectiveSlots.length));
    const slotKey = `${date}|${slot}`;
    if (!slotRoomUsage.has(slotKey)) slotRoomUsage.set(slotKey, new Map());
    const roomUsage = slotRoomUsage.get(slotKey);

    let progress = true;
    // 在同一个 slot 里反复扫任务列表，直到所有任务都塞不进任何东西
    while (progress) {
      progress = false;
      // 每轮重新按 pending 长度降序（保持先把人数多的任务塞满）
      tasks.sort((a, b) => b.pending.length - a.pending.length);
      for (const task of tasks) {
        if (task.pending.length === 0) continue;
        // 当前 slot 中，该类型可用空房间（按容量剩余从大到小，优先用大剩余）
        const candidates = task.availableRooms
          .map(room => ({ room, used: roomUsage.get(room.id) || 0 }))
          .filter(x => x.used < x.room.capacity)
          .sort((a, b) => (b.room.capacity - b.used) - (a.room.capacity - a.used));
        if (candidates.length === 0) continue;

        let placedThisTask = 0;
        let pending = task.pending;
        for (const { room, used } of candidates) {
          const remaining = room.capacity - used;
          if (remaining <= 0) continue;
          const stillPending = [];
          let added = 0;
          for (const student of pending) {
            if (added >= remaining) {
              stillPending.push(student);
              continue;
            }
            const examKey = `${student.studentId}_${task.subject.id}`;
            if (studentExamKey.get(examKey)) continue;
            if (!studentSlotMap.has(student.id)) studentSlotMap.set(student.id, new Set());
            if (studentSlotMap.get(student.id).has(slotKey)) {
              stillPending.push(student);
              continue;
            }
            scheduleEntries.push({
              id: `SCH${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
              studentId: student.id,
              subjectId: task.subject.id,
              roomId: room.id,
              timeSlot: slot,
              examDate: date
            });
            studentExamKey.set(examKey, true);
            studentSlotMap.get(student.id).add(slotKey);
            roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
            added += 1;
          }
          pending = stillPending;
          placedThisTask += added;
          if (pending.length === 0) break;
        }
        task.pending = pending;
        if (placedThisTask > 0) progress = true;
      }
    }
    local += 1;
  }
  // 兜底：如果扫完上限仍有任务没排完，继续放宽扫（不会跳出）
  for (const task of tasks) {
    if (task.pending.length === 0) continue;
    while (task.pending.length > 0 && local < maxLocal * 2) {
      const slot = effectiveSlots[local % effectiveSlots.length];
      const date = addDays(startDate, Math.floor(local / effectiveSlots.length));
      const slotKey = `${date}|${slot}`;
      if (!slotRoomUsage.has(slotKey)) slotRoomUsage.set(slotKey, new Map());
      const roomUsage = slotRoomUsage.get(slotKey);
      const candidates = task.availableRooms
        .map(room => ({ room, used: roomUsage.get(room.id) || 0 }))
        .filter(x => x.used < x.room.capacity);
      if (candidates.length === 0) { local++; continue; }
      let pending = task.pending;
      for (const { room } of candidates) {
        const remaining = room.capacity - (roomUsage.get(room.id) || 0);
        if (remaining <= 0) continue;
        const stillPending = [];
        let added = 0;
        for (const student of pending) {
          if (added >= remaining) { stillPending.push(student); continue; }
          const examKey = `${student.studentId}_${task.subject.id}`;
          if (studentExamKey.get(examKey)) continue;
          if (!studentSlotMap.has(student.id)) studentSlotMap.set(student.id, new Set());
          if (studentSlotMap.get(student.id).has(slotKey)) { stillPending.push(student); continue; }
          scheduleEntries.push({
            id: `SCH${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            studentId: student.id,
            subjectId: task.subject.id,
            roomId: room.id,
            timeSlot: slot,
            examDate: date
          });
          studentExamKey.set(examKey, true);
          studentSlotMap.get(student.id).add(slotKey);
          roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
          added += 1;
        }
        pending = stillPending;
        if (pending.length === 0) break;
      }
      task.pending = pending;
      if (task.pending.length === 0) break;
      local += 1;
    }
  }

  state.schedules = scheduleEntries;
  state.lastGenerateMode = 'full';

  // === 理论下限计算（完整排班模式）===
  //   维度1（普通教室）：普通科实例 Σceil(该科人数 / 普通总容量)，每天最多排 (普通教室数 × 时段数) 个实例
  //   维度2（机房教室）：机房科实例 Σceil(该科人数 / 机房总容量)，每天最多排 (机房教室数 × 时段数) 个实例
  //   维度3（学生冲突）：max(每人科目数) / 每天时段数 向上取整
  //   理论下限 = max(维度1, 维度2, 维度3)
  let lowerBound = 1;
  if (scheduleEntries.length > 0 && effectiveSlots.length > 0) {
    const S = effectiveSlots.length;
    const regRooms = state.rooms.filter(r => r.type === 'regular');
    const labRooms = state.rooms.filter(r => r.type === 'lab');
    const capRegularSum = regRooms.reduce((s, r) => s + (r.capacity || 0), 0) || 1;
    const capLabSum    = labRooms.reduce((s, r) => s + (r.capacity || 0), 0) || 1;
    const regRoomCount = Math.max(1, regRooms.length || 1);
    const labRoomCount = Math.max(1, labRooms.length || 1);
    let regInstances = 0, labInstances = 0;
    subjectOrder.forEach(({ subject, count }) => {
      if (count <= 0) return;
      if (subject.isLabRequired) {
        labInstances += Math.ceil(count / capLabSum);
      } else {
        regInstances += Math.ceil(count / capRegularSum);
      }
    });
    const daysReg = Math.max(1, Math.ceil(regInstances / Math.max(1, S * (state.rooms.filter(r=>r.type==='regular').length || 1))));
    const daysLab = Math.max(1, Math.ceil(labInstances / Math.max(1, S * (state.rooms.filter(r=>r.type==='lab').length || 1))));
    let maxExams = 0;
    state.students.forEach(st => { maxExams = Math.max(maxExams, (st.subjectIds || []).length); });
    const spanStu = Math.max(1, Math.ceil(maxExams / S));
    lowerBound = Math.max(daysReg, daysLab, spanStu);
  }
  // 紧凑度说明
  let spanMsg = '';
  if (scheduleEntries.length > 0) {
    const mn = scheduleEntries.reduce((a,s) => s.examDate < a ? s.examDate : a, '9999-99-99');
    const mx = scheduleEntries.reduce((a,s) => s.examDate > a ? s.examDate : a, '0000-00-00');
    const span = Math.round((new Date(mx) - new Date(mn)) / 86400000) + 1;
    spanMsg = `（${mn} ~ ${mx}，共 ${span} 天 / 理论下限 ${lowerBound} 天${span <= lowerBound ? '，已最优' : ''}）`;
  }
  return { ok: true, msg: `成功生成 ${scheduleEntries.length} 条排考记录${spanMsg}`, data: scheduleEntries };
}

function getDataListByMode(mode) {
  if (!state.schedules || state.schedules.length === 0) {
    return [];
  }

  if (mode === 1) {
    const groups = new Map();
    state.schedules.forEach(item => {
      const key = `${item.examDate} | ${item.timeSlot}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  if (mode === 2) {
    const groups = new Map();
    state.schedules.forEach(item => {
      const key = item.roomId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  if (mode === 3) {
    const groups = new Map();
    state.schedules.forEach(item => {
      const student = state.students.find(s => s.id === item.studentId);
      const key = student ? `${student.studentId}-${student.name}` : item.studentId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  if (mode === 4) {
    const groups = new Map();
    state.schedules.forEach(item => {
      const subject = state.subjects.find(s => s.id === item.subjectId);
      const key = subject ? `${subject.code}-${subject.name}` : item.subjectId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  return state.schedules;
}

function getExportCsv() {
  const header = [
    'SubjectCode', 'SubjectName', 'ExamDate', 'TimeSlot', 'RoomName', 'RoomType',
    'StudentID', 'StudentName', 'Campus', 'Department', 'Major', 'ClassName'
  ];

  const rows = state.schedules.map(item => {
    const subject = state.subjects.find(s => s.id === item.subjectId);
    const room = state.rooms.find(r => r.id === item.roomId);
    const student = state.students.find(s => s.id === item.studentId);
    return [
      subject ? subject.code : '',
      subject ? subject.name : '',
      item.examDate,
      item.timeSlot,
      room ? room.name : '',
      room ? room.type : '',
      student ? student.studentId : '',
      student ? student.name : '',
      student ? student.campus : '',
      student ? student.department : '',
      student ? student.major : '',
      student ? student.className : ''
    ];
  });

  return [header, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function escapeXml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sanitizeSheetName(name) {
  // Excel sheet name: max 31 chars, no : \ / ? * [ ]
  let s = String(name || 'Sheet').replace(/[:\\/?*\[\]]/g, '-');
  if (s.length > 31) s = s.slice(0, 31);
  return s;
}

function getExportExcelHtml() {
  // 中文拼音排序比较器（按姓名拼音字母；同姓再按学号）
  const nameCollator = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true })
    : null;
  function cmpPinyinNameItem(aItem, bItem) {
    const sa = state.students.find(s => s.id === aItem.studentId);
    const sb = state.students.find(s => s.id === bItem.studentId);
    const na = sa ? (sa.name || '') : '';
    const nb = sb ? (sb.name || '') : '';
    if (na !== nb) {
      if (nameCollator) return nameCollator.compare(na, nb);
      return na.localeCompare(nb, 'zh-CN');
    }
    const sidA = sa ? (sa.studentId || '') : '';
    const sidB = sb ? (sb.studentId || '') : '';
    return sidA.localeCompare(sidB);
  }

  // 按考场+时间段分组
  const groups = new Map();
  const groupOrder = [];
  state.schedules.forEach(item => {
    const room = state.rooms.find(r => r.id === item.roomId);
    const roomName = room ? room.name : item.roomId;
    const key = `${roomName}_${item.examDate}_${item.timeSlot}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(item);
  });

  const sheetNames = [];
  const sheetHtmlList = [];
  const TITLE_MERGE_COLS = 12;

  groupOrder.forEach((key, groupIdx) => {
    const items = groups.get(key);
    const room = state.rooms.find(r => r.id === items[0].roomId);
    const roomNameRaw = room ? room.name : (items[0].roomId || '');
    const roomName = roomNameRaw || '待安排';
    const examDateRaw = items[0].examDate || '';
    const timeSlotRaw = items[0].timeSlot || '';
    const examDate = examDateRaw || '待安排';
    const timeSlot = timeSlotRaw || '待安排';
    const isListOnlyGroup = !examDateRaw && !timeSlotRaw && !roomNameRaw;

    // 该考场-时间段涉及的科目（去重）
    const subjectSet = new Set();
    items.forEach(it => {
      const sub = state.subjects.find(s => s.id === it.subjectId);
      subjectSet.add((sub ? `${sub.code} ${sub.name}` : it.subjectId) || '');
    });
    const subjectList = Array.from(subjectSet).join('、');

    let sheetName;
    if (isListOnlyGroup) {
      sheetName = `待安排_第${groupIdx + 1}组`;
    } else {
      sheetName = `${examDateRaw || '未排日'}_${roomName}_${timeSlotRaw || '未排时'}`.replace(/[:\\/?*\[\]]/g, '-');
    }
    if (sheetName.length > 31) sheetName = sheetName.slice(0, 31);
    sheetNames.push(sheetName);

    // 标题信息区（4行，跨12列）
    const titleRows = `
<tr><td colspan="${TITLE_MERGE_COLS}" style="font-size:18px;font-weight:bold;text-align:center;background:#fce4d6;padding:8px 0;">补考考场安排表</td></tr>
<tr>
  <td style="font-weight:bold;background:#f2f2f2;">考场序号</td>
  <td colspan="3">${isListOnlyGroup ? '未分配（仅名单模式）' : `第 ${groupIdx + 1} 考场`}</td>
  <td style="font-weight:bold;background:#f2f2f2;">考场名称</td>
  <td colspan="7">${escapeHtml(roomName)}（${isListOnlyGroup ? `共 ${items.length} 人` : `容量 ${room ? room.capacity : '-'} 人，本场 ${items.length} 人`}）</td>
</tr>
<tr>
  <td style="font-weight:bold;background:#f2f2f2;">考试时间</td>
  <td colspan="5">${escapeHtml(examDate)} ${isListOnlyGroup ? '' : escapeHtml(timeSlot)}</td>
  <td style="font-weight:bold;background:#f2f2f2;">考试科目</td>
  <td colspan="5">${escapeHtml(subjectList)}</td>
</tr>
<tr><td colspan="${TITLE_MERGE_COLS}" style="height:6px;border:none;"></td></tr>
`;

    // 列标题
    const headerRow = '<tr>' + ['序号','学号','姓名','校区','院系','专业','班级','科目代码','科目名称','考试日期','时间段','考场'].map(h => `<th style="background:#d0d0d0;font-weight:bold;">${escapeHtml(h)}</th>`).join('') + '</tr>';

    // 考场内考生按姓名拼音字母序排序
    const sortedItems = [...items].sort(cmpPinyinNameItem);

    // 数据行
    let bodyRows = '';
    sortedItems.forEach((item, idx) => {
      const student = state.students.find(s => s.id === item.studentId);
      const subject = state.subjects.find(s => s.id === item.subjectId);
      const cells = [
        idx + 1,
        student ? student.studentId : '',
        student ? student.name : '',
        student ? student.campus : '',
        student ? student.department : '',
        student ? student.major : '',
        student ? student.className : '',
        subject ? subject.code : '',
        subject ? subject.name : '',
        item.examDate || '待安排',
        item.timeSlot || '待安排',
        roomName
      ];
      bodyRows += '<tr>' + cells.map(c => `<td style="mso-number-format:'\\@';">${escapeHtml(c)}</td>`).join('') + '</tr>';
    });

    const table = `<table border="1" cellspacing="0" cellpadding="4" width="100%">${titleRows}${headerRow}${bodyRows}</table><br><br>`;
    sheetHtmlList.push(table);
  });

  let worksheetsXml = '';
  for (let i = 0; i < sheetNames.length; i++) {
    worksheetsXml += `<x:ExcelWorksheet><x:Name>${escapeXml(sheetNames[i])}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>`;
  }

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>${worksheetsXml}</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
</head>
<body>${sheetHtmlList.join('')}</body>
</html>`;
}

function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 时间段转化为 "2026-03-02 下午14:00-16:00" 样式；无时间则返回"待安排"（仅名单模式）
function formatExamTime(dateStr, slot) {
  const has = (dateStr && String(dateStr).trim()) || (slot && String(slot).trim());
  if (!has) return '待安排';
  if (!slot) return dateStr || '';
  const match = String(slot).match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
  if (!match) return `${dateStr || ''} ${slot}`;
  const startH = parseInt(match[1], 10);
  const period = startH < 12 ? '上午' : '下午';
  return `${dateStr || ''} ${period}${match[1]}-${match[2]}`;
}

function getExportListExcelHtml() {
  // 中文拼音排序比较器（按姓名拼音字母；同姓再按学号）
  const nameCollator = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true })
    : null;
  function cmpPinyinName(studentA, studentB) {
    const na = studentA ? (studentA.name || '') : '';
    const nb = studentB ? (studentB.name || '') : '';
    if (na !== nb) {
      if (nameCollator) return nameCollator.compare(na, nb);
      return na.localeCompare(nb, 'zh-CN');
    }
    const sa = studentA ? (studentA.studentId || '') : '';
    const sb = studentB ? (studentB.studentId || '') : '';
    return sa.localeCompare(sb);
  }

  const headers = ['学号', '姓名', '学生所在院系', '班级名称', '课程名称', '课程属性', '年级', '总学时', '学分', '上课教师', '考试时间', '考试地点'];
  const headerRow = '<tr>' + headers.map(h => `<th style="background:#d0d0d0;font-weight:bold;">${escapeHtml(h)}</th>`).join('') + '</tr>';

  // 学生名单：按姓氏拼音字母顺序（姓名→学号）排序
  const sorted = [...state.schedules].sort((a, b) => {
    const sa = state.students.find(s => s.id === a.studentId);
    const sb = state.students.find(s => s.id === b.studentId);
    const r = cmpPinyinName(sa, sb);
    if (r !== 0) return r;
    // 同一个人多门课，再按考试日期和科目名稳定排序
    if (a.examDate !== b.examDate) return (a.examDate || '').localeCompare(b.examDate || '');
    const subjA = state.subjects.find(x => x.id === a.subjectId);
    const subjB = state.subjects.find(x => x.id === b.subjectId);
    return (subjA ? subjA.name || '' : '').localeCompare(subjB ? subjB.name || '' : '', 'zh-CN');
  });

  let bodyRows = '';
  sorted.forEach((item) => {
    const student = state.students.find(s => s.id === item.studentId) || {};
    const subject = state.subjects.find(s => s.id === item.subjectId) || {};
    const room = state.rooms.find(r => r.id === item.roomId) || {};
    const enroll = student.enrollments && student.enrollments[item.subjectId] ? student.enrollments[item.subjectId] : {};

    const cells = [
      student.studentId || '',
      student.name || '',
      student.department || '',
      student.className || '',
      subject.name || '',
      enroll.courseAttr || '',
      enroll.grade || '',
      enroll.totalHours || '',
      enroll.credits || '',
      enroll.teacher || '',
      formatExamTime(item.examDate, item.timeSlot),
      (room.name || item.roomId || '待安排')
    ];
    bodyRows += '<tr>' + cells.map(c => `<td style="mso-number-format:'\\@';">${escapeHtml(c)}</td>`).join('') + '</tr>';
  });

  const sheetTables = `<table border="1" cellspacing="0" cellpadding="4">${headerRow}${bodyRows}</table><br><br>`;
  const sheetNames = ['补考安排名单'];

  let worksheetsXml = '';
  for (let i = 0; i < sheetNames.length; i++) {
    worksheetsXml += `<x:ExcelWorksheet><x:Name>${escapeXml(sheetNames[i])}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>`;
  }

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>${worksheetsXml}</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
</head>
<body>${sheetTables}</body>
</html>`;
}

function exportBackupData() {
  return {
    subjects: state.subjects,
    rooms: state.rooms,
    students: state.students,
    schedules: state.schedules,
    exportedAt: new Date().toISOString()
  };
}

function restoreBackupData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, msg: '备份文件内容为空或格式不正确' };
  }

  const nextSubjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  const nextRooms = Array.isArray(payload.rooms) ? payload.rooms : [];
  const nextStudents = Array.isArray(payload.students) ? payload.students : [];
  const nextSchedules = Array.isArray(payload.schedules) ? payload.schedules : [];

  state.subjects = nextSubjects;
  state.rooms = nextRooms;
  state.students = nextStudents;
  state.schedules = nextSchedules;

  return { ok: true, msg: `已恢复 ${nextStudents.length} 名学生、${nextSubjects.length} 个科目、${nextRooms.length} 个考场和 ${nextSchedules.length} 条排班记录` };
}

function serveHtml(res) {
  fs.readFile(FILE_PATH, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('读取前端文件失败');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(html);
  });
}

function handleApi(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/subject/list' && req.method === 'GET') {
    jsonResponse(res, 200, { code: 0, msg: 'success', data: state.subjects });
    return;
  }

  if (pathname === '/api/student/list' && req.method === 'GET') {
    jsonResponse(res, 200, { code: 0, msg: 'success', data: state.students });
    return;
  }

  if (pathname === '/api/room/list' && req.method === 'GET') {
    jsonResponse(res, 200, { code: 0, msg: 'success', data: state.rooms });
    return;
  }

  if (pathname === '/api/room/generate' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const regNum = Number(body.regularRoomNum || 0);
        const labNum = Number(body.labRoomNum || 0);
        const regCap = Number(body.regularCapacity || 50);
        const labCap = Number(body.labCapacity || 30);
        createRooms(regNum, labNum, regCap, labCap);
        jsonResponse(res, 200, { code: 0, msg: `已生成 ${regNum} 间普通教室（容量${regCap}人）和 ${labNum} 间机房（容量${labCap}人）`, data: state.rooms });
      } catch (error) {
        jsonResponse(res, 400, { code: 1, msg: '参数错误: ' + error.message, data: [] });
      }
    });
    return;
  }

  if (pathname === '/api/data/mock' && req.method === 'POST') {
    state.subjects = [
      { id: 'SUB1', code: 'MATH101', name: '高等数学', isLabRequired: false },
      { id: 'SUB2', code: 'ENG101', name: '大学英语', isLabRequired: false },
      { id: 'SUB3', code: 'CS101', name: '计算机基础', isLabRequired: true },
      { id: 'SUB4', code: 'CS201', name: '数据结构', isLabRequired: true },
      { id: 'SUB5', code: 'MATH201', name: '线性代数', isLabRequired: false },
      { id: 'SUB6', code: 'PHY102', name: '物理实验', isLabRequired: true }
    ];
    state.rooms = [
      { id: 'R1', name: '教室A101', type: 'regular', capacity: 50 },
      { id: 'R2', name: '教室A102', type: 'regular', capacity: 60 },
      { id: 'R3', name: '教室B201', type: 'regular', capacity: 45 },
      { id: 'R4', name: '机房C101', type: 'lab', capacity: 30 },
      { id: 'R5', name: '机房C102', type: 'lab', capacity: 35 },
      { id: 'R6', name: '机房C201', type: 'lab', capacity: 40 }
    ];
    state.students = [
      { id: 'S1', studentId: '2023001', name: '张三', campus: '南校区', department: '计算机学院', major: '软件工程', className: '软件2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB1', 'SUB3'], enrollments: { SUB1: { courseAttr: '必修', grade: '2021', totalHours: 48, credits: 3, teacher: '王老师' }, SUB3: { courseAttr: '必修', grade: '2021', totalHours: 40, credits: 2.5, teacher: '陈老师' } } },
      { id: 'S2', studentId: '2023002', name: '李四', campus: '南校区', department: '计算机学院', major: '软件工程', className: '软件2102', courseCollege: '', courseUnit: '', subjectIds: ['SUB2', 'SUB4'], enrollments: { SUB2: { courseAttr: '必修', grade: '2021', totalHours: 56, credits: 3.5, teacher: '赵老师' }, SUB4: { courseAttr: '必修', grade: '2021', totalHours: 64, credits: 4, teacher: '李老师' } } },
      { id: 'S3', studentId: '2023003', name: '王五', campus: '南校区', department: '数学学院', major: '应用数学', className: '数统2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB1', 'SUB5'], enrollments: { SUB1: { courseAttr: '必修', grade: '2021', totalHours: 48, credits: 3, teacher: '王老师' }, SUB5: { courseAttr: '选修', grade: '2021', totalHours: 32, credits: 2, teacher: '孙老师' } } },
      { id: 'S4', studentId: '2023004', name: '赵六', campus: '北校区', department: '物理学院', major: '物理学', className: '物理2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB3', 'SUB6'], enrollments: { SUB3: { courseAttr: '必修', grade: '2021', totalHours: 40, credits: 2.5, teacher: '陈老师' }, SUB6: { courseAttr: '选修', grade: '2021', totalHours: 48, credits: 3, teacher: '刘老师' } } }
    ];
    state.schedules = [];
    jsonResponse(res, 200, { code: 0, msg: '模拟数据已加载', data: state.students });
    return;
  }

  if (pathname === '/api/data/reset' && req.method === 'POST') {
    state.subjects = [];
    state.rooms = [];
    state.students = [];
    state.schedules = [];
    jsonResponse(res, 200, { code: 0, msg: '数据已清空', data: [] });
    return;
  }

  if (pathname === '/api/data/export' && req.method === 'GET') {
    jsonResponse(res, 200, { code: 0, msg: '备份导出成功', data: exportBackupData() });
    return;
  }

  if (pathname === '/api/data/restore' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const payload = raw ? JSON.parse(raw) : {};
        const result = restoreBackupData(payload);
        jsonResponse(res, result.ok ? 200 : 400, { code: result.ok ? 0 : 1, msg: result.msg, data: [] });
      } catch (error) {
        jsonResponse(res, 400, { code: 1, msg: '备份文件格式错误', data: [] });
      }
    });
    return;
  }

  if (pathname === '/api/student/importCsv' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', () => {
      jsonResponse(res, 500, { code: 1, msg: '上传请求读取失败', data: { count: 0 } });
    });
    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.includes('boundary=') ? `--${contentType.split('boundary=')[1]}` : null;

        let csvText = '';
        if (!boundary) {
          csvText = rawBody.toString('utf8');
        } else {
          const raw = rawBody.toString('utf8');
          const parts = raw.split(boundary).filter(p => p.includes('Content-Disposition'));
          parts.forEach(part => {
            const match = part.match(/name="csv"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/);
            if (match) {
              csvText = match[1].trim();
            }
          });
          csvText = csvText || raw;
        }

        // 去除UTF-8 BOM
        if (csvText.charCodeAt(0) === 0xFEFF) {
          csvText = csvText.slice(1);
        }

        const result = importStudentsFromCsv(csvText);
        jsonResponse(res, 200, { code: 0, msg: result.msg, data: { count: result.count } });
      } catch (error) {
        jsonResponse(res, 500, { code: 1, msg: '导入处理失败: ' + error.message, data: { count: 0 } });
      }
    });
    return;
  }

  if (pathname === '/api/schedule/generate' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const result = generateSchedulePayload(body);
        jsonResponse(res, 200, { code: result.ok ? 0 : 1, msg: result.msg, data: result.data || [] });
      } catch (error) {
        jsonResponse(res, 400, { code: 1, msg: '请求参数错误', data: [] });
      }
    });
    return;
  }

  if (pathname === '/api/schedule/count' && req.method === 'GET') {
    jsonResponse(res, 200, { code: 0, msg: 'success', data: state.schedules.length });
    return;
  }

  if (pathname === '/api/schedule/view' && req.method === 'GET') {
    const mode = Number(url.searchParams.get('mode') || '1');
    const data = getDataListByMode(mode);
    // #region debug-point A,E:schedule-view-probe
    (() => { try {
      const fsR = require('fs'); const pathR = require('path');
      const sample = []; const top = (data || []).slice(0, 3);
      top.forEach(it => {
        if (it && Array.isArray(it.items)) {
          it.items.slice(0, 3).forEach(sub => sample.push({
            k: it.key, d: sub.examDate, t: sub.timeSlot, r: sub.roomId, sub: sub.subjectId, stu: sub.studentId
          }));
        } else if (it) {
          sample.push({ d: it.examDate, t: it.timeSlot, r: it.roomId, sub: it.subjectId, stu: it.studentId });
        }
      });
      const schedAll = state && state.schedules ? state.schedules : [];
      const ev = {
        sessionId: 'schedule-time-blank', runId: 'pre', hypothesisId: 'A,E',
        location: 'server.js:902', msg: '[DEBUG] /api/schedule/view',
        data: { mode, total: schedAll.length, emptySlot: schedAll.filter(s => !(s && s.timeSlot)).length, groups: Array.isArray(data) ? data.length : 0, sample }
      };
      fsR.appendFileSync(pathR.join(__dirname, '.dbg', 'trae-debug-log-schedule-time-blank.ndjson'), JSON.stringify(ev) + '\n');
    } catch (_) {} })();
    // #endregion
    jsonResponse(res, 200, { code: 0, msg: 'success', listOnlyMode: state.lastGenerateMode === 'listOnly', data });
    return;
  }

  if (pathname === '/api/schedule/exportCsv' && req.method === 'GET') {
    const bom = '\uFEFF';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="exam_schedule.csv"',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(bom + getExportCsv());
    return;
  }

  if (pathname === '/api/schedule/exportExcel' && req.method === 'GET') {
    const html = getExportExcelHtml();
    const bom = '\uFEFF';
    const buf = Buffer.from(bom + html, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="exam_schedule_by_room.xls"; filename*=UTF-8''${encodeURIComponent('exam_schedule_考场分表.xls')}`,
      'Content-Length': buf.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buf);
    return;
  }

  if (pathname === '/api/schedule/exportList' && req.method === 'GET') {
    const html = getExportListExcelHtml();
    const bom = '\uFEFF';
    const buf = Buffer.from(bom + html, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="exam_schedule_list.xls"; filename*=UTF-8''${encodeURIComponent('exam_schedule_学生名单.xls')}`,
      'Content-Length': buf.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buf);
    return;
  }

  jsonResponse(res, 404, { code: 404, msg: '接口不存在', data: [] });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/' || url.pathname === '/ExamSchedule.html') {
    serveHtml(res);
    return;
  }

  // 静态文件服务
  if (url.pathname === '/tailwind.js') {
    fs.readFile(path.join(__dirname, 'tailwind.js'), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }

  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Exam Schedule service is running on http://localhost:${PORT}`);
});
