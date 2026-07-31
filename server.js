const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8080;
const FILE_PATH = path.join(__dirname, 'ExamSchedule.html');

const defaultSubjects = [
  { id: 'SUB1', code: 'MATH101', name: '高等数学', isLabRequired: false },
  { id: 'SUB2', code: 'ENG101', name: '大学英语', isLabRequired: false },
  { id: 'SUB3', code: 'CS101', name: '计算机基础', isLabRequired: true },
  { id: 'SUB4', code: 'CS201', name: '数据结构', isLabRequired: true },
  { id: 'SUB5', code: 'MATH201', name: '线性代数', isLabRequired: false },
  { id: 'SUB6', code: 'PHY102', name: '物理实验', isLabRequired: true }
];

const defaultRooms = [
  { id: 'R1', name: '教室A101', type: 'regular', capacity: 50 },
  { id: 'R2', name: '教室A102', type: 'regular', capacity: 60 },
  { id: 'R3', name: '教室B201', type: 'regular', capacity: 45 },
  { id: 'R4', name: '机房C101', type: 'lab', capacity: 30 },
  { id: 'R5', name: '机房C102', type: 'lab', capacity: 35 },
  { id: 'R6', name: '机房C201', type: 'lab', capacity: 40 }
];

const state = {
  subjects: [...defaultSubjects],
  rooms: [...defaultRooms],
  students: [],
  schedules: []
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

function importStudentsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { count: 0, msg: 'CSV为空' };
  }

  const subjectCodeMap = makeSubjectCodeMap();
  const studentMap = new Map();
  let addedSubjects = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 9) continue;

    const [studentId, name, campus, department, major, className, courseCode, courseName, isLabExamStr] = row;
    if (!studentId || !name) continue;

    let subjectId = subjectCodeMap.get(courseCode);
    if (!subjectId) {
      const existing = state.subjects.find(sub => sub.code === courseCode || sub.name === courseName);
      if (existing) {
        subjectId = existing.id;
      } else {
        const newSubject = {
          id: `SUB${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          code: courseCode || `SUB${state.subjects.length + 1}`,
          name: courseName || '新增补考科目',
          isLabRequired: /1|yes|true/i.test(String(isLabExamStr))
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
        courseCollege: '',
        courseUnit: '',
        subjectIds: []
      });
    }

    const student = studentMap.get(studentId);
    if (subjectId && !student.subjectIds.includes(subjectId)) {
      student.subjectIds.push(subjectId);
    }
  }

  state.students = Array.from(studentMap.values());
  return { count: state.students.length, addedSubjects, msg: `成功导入 ${state.students.length} 名学生` };
}

function createRooms(regularRoomNum, labRoomNum) {
  const generated = [];
  for (let i = 1; i <= regularRoomNum; i += 1) {
    generated.push({ id: `R${i}`, name: `普通教室${i}`, type: 'regular', capacity: 50 });
  }
  for (let i = 1; i <= labRoomNum; i += 1) {
    generated.push({ id: `L${i}`, name: `机房${i}`, type: 'lab', capacity: 30 });
  }
  state.rooms = generated;
}

function generateSchedulePayload({ startDate, slotPerDay, regularRoomNum, labRoomNum }) {
  if (!startDate) {
    return { ok: false, msg: '请选择考试起始日期' };
  }
  if (state.students.length === 0) {
    return { ok: false, msg: '请先导入学生数据' };
  }

  createRooms(Number(regularRoomNum || 3), Number(labRoomNum || 2));

  const effectiveSlots = timeSlots.slice(0, Number(slotPerDay || 2));
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

  let slotIndex = 0;
  for (const { subject } of subjectOrder) {
    const assignedStudents = studentBySubject.get(subject.id) || [];
    if (assignedStudents.length === 0) continue;

    const roomType = subject.isLabRequired ? 'lab' : 'regular';
    const availableRooms = state.rooms.filter(room => room.type === roomType);
    if (availableRooms.length === 0) {
      continue;
    }

    const roomCapacity = availableRooms[0].capacity;
    let currentDate = startDate;
    let cursor = 0;
    const studentsToAssign = [...assignedStudents];

    while (cursor < studentsToAssign.length) {
      const currentSlot = effectiveSlots[slotIndex % effectiveSlots.length];
      currentDate = addDays(startDate, Math.floor(slotIndex / effectiveSlots.length));
      const room = availableRooms[Math.floor(cursor / roomCapacity) % availableRooms.length] || availableRooms[0];
      const currentStudent = studentsToAssign[cursor];
      const examKey = `${currentStudent.studentId}_${subject.id}`;

      if (!studentExamKey.get(examKey)) {
        const entry = {
          id: `SCH${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          studentId: currentStudent.id,
          subjectId: subject.id,
          roomId: room.id,
          timeSlot: currentSlot,
          examDate: currentDate
        };
        scheduleEntries.push(entry);
        studentExamKey.set(examKey, true);
      }
      cursor += 1;
      slotIndex += 1;
    }
  }

  state.schedules = scheduleEntries;
  return { ok: true, msg: `成功生成 ${scheduleEntries.length} 条排考记录`, data: scheduleEntries };
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

  if (pathname === '/api/data/mock' && req.method === 'POST') {
    state.subjects = [...defaultSubjects];
    state.rooms = [...defaultRooms];
    state.students = [
      { id: 'S1', studentId: '2023001', name: '张三', campus: '南校区', department: '计算机学院', major: '软件工程', className: '软件2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB1', 'SUB3'] },
      { id: 'S2', studentId: '2023002', name: '李四', campus: '南校区', department: '计算机学院', major: '软件工程', className: '软件2102', courseCollege: '', courseUnit: '', subjectIds: ['SUB2', 'SUB4'] },
      { id: 'S3', studentId: '2023003', name: '王五', campus: '南校区', department: '数学学院', major: '应用数学', className: '数统2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB1', 'SUB5'] },
      { id: 'S4', studentId: '2023004', name: '赵六', campus: '北校区', department: '物理学院', major: '物理学', className: '物理2101', courseCollege: '', courseUnit: '', subjectIds: ['SUB3', 'SUB6'] }
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
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundary = contentType.includes('boundary=') ? `--${contentType.split('boundary=')[1]}` : null;

      if (!boundary) {
        const text = rawBody.toString('utf8');
        const result = importStudentsFromCsv(text);
        jsonResponse(res, 200, { code: 0, msg: result.msg, data: { count: result.count } });
        return;
      }

      const raw = rawBody.toString('utf8');
      const parts = raw.split(boundary).filter(p => p.includes('Content-Disposition'));
      let csvText = '';
      parts.forEach(part => {
        const match = part.match(/name="csv"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n$/);
        if (match) {
          csvText = match[1].trim();
        }
      });

      const result = importStudentsFromCsv(csvText || raw);
      jsonResponse(res, 200, { code: 0, msg: result.msg, data: { count: result.count } });
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

  if (pathname === '/api/schedule/view' && req.method === 'GET') {
    const mode = Number(url.searchParams.get('mode') || '1');
    jsonResponse(res, 200, { code: 0, msg: 'success', data: getDataListByMode(mode) });
    return;
  }

  if (pathname === '/api/schedule/exportCsv' && req.method === 'GET') {
    sendCsv(res, getExportCsv());
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
