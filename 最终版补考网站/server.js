const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// exceljs：纯 JS 库，生成原生 .xlsx，支持多个 Sheet。仅在导出 /api/schedule/exportList 时用到，require 会在第一次调用时才真正加载。
let ExcelJS = null;
function getExcelJS() {
  if (!ExcelJS) ExcelJS = require('exceljs');
  return ExcelJS;
}

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
  '16:30-18:30',
  '19:00-21:00'
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
  state.subjects.forEach(subject => {
    // 同时按课程代码和课程名称建立索引：代码列缺失时可按名称区分科目，避免所有课被合并成一科
    if (subject.code) map.set('C:' + subject.code, subject.id);
    if (subject.name) map.set('N:' + subject.name, subject.id);
  });
  return map;
}

/**
 * 把 Excel 科学计数法格式的字符串还原成完整的纯数字串。
 * 例: "2.03E+11" → "203000000000"; "1.30213E+06" → "1302130"
 * 仅当完整匹配科学计数法正则时才转换；带字母/横线/中文的纯文本字段原样返回。
 * 用纯字符串操作，避免 Number/BigInt 精度丢失。
 */
function normalizeScientificNotation(val) {
  if (val === null || val === undefined) return val;
  const s = String(val).trim();
  if (!s) return s;
  const m = s.match(/^([+-]?)(\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (!m) return s; // 不是科学计数法，原样返回
  const sign = m[1];
  const mantissa = m[2];
  const exp = parseInt(m[3], 10);
  let [intPart, decPart = ''] = mantissa.split('.');
  intPart = intPart || '0';
  const decLen = decPart.length;
  let result;
  if (exp >= decLen) {
    // 指数 ≥ 小数位数：直接补 0
    const raw = sign + intPart + decPart + '0'.repeat(exp - decLen);
    result = raw.replace(/^(-?)0+(?=\d)/, '$1') || '0';
  } else {
    // 指数 < 小数位数：插入小数点
    const combined = intPart + decPart;
    const dotPos = intPart.length + exp;
    if (dotPos <= 0) {
      result = sign + '0.' + '0'.repeat(-dotPos) + combined;
    } else {
      result = sign + combined.slice(0, dotPos) + '.' + combined.slice(dotPos);
    }
  }
  // 去掉整数归一化后多余的 ".0000" 结尾（如 1302130.0000 → 1302130），但保留真实小数（如 0.05）
  if (result.includes('.')) {
    result = result.replace(/\.0+$/, '');
    if (result.endsWith('.')) result = result.slice(0, -1);
  }
  return result || '0';
}

// 表头别名映射：支持多种常见中文表头
// 【重要别名设计原则】：
//   1. 标准列名必须包含（StudentID/学号 等）
//   2. 同义标准写法必须包含（学生学号 = 学号的同义正式写法）
//   3. 只收录「语义完全等同于该字段」的列名，禁止收录「列名+后缀」的泛化写法（如「学号备注」≠ 学号，不要把「备注」相关词加进去）
const HEADER_ALIASES = {
  studentId: ['学号', 'StudentID', '学生学号', '学生ID', '学生编号', '学生证号', '学籍号', '学籍编号'],
  name: ['姓名', 'Name', '学生姓名', '考生姓名', '真实姓名'],
  campus: ['校区', 'Campus', '所在校区', '就读校区'],
  department: ['学生所在院系', '学生所在院', '院系', 'Department', '学院', '学生所在学院', '所属院系', '二级学院'],
  major: ['专业', 'Major', '所学专业', '专业名称'],
  className: ['班级名称', '班级', 'ClassName', '行政班', '班号', '行政班级', '班级代码', 'Class', 'class', '班级编号', '所在班级', '教学班'],
  courseCollege: ['开课学院', 'CourseCollege', '课程归属学院'],
  courseUnit: ['开课单位', 'CourseUnit', '开课部门'],
  courseCode: ['课程编号', 'CourseCode', '课程代码', '课号', '课程编码', '课程号', '课程代号', '课程代码号'],
  courseName: ['课程名称', 'CourseName', '科目名称', '课程名', '科目名', '考试科目'],
  courseAttr: ['课程属性', 'CourseAttr', '课程性质'],
  grade: ['年级', 'Grade', '入学年级'],
  totalHours: ['总学时', 'TotalHours', '学时'],
  credits: ['学分', 'Credits', '课程学分'],
  originalScore: ['原始成绩', 'OriginalScore', '考试成绩', '补考成绩', '卷面成绩'],
  scoreFlag: ['成绩标志', 'ScoreFlag', '成绩标记'],
  teacher: ['上课教师', '教师', 'Teacher', '任课教师', '授课教师'],
  isLabExam: ['是否机考', 'IsLabExam', '机考', '考试方式', '考试形式', '是否上机']
};

function buildHeaderIndex(headerRow) {
  const map = {};
  const usedIdx = new Set(); // 已被占用的表头列索引：防止同一个"院"先匹配 department 后又被 courseCollege 覆盖
  const headers = parseCsvLine(headerRow).map(h => h.trim().toLowerCase());
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const lowerAliases = aliases.map(a => a.toLowerCase());
    // 阶段1: 大小写不敏感的精确匹配（解决 99% 的大小写变体问题，如 name/Name/STUDENTID）
    let idx = headers.findIndex((h, i) => !usedIdx.has(i) && lowerAliases.some(a => h === a));
    // 阶段2: 仅对含非 ASCII（中文）的别名启用「单向包含匹配」：仅当「别名 包含 表头」时匹配
    //   ✅ 安全场景（别名更长，用户写简称）：别名='学生所在院系' 包含 表头='学生所在院' → 匹配
    //   ❌ 禁止场景（表头更长，是别名+后缀）：表头='学号备注' 包含 别名='学号' → 以前误匹配，现在拒绝
    //   ❌ 禁止场景（表头是别名的上级概念）：表头='班级信息' 包含 别名='班级' → 拒绝
    //   ❌ 禁止场景（短表头被语义无关别名意外包含）：表头='院' 被 courseCollege 别名 '开课学院' 包含 → 长度差>2 拒绝
    //   注：若用户写更长但语义相同的表头（如「学生学号」=「学号」的同义正式写法），会在阶段1精确匹配命中，因为「学生学号」本身就在 aliases 里
    if (idx < 0) {
      const chineseAliases = lowerAliases.filter(a => /[^\x00-\x7F]/.test(a));
      idx = headers.findIndex((h, i) => {
        if (usedIdx.has(i) || !h) return false;
        return chineseAliases.some(a => {
          if (!a.includes(h)) return false;
          // 对短表头（≤2字）额外要求：别名长度 - 表头长度 ≤ 2，防止"院"被"开课学院""课程归属学院"等无关别名跨语义命中
          if (h.length <= 2 && (a.length - h.length) > 2) return false;
          return true;
        });
      });
    }
    if (idx >= 0) {
      map[field] = idx;
      usedIdx.add(idx);
    }
  }
  return map;
}

function importStudentsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { count: 0, addedSubjects: 0, msg: 'CSV为空' };
  }

  // 解析表头（并记录未识别的必需字段，用于错误诊断）
  const headerMap = buildHeaderIndex(lines[0]);
  const rawHeaders = parseCsvLine(lines[0]).map(h => h.trim());
  const REQUIRED_FIELDS = ['studentId', 'name'];
  const missingRequired = REQUIRED_FIELDS.filter(f => headerMap[f] === undefined);
  const get = (row, field) => (headerMap[field] !== undefined ? row[headerMap[field]] || '' : '');

  const subjectCodeMap = makeSubjectCodeMap();
  // 去重 key：「学号 + 姓名 + 班级」三者组合（抗学号科学计数法丢精度导致全员相同的情况）
  //   - 若学号不重复（正常情况），组合key等同于学号，同一个学生多门课自动合并
  //   - 若学号重复（Excel科学计数法Bug），则通过姓名/班级进一步区分，避免6个学生合并成1个
  const studentMap = new Map();
  let addedSubjects = 0;
  // ==== 诊断计数器 ====
  let dataRowCount = 0;           // 实际数据行数量（除表头外）
  let rowBadColumnCount = 0;     // 因列数太少跳过
  let rowMissingStudentId = 0;   // 因学号为空跳过
  let rowMissingName = 0;        // 因姓名为空跳过
  // rawIdToSigs: 原始学号 -> Set(姓名|班级) —— 用于判断"同一个学号是否对应了多个不同学生"
  const rawIdToSigs = new Map();
  const processedRows = [];

  // --- 第1遍：预处理行 + 聚合每个学号下出现过的（姓名|班级）签名 ---
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    dataRowCount += 1;
    if (row.length < 2) { rowBadColumnCount += 1; continue; }

    // 学号 / 课程编号 这类"看起来是纯整数但被Excel用科学计数法保存"的字段，先还原成完整数字串
    // （用严格正则匹配，带字母/横线/中文的纯文本字段不会被误改）
    const studentId = normalizeScientificNotation(get(row, 'studentId'));
    const name = get(row, 'name');
    if (!studentId && name) { rowMissingStudentId += 1; continue; }
    if (studentId && !name) { rowMissingName += 1; continue; }
    if (!studentId || !name) { rowMissingStudentId += 1; rowMissingName += 1; continue; }

    const className = get(row, 'className');
    const sig = `${name}|${className}`;
    if (!rawIdToSigs.has(studentId)) rawIdToSigs.set(studentId, new Set());
    rawIdToSigs.get(studentId).add(sig);
    processedRows.push({ row, studentId, name, className, key: `${studentId}||${name}||${className}` });
  }

  // --- 计算三层清晰的冲突指标 ---
  // 1) conflictingIdCount: 有多少个"独立学号"被多个不同学生共享（sigs.size>1）
  //    典型：Excel把全部学号科学计数法变成"2.03E+11" → 只有 1~2 个冲突学号值
  // 2) conflictingIds: 具体哪些学号存在冲突（方便后续统计）
  const conflictingIds = new Set();
  for (const [id, sigs] of rawIdToSigs.entries()) {
    if (sigs.size > 1) conflictingIds.add(id);
  }
  const conflictingIdCount = conflictingIds.size;
  // 3) affectedRows: 原始CSV中，属于"冲突学号"的行数量
  let affectedRows = 0;
  for (const entry of processedRows) {
    if (conflictingIds.has(entry.studentId)) affectedRows += 1;
  }
  // (affectedStudentCount 在学生Map构建完后统计：去重后有多少学生学号属于冲突集合)

  for (const entry of processedRows) {
    const { row, studentId, name, className, key } = entry;
    // 取值
    const campus = get(row, 'campus');
    const department = get(row, 'department');
    const major = get(row, 'major');
    const courseCollege = get(row, 'courseCollege');
    const courseUnit = get(row, 'courseUnit');
    const courseCode = normalizeScientificNotation(get(row, 'courseCode'));
    const courseName = get(row, 'courseName');
    const isLabExamStr = get(row, 'isLabExam');
    const courseAttr = get(row, 'courseAttr');
    const grade = get(row, 'grade');
    const totalHours = get(row, 'totalHours');
    const credits = get(row, 'credits');
    const teacher = get(row, 'teacher');

    // 科目去重键：优先课程代码；代码缺失时退回课程名称。
    //   关键：绝不能让"空课程代码"成为统一的去重键，否则所有课程会被错误合并成同一科。
    const subjKey = courseCode ? ('C:' + courseCode) : (courseName ? ('N:' + courseName) : 'N:__未命名科目__');
    let subjectId = subjectCodeMap.get(subjKey);
    if (!subjectId) {
      const existing = state.subjects.find(sub =>
        (courseCode && sub.code === courseCode) ||
        (!courseCode && courseName && sub.name === courseName)
      );
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
      subjectCodeMap.set(subjKey, subjectId);
    }

    if (!studentMap.has(key)) {
      studentMap.set(key, {
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

    const student = studentMap.get(key);
    if (subjectId && !student.subjectIds.includes(subjectId)) {
      student.subjectIds.push(subjectId);
    }
    if (subjectId) {
      student.enrollments[subjectId] = { courseAttr, grade, totalHours, credits, teacher };
    }
  }

  state.students = Array.from(studentMap.values());
  // 4) affectedStudentCount: 去重后学生里，学号属于冲突集合的人数（一定<=count，不会倒挂）
  let affectedStudentCount = 0;
  for (const s of state.students) {
    if (conflictingIds.has(s.studentId)) affectedStudentCount += 1;
  }

  // ==== 新增：三层去重诊断（用户看到「660行→2人」时可以立刻明白问题出在哪）====
  // 5) recognizedFields: 系统期望的字段（HEADER_ALIASES 的键）有哪些被 CSV 表头匹配到了
  const recognizedFields = Object.keys(HEADER_ALIASES).filter(f => headerMap[f] !== undefined);
  // 6) unmappedHeaders: CSV 里有哪些实际表头没有被任何系统字段匹配（可能是用户打错了别名，如「行政班级」误写为「行政级」）
  const mappedHeaderIdxs = new Set(Object.values(headerMap));
  const unmappedHeaders = rawHeaders.filter((_, i) => !mappedHeaderIdxs.has(i));
  // 7) uniqueKeyStats: 唯一学号/姓名/班级数量，以及「每行重复学生程度」的分布统计
  const uniqueStudentIdsSet = new Set();
  const uniqueNamesSet = new Set();
  const uniqueClassesSet = new Set();
  const keyCounts = new Map();   // 去重键 -> CSV里出现次数（同一个学生几门课）
  for (const entry of processedRows) {
    uniqueStudentIdsSet.add(entry.studentId);
    uniqueNamesSet.add(entry.name);
    uniqueClassesSet.add(entry.className || '（空）');
    keyCounts.set(entry.key, (keyCounts.get(entry.key) || 0) + 1);
  }
  let rowsPerKeyMax = 0;
  let rowsPerKeySum = 0;
  for (const c of keyCounts.values()) { rowsPerKeySum += c; if (c > rowsPerKeyMax) rowsPerKeyMax = c; }
  const rowsPerKeyMean = keyCounts.size > 0 ? (rowsPerKeySum / keyCounts.size) : 0;
  const uniqueKeyStats = {
    uniqueStudentIds: uniqueStudentIdsSet.size,
    uniqueNames: uniqueNamesSet.size,
    uniqueClasses: uniqueClassesSet.size,
    uniqueKeys: keyCounts.size,                // 「学号+姓名+班级」组合去重后的学生数（== count）
    rowsPerKeyMean: Number(rowsPerKeyMean.toFixed(2)),
    rowsPerKeyMax
  };

  // ==== 组装结果消息：导入 0 人时提供针对性诊断 ====
  let msg;
  if (state.students.length === 0) {
    const parts = [`成功导入 0 名学生（数据行 ${dataRowCount} 行）`];
    if (missingRequired.length > 0) {
      const aliasHint = {
        studentId: '学号 / StudentID / 学生学号',
        name: '姓名 / Name / 学生姓名'
      };
      parts.push(`⚠ 表头未识别: ${missingRequired.map(f => `${f}（期望列名：${aliasHint[f] || f}）`).join('、')}`);
      parts.push(`👉 CSV实际表头: ${rawHeaders.join(' | ')}`);
      parts.push('请检查第一行表头是否拼写正确、大小写(已自动兼容)、或是否从Excel另存为CSV时丢失了列名。参考：StudentID,Name,Campus,Department,Major,ClassName,CourseCode,CourseName,是否机考');
    } else {
      if (rowBadColumnCount > 0) parts.push(`列数不足行: ${rowBadColumnCount}`);
      if (rowMissingStudentId > 0) parts.push(`学号为空行: ${rowMissingStudentId}`);
      if (rowMissingName > 0) parts.push(`姓名为空行: ${rowMissingName}`);
      if (dataRowCount === 0) parts.push('CSV只有表头行，没有数据行');
      if (parts.length === 1) parts.push('请检查数据行是否确实包含学号和姓名。');
    }
    msg = parts.join('\n');
  } else {
    msg = `成功导入 ${state.students.length} 名学生（共 ${dataRowCount} 行数据）${addedSubjects ? `，新增 ${addedSubjects} 个科目` : ''}`;
    // 关键：当「学生数 << CSV行数」（比如660行->2人）时，把唯一值分布和未识别字段说清楚，用户一眼能定位原因
    const COUNT_GAP_RATIO = 3;  // 行数 / 学生数 > 3 时视为"差距过大"
    if (dataRowCount / Math.max(state.students.length, 1) > COUNT_GAP_RATIO) {
      const stat = uniqueKeyStats;
      msg += `\n📊 分布：CSV共${dataRowCount}行 → 合并为${state.students.length}人（平均每人${stat.rowsPerKeyMean}条记录，最高${stat.rowsPerKeyMax}条）`;
      msg += `\n🔍 唯一值数：学号${stat.uniqueStudentIds} / 姓名${stat.uniqueNames} / 班级${stat.uniqueClasses}`;
      if (unmappedHeaders.length > 0) {
        msg += `\n⚠ 以下CSV列未被系统识别（请检查表头名）：${unmappedHeaders.join('、')}`;
        msg += `\n👉 已识别的系统字段：${recognizedFields.join('、')}`;
      }
      if (stat.uniqueStudentIds < Math.min(dataRowCount, 50) && stat.rowsPerKeyMax > 10) {
        msg += `\n💡 提示：唯一学号数(${stat.uniqueStudentIds})明显偏少，极可能是Excel将长学号以科学计数法(如2.03E+11)保存丢失精度 → 解决：Excel中选中学号列→右键→设置单元格格式→文本→重新另存CSV。`;
      }
    }
  }

  return {
    count: state.students.length,
    addedSubjects,
    msg,
    // 附加诊断信息，前端可选择性展示
    diagnostic: {
      dataRowCount,
      missingRequired,
      actualHeaders: rawHeaders,
      rowBadColumnCount,
      rowMissingStudentId,
      rowMissingName,
      // 学号冲突三层指标（语义清晰，不会出现人数倒挂）
      conflictingIdCount,      // 存在冲突的独立学号个数（例：2.03E+11/2.04E+11 → 2）
      affectedStudentCount,    // 受影响的去重后学生数（<=count）
      affectedRows,            // 受影响的CSV数据行数（<=dataRowCount）
      // 新增：表头匹配状态（让用户知道「行政班/班号」等是否被识别到了）
      recognizedFields,        // 例: ['studentId','name','className','courseCode'...]
      unmappedHeaders,         // 例: ['备注'] 或 空数组
      // 新增：去重分布统计（为什么 660 行变成 2 人——一眼看穿）
      uniqueKeyStats
    }
  };
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

function generateSchedulePayload(params) {
  const { confirmationToken, ...options } = params;
  for (const name of ['regularRoomNum', 'labRoomNum', 'regularCapacity', 'labCapacity', 'maxSubjectsPerRoomSlot']) {
    const value = Number(options[name] || 0);
    if (!Number.isSafeInteger(value) || value < 0) {
      return { ok: false, msg: '教室数量、容量和每场科目数必须为非负整数，请检查设置' };
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate || '') ||
      !Number.isFinite(Date.parse(options.startDate)) ||
      new Date(options.startDate).toISOString().slice(0, 10) !== options.startDate) {
    return { ok: false, msg: '请选择有效的考试起始日期' };
  }
  if (options.customSlots !== undefined && (!Array.isArray(options.customSlots) || options.customSlots.length < 1 || options.customSlots.length > 20)) {
    return { ok: false, msg: '请设置 1 至 20 个考试时间段' };
  }
  const before = { rooms: state.rooms, schedules: state.schedules, lastGenerateMode: state.lastGenerateMode };
  // 确认仅对本次设置和当前数据有效；数据变化时必须重新展示提示。
  const token = require('crypto').createHash('sha256').update(JSON.stringify({ options, state })).digest('hex');
  let result, candidate;
  try {
    result = generateScheduleCandidate(options);
    candidate = { rooms: state.rooms, schedules: state.schedules, lastGenerateMode: state.lastGenerateMode };
  } finally {
    Object.assign(state, before);
  }
  if (!result.ok) return result;

  const warnings = [];
  const listOnly = candidate.lastGenerateMode === 'listOnly';
  if (listOnly) warnings.push('未设置考场：继续将仅安排考试时间，不分配考场，也不校验考场容量。');
  for (const [type, countKey, capKey, label, defaultCap] of [
    ['regular', 'regularRoomNum', 'regularCapacity', '普通教室', 50],
    ['lab', 'labRoomNum', 'labCapacity', '机房', 30]
  ]) {
    if (!listOnly && candidate.rooms.some(r => r.type === type)) {
      if (!Number(options[countKey])) warnings.push(`存在需要${label}的考试，但未设置该类考场：继续将自动补充 1 间${label}。`);
      if (!Number(options[capKey])) warnings.push(`${label}容量未填写或为 0：继续将采用每间 ${defaultCap} 人。`);
    }
  }

  const expected = new Set();
  const subjectIds = new Set(state.subjects.map(s => s.id));
  for (const student of state.students) {
    for (const subjectId of student.subjectIds || []) {
      if (!subjectIds.has(subjectId)) return { ok: false, msg: `学生 ${student.studentId || student.id} 的考试科目不存在，请修正数据后重试` };
      expected.add(JSON.stringify([student.id, subjectId]));
    }
  }
  const actual = new Set(), studentSlots = new Set(), roomCounts = new Map(), roomSubjects = new Map(), subjectSlots = new Map();
  for (const item of candidate.schedules) {
    const examKey = JSON.stringify([item.studentId, item.subjectId]);
    const studentSlot = JSON.stringify([item.studentId, item.examDate, item.timeSlot]);
    if (!expected.has(examKey) || actual.has(examKey) || studentSlots.has(studentSlot)) {
      return { ok: false, msg: '排考结果存在重复考试或同一学生时间冲突，已停止生成，原排班保持不变。请调整设置后重试。' };
    }
    actual.add(examKey); studentSlots.add(studentSlot);
    const slot = JSON.stringify([item.examDate, item.timeSlot]);
    if (!subjectSlots.has(item.subjectId)) subjectSlots.set(item.subjectId, new Set());
    subjectSlots.get(item.subjectId).add(slot);
    if (!listOnly) {
      const room = candidate.rooms.find(r => r.id === item.roomId);
      const subject = state.subjects.find(s => s.id === item.subjectId);
      const key = JSON.stringify([item.roomId, item.examDate, item.timeSlot]);
      roomCounts.set(key, (roomCounts.get(key) || 0) + 1);
      if (!roomSubjects.has(key)) roomSubjects.set(key, new Set());
      roomSubjects.get(key).add(item.subjectId);
      if (!room || room.type !== (subject.isLabRequired ? 'lab' : 'regular') || roomCounts.get(key) > room.capacity ||
          (Number(options.maxSubjectsPerRoomSlot) > 0 && roomSubjects.get(key).size > Number(options.maxSubjectsPerRoomSlot))) {
        return { ok: false, msg: '考场类型、容量或每场科目数约束无法满足，已停止生成，原排班保持不变。请调整设置后重试。' };
      }
    }
  }
  if (actual.size !== expected.size || actual.size === 0) {
    return { ok: false, msg: `应排 ${expected.size} 人次，实际可排 ${actual.size} 人次，未能完整排考。已停止生成，原排班保持不变，请增加考场或可用时段后重试。` };
  }
  for (const subject of state.subjects) {
    const count = (subjectSlots.get(subject.id) || { size: 0 }).size;
    if (count > 1) {
      const people = state.students.filter(s => (s.subjectIds || []).includes(subject.id)).length;
      const capacity = candidate.rooms.filter(r => r.type === (subject.isLabRequired ? 'lab' : 'regular')).reduce((sum, r) => sum + r.capacity, 0);
      warnings.push(`科目「${subject.name || subject.code || subject.id}」共 ${people} 人，该类考场每时段总容量 ${capacity} 人，无法在同一时段完成；继续将拆为 ${count} 个考试时段（可能跨天）。可取消并增加考场数量或容量。`);
    }
  }
  if (warnings.length && confirmationToken !== token) {
    return { ok: false, requiresConfirmation: true, confirmationToken: token, warnings, msg: '发现以下需要确认的排考安排，取消将保留原排班，继续将按提示生成。' };
  }
  Object.assign(state, candidate);
  return { ...result, warnings };
}

function generateScheduleCandidate({ startDate, slotPerDay, regularRoomNum, labRoomNum, regularCapacity, labCapacity, customSlots, maxSubjectsPerRoomSlot }) {
  // 逐项校验，不能静默删除用户填写的时段。
  if (Array.isArray(customSlots)) {
    const invalidIndex = customSlots.findIndex(slot => !normalizeSlot(slot));
    if (invalidIndex !== -1) {
      return { ok: false, msg: `第 ${invalidIndex + 1} 个时间段格式无效，请使用 HH:MM-HH:MM，且结束时间晚于开始时间` };
    }
    const normalized = customSlots.map(normalizeSlot);
    if (new Set(normalized).size !== normalized.length) {
      return { ok: false, msg: '考试时间段不能重复，请检查设置' };
    }
    // 规范化后的 HH:MM 可直接比较；首尾相接允许，实际重叠必须拒绝。
    for (let i = 0; i < normalized.length; i += 1) {
      const [startA, endA] = normalized[i].split('-');
      for (let j = i + 1; j < normalized.length; j += 1) {
        const [startB, endB] = normalized[j].split('-');
        if (startA < endB && startB < endA) {
          return { ok: false, msg: `第 ${i + 1} 个时间段（${normalized[i]}）与第 ${j + 1} 个时间段（${normalized[j]}）重叠，请调整后重新生成` };
        }
      }
    }
  }
  // 每个考场每场最多容纳的科目数（Infinity 表示不限制）
  const maxSubjects = Number(maxSubjectsPerRoomSlot) > 0 ? Math.floor(Number(maxSubjectsPerRoomSlot)) : Infinity;
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

  // 仅在确实存在该类型考试科目且用户未填写数量时才兜底为1，避免凭空多出未使用的考场
  const hasRegularSubject = state.subjects.some(sub =>
    !sub.isLabRequired && state.students.some(st => (st.subjectIds || []).includes(sub.id))
  );
  const hasLabSubject = state.subjects.some(sub =>
    sub.isLabRequired && state.students.some(st => (st.subjectIds || []).includes(sub.id))
  );
  createRooms(
    Number(regularRoomNum) > 0 ? Number(regularRoomNum) : (hasRegularSubject ? 1 : 0),
    Number(labRoomNum) > 0 ? Number(labRoomNum) : (hasLabSubject ? 1 : 0),
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
      const key = `${student.id}_${subjectId}`;
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
  // 跟踪每个时间段各教室已分配的科目集合（用于"每场每考场最多科目数"限制）
  // key: "date|slot" → Map<roomId, Set<subjectId>>
  const slotRoomSubjects = new Map();
  // 跟踪每个学生在哪个 date|slot 已有考试，避免同一时间段冲突
  // key: studentId → Set<"date|slot">
  const studentSlotMap = new Map();

  // === 【整科合并算法 · v6】按科目顺序，整科排入；硬约束：同一科目必须同一时段 ===
  //   - 每个科目维护一个 pending 学生队列（按学号排序），大科目优先
  //   - 时段选择（按优先级）：
  //     1) "已有排考记录"且全员空闲、总剩余容量 ≥ 科目人数的最早时段（并入已有场次，减少场次总数）
  //     2) 总剩余容量 ≥ 科目人数的最早空时段（开新场次）
  //     3) 兜底：所有时段都无法整科容纳（如科目人数超过单时段总可用容量）时，
  //        退回"最早全员无冲突"时段允许拆分，保证学生尽量被排上
  //   - 在该时段内，按 best-fit 把学生塞入教室（能整科放下 > 已有该科目 > 剩余容量小）
  //   - 目标：同一科目绝不跨时段（除非物理容量不允许），同一科目优先同一考场，场次数量最少
  const tasks = subjectOrder
    .filter(t => t.count > 0)
    .map(t => {
      const subject = t.subject;
      const students = (studentBySubject.get(subject.id) || [])
        .filter(s => !studentExamKey.get(`${s.id}_${subject.id}`))
        .slice()
        .sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
      const roomType = subject.isLabRequired ? 'lab' : 'regular';
      const availableRooms = state.rooms.filter(room => room.type === roomType);
      return { subject, roomType, availableRooms, pending: students };
    })
    .filter(t => t.availableRooms.length > 0)
    .sort((a, b) => b.pending.length - a.pending.length);

  const MAX_DAYS = 365;
  const maxScanSlots = MAX_DAYS * effectiveSlots.length;

  for (const task of tasks) {
    let pending = task.pending.slice();
    let safetyCounter = 0;
    const skippedSlotKeys = new Set(); // 本科目确认排不进的时段（教室满/科目数超限），避免重复选中
    while (pending.length > 0 && safetyCounter < maxScanSlots) {
      safetyCounter++;
      // 找目标时段（硬约束：同一科目必须同一时段，整科放不下的时段直接跳过，绝不拆分）：
      //   1) 优先选"已有排考记录"的最早全员空闲且容量足够的时段 → 并入已有场次，减少场次数量
      //   2) 若没有可并入的场次，选最早的容量足够的空时段开新场次
      //   3) 兜底：所有时段都无法整科容纳时，退回最早全员无冲突时段（仅此时才允许拆分）
      let chosenSlot = null, chosenDate = null, chosenSlotKey = null;
      let emptySlot = null, emptyDate = null, emptySlotKey = null;
      let fallbackSlot = null, fallbackDate = null, fallbackSlotKey = null;
      for (let offset = 0; offset < maxScanSlots; offset++) {
        const slot = effectiveSlots[offset % effectiveSlots.length];
        const date = addDays(startDate, Math.floor(offset / effectiveSlots.length));
        const slotKey = `${date}|${slot}`;
        if (skippedSlotKeys.has(slotKey)) continue;
        const usageMap = slotRoomUsage.get(slotKey);
        // 预检：该时段对该科目的总剩余容量（考虑每考场科目数限制与已占用人数）
        let fitsWhole = false;
        if (usageMap || !emptySlotKey) {
          const subsMap = slotRoomSubjects.get(slotKey);
          let freeCap = 0;
          for (const room of task.availableRooms) {
            const used = usageMap ? (usageMap.get(room.id) || 0) : 0;
            if (used >= room.capacity) continue;
            if (subsMap && maxSubjects !== Infinity) {
              const subs = subsMap.get(room.id);
              if (subs && !subs.has(task.subject.id) && subs.size >= maxSubjects) continue;
            }
            freeCap += room.capacity - used;
          }
          fitsWhole = freeCap >= pending.length;
        }
        if (usageMap) {
          // 已有排考的时段：需全员空闲才能并入
          let conflict = false;
          for (const s of pending) {
            const used = studentSlotMap.get(s.id);
            if (used && used.has(slotKey)) { conflict = true; break; }
          }
          if (conflict) continue;
          if (fitsWhole) {
            chosenSlot = slot; chosenDate = date; chosenSlotKey = slotKey;
            break;
          }
          // 无冲突但整科放不下 → 记为兜底时段（仅此时允许拆分）
          if (!fallbackSlotKey) { fallbackSlot = slot; fallbackDate = date; fallbackSlotKey = slotKey; }
        } else if (!emptySlotKey) {
          // 空时段必然全员空闲（尚无任何排考记录）；fitsWhole=false 时记为兜底
          if (fitsWhole) {
            emptySlot = slot; emptyDate = date; emptySlotKey = slotKey;
          } else if (!fallbackSlotKey) {
            fallbackSlot = slot; fallbackDate = date; fallbackSlotKey = slotKey;
          }
        }
      }
      // 优先级：并入已有场次 > 最早空时段开新场次 > 兜底拆分
      if (!chosenSlotKey && emptySlotKey) {
        chosenSlot = emptySlot; chosenDate = emptyDate; chosenSlotKey = emptySlotKey;
      }
      if (!chosenSlotKey && fallbackSlotKey) {
        chosenSlot = fallbackSlot; chosenDate = fallbackDate; chosenSlotKey = fallbackSlotKey;
      }
      if (!chosenSlotKey) break; // 扫描范围内确无可排时段

      if (!slotRoomUsage.has(chosenSlotKey)) slotRoomUsage.set(chosenSlotKey, new Map());
      const roomUsage = slotRoomUsage.get(chosenSlotKey);

      // 在该时段内反复填教室，直到全部排完或教室塞满
      let toPlace = pending.slice();
      const stillPending = [];
      let madeProgress = false;

      while (toPlace.length > 0) {
        const slotSubs = slotRoomSubjects.get(chosenSlotKey) || new Map();
        const candidates = task.availableRooms
          .map(room => ({ room, used: roomUsage.get(room.id) || 0, subs: slotSubs.get(room.id) || new Set() }))
          .filter(x => x.used < x.room.capacity)
          .filter(x => maxSubjects === Infinity || x.subs.has(task.subject.id) || x.subs.size < maxSubjects)
          .sort((a, b) => {
            const remA = a.room.capacity - a.used;
            const remB = b.room.capacity - b.used;
            // 1. 能放下全部剩余 → 优先（不拆分）
            const aFit = remA >= toPlace.length ? 0 : 1;
            const bFit = remB >= toPlace.length ? 0 : 1;
            if (aFit !== bFit) return aFit - bFit;
            // 2. 已有该科目 → 优先（同科合并）
            const aHas = a.subs.has(task.subject.id) ? 0 : 1;
            const bHas = b.subs.has(task.subject.id) ? 0 : 1;
            if (aHas !== bHas) return aHas - bHas;
            // 3. best-fit（填满半满教室）
            return remA - remB;
          });

        if (candidates.length === 0) {
          stillPending.push(...toPlace);
          break;
        }

        const { room, used } = candidates[0];
        const remaining = room.capacity - used;
        if (remaining <= 0) {
          stillPending.push(...toPlace);
          break;
        }

        const leftover = [];
        let added = 0;
        for (const student of toPlace) {
          if (added >= remaining) { leftover.push(student); continue; }
          const examKey = `${student.id}_${task.subject.id}`;
          if (studentExamKey.get(examKey)) continue;
          if (!studentSlotMap.has(student.id)) studentSlotMap.set(student.id, new Set());
          // 无需再查冲突：全员在 chosenSlotKey 已确认无冲突
          scheduleEntries.push({
            id: `SCH${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            studentId: student.id,
            subjectId: task.subject.id,
            roomId: room.id,
            timeSlot: chosenSlot,
            examDate: chosenDate
          });
          studentExamKey.set(examKey, true);
          studentSlotMap.get(student.id).add(chosenSlotKey);
          roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
          added += 1;
        }
        if (added > 0 && maxSubjects !== Infinity) {
          if (!slotRoomSubjects.has(chosenSlotKey)) slotRoomSubjects.set(chosenSlotKey, new Map());
          const roomSubs = slotRoomSubjects.get(chosenSlotKey);
          if (!roomSubs.has(room.id)) roomSubs.set(room.id, new Set());
          roomSubs.get(room.id).add(task.subject.id);
        }
        madeProgress = madeProgress || added > 0;
        toPlace = leftover;
      }

      if (!madeProgress) {
        // 该时段排不进任何学生（教室满或科目数超限）→ 标记跳过，尝试下一个时段
        skippedSlotKeys.add(chosenSlotKey);
        continue;
      }
      pending = stillPending;
    }
    task.pending = pending;
  }

  state.schedules = scheduleEntries;
  state.lastGenerateMode = 'full';

  // === 理论下限计算（完整排班模式）===
  //   维度1（座位容量）：某类型考生总人次 ÷（每天时段数 × 该类型每天总座位数）。
  //             未限制"每场每考场科目数"时，多门科目可共享同一场次，只能按座位总量估算，
  //             不能按"每科独占场次"估算，否则下限会虚高（曾出现"实际2天 < 下限3天"的矛盾）。
  //   维度2（科目场次上限）：仅在设置了 maxSubjects 时适用——每场每考场 ≤ maxSubjects 门科目，
  //             故每天最多安排 (时段数 × 教室数 × maxSubjects) 门科目，反推天数。
  //   维度3（学生冲突）：max(每人科目数) ÷ 每天时段数 向上取整
  //   理论下限 = max(维度1, 维度2, 维度3)，不适用者记 0
  let lowerBound = 1;
  if (scheduleEntries.length > 0 && effectiveSlots.length > 0) {
    const S = effectiveSlots.length;
    const regRooms = state.rooms.filter(r => r.type === 'regular');
    const labRooms = state.rooms.filter(r => r.type === 'lab');
    const capRegularSum = regRooms.reduce((s, r) => s + (r.capacity || 0), 0);
    const capLabSum = labRooms.reduce((s, r) => s + (r.capacity || 0), 0);
    let regEntries = 0, labEntries = 0, regSubjects = 0, labSubjects = 0;
    subjectOrder.forEach(({ subject, count }) => {
      if (count <= 0) return;
      if (subject.isLabRequired && labRooms.length > 0) { labEntries += count; labSubjects += 1; }
      else if (!subject.isLabRequired && regRooms.length > 0) { regEntries += count; regSubjects += 1; }
    });
    const daysRegCap = capRegularSum > 0 ? Math.ceil(regEntries / (S * capRegularSum)) : 0;
    const daysLabCap = capLabSum > 0 ? Math.ceil(labEntries / (S * capLabSum)) : 0;
    const daysRegSub = maxSubjects !== Infinity && regRooms.length > 0
      ? Math.ceil(regSubjects / (S * regRooms.length * maxSubjects)) : 0;
    const daysLabSub = maxSubjects !== Infinity && labRooms.length > 0
      ? Math.ceil(labSubjects / (S * labRooms.length * maxSubjects)) : 0;
    let maxExams = 0;
    state.students.forEach(st => { maxExams = Math.max(maxExams, (st.subjectIds || []).length); });
    const spanStu = Math.ceil(maxExams / S);
    lowerBound = Math.max(1, daysRegCap, daysLabCap, daysRegSub, daysLabSub, spanStu);
  }
  // 紧凑度说明
  let spanMsg = '';
  if (scheduleEntries.length > 0) {
    const mn = scheduleEntries.reduce((a,s) => s.examDate < a ? s.examDate : a, '9999-99-99');
    const mx = scheduleEntries.reduce((a,s) => s.examDate > a ? s.examDate : a, '0000-00-00');
    const span = Math.round((new Date(mx) - new Date(mn)) / 86400000) + 1;
    spanMsg = `（${mn} ~ ${mx}，共 ${span} 天 / 理论下限 ${lowerBound} 天${span <= lowerBound ? '，已最优' : ''}）`;
  }
  // 末日用时段说明：剩余考生不足以开满全部时段时，未用到的时段不会出现——主动说明，避免误以为漏排
  let slotNote = '';
  if (scheduleEntries.length > 0 && effectiveSlots.length > 0) {
    const daySlotMap = new Map();
    scheduleEntries.forEach(s => {
      if (!daySlotMap.has(s.examDate)) daySlotMap.set(s.examDate, new Set());
      daySlotMap.get(s.examDate).add(s.timeSlot);
    });
    const days = Array.from(daySlotMap.keys()).sort();
    const lastDay = days[days.length - 1];
    const usedLast = daySlotMap.get(lastDay).size;
    if (usedLast < effectiveSlots.length) {
      slotNote = `；最后一天 ${lastDay} 安排 ${usedLast}/${effectiveSlots.length} 个时段（剩余考生不足时未用时段不排考，并非漏排）`;
    }
  }
  return { ok: true, msg: `成功生成 ${scheduleEntries.length} 条排考记录${spanMsg}${slotNote}`, data: scheduleEntries };
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
      const room = state.rooms.find(r => r.id === item.roomId);
      const key = `${room ? room.name : (item.roomId || '待安排')} | ${item.examDate} | ${item.timeSlot}`;
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

    // 考场内考生排序：先按科目（代码+名称）分组，使同一科目在表格上连续；科目内再按姓名拼音字母序
    const sortedItems = [...items].sort((a, b) => {
      const subA = state.subjects.find(s => s.id === a.subjectId);
      const subB = state.subjects.find(s => s.id === b.subjectId);
      const keyA = subA ? `${subA.code} ${subA.name}` : '';
      const keyB = subB ? `${subB.code} ${subB.name}` : '';
      if (keyA !== keyB) return keyA.localeCompare(keyB, 'zh-CN');
      return cmpPinyinNameItem(a, b);
    });

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

// ==================== 签到表导出（一个科目一个工作表，每个教室一张签到表）====================
// 列：序号、学号、姓名、班级名称、课程名称、学分、考试时间、考试地点、学生签名
// 用 exceljs 生成原生 .xlsx，保证每个科目是独立的工作表；
// 同一科目占多个教室时，sheet 内每个教室一张独立的签到表（重复表头，序号在每个教室内重新编号）
async function getExportSigninExcelBuffer() {
  const ExcelJS = getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '补考排考系统';

  const nameCollator = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true })
    : null;
  function cmpPinyinItem(a, b) {
    const sa = state.students.find(s => s.id === a.studentId);
    const sb = state.students.find(s => s.id === b.studentId);
    const na = sa ? (sa.name || '') : '';
    const nb = sb ? (sb.name || '') : '';
    if (na !== nb) {
      if (nameCollator) return nameCollator.compare(na, nb);
      return na.localeCompare(nb, 'zh-CN');
    }
    return (sa ? (sa.studentId || '') : '').localeCompare(sb ? (sb.studentId || '') : '');
  }

  // 按科目分组排班记录
  const bySubject = new Map();
  state.schedules.forEach(item => {
    if (!bySubject.has(item.subjectId)) bySubject.set(item.subjectId, []);
    bySubject.get(item.subjectId).push(item);
  });

  const subjectEntries = Array.from(bySubject.entries())
    .map(([subjectId, items]) => ({ subject: state.subjects.find(s => s.id === subjectId), items }))
    .filter(e => e.subject)
    .sort((a, b) => `${a.subject.code || ''}-${a.subject.name || ''}`.localeCompare(`${b.subject.code || ''}-${b.subject.name || ''}`, 'zh-CN'));

  if (subjectEntries.length === 0) throw new Error('暂无排班数据');

  const signinHeaders = ['序号', '学号', '姓名', '班级名称', '课程名称', '学分', '考试时间', '考试地点', '学生签名'];
  const thinBorder = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

  for (const { subject, items } of subjectEntries) {
    // 一个科目 = 一个工作表，sheet 名 = 科目代码-科目名
    const ws = workbook.addWorksheet(sanitizeSheetName(`${subject.code || ''}-${subject.name || '未命名科目'}`));
    ws.columns = [
      { width: 6 }, { width: 16 }, { width: 10 }, { width: 26 }, { width: 24 },
      { width: 8 }, { width: 26 }, { width: 12 }, { width: 14 }
    ];

    // 科目内按教室分组（教室名排序），每个教室一张签到表
    const byRoom = new Map();
    items.forEach(item => {
      const key = item.roomId || '';
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(item);
    });
    const roomEntries = Array.from(byRoom.entries())
      .map(([roomId, roomItems]) => ({ room: state.rooms.find(r => r.id === roomId), items: roomItems }))
      .sort((a, b) => ((a.room ? a.room.name : '') || '').localeCompare((b.room ? b.room.name : '') || '', 'zh-CN'));

    roomEntries.forEach(({ room, items: roomItems }, roomIdx) => {
      // 每个教室一张独立签到表：重复表头行，表与表之间空一行
      if (roomIdx > 0) ws.addRow([]);
      const headerRow = ws.addRow(signinHeaders);
      headerRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = thinBorder;
      });

      // 教室内学生按姓名拼音排序，序号在本教室内重新编号
      const sorted = [...roomItems].sort(cmpPinyinItem);
      const first = roomItems[0] || {};
      // 考试时间格式：2026.08.24 上午10:30-12:30
      const examTime = formatExamTime(first.examDate, first.timeSlot).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1.$2.$3');
      const roomName = room ? room.name : (first.roomId || '待安排');

      sorted.forEach((item, idx) => {
        const student = state.students.find(s => s.id === item.studentId);
        const enroll = student && student.enrollments ? student.enrollments[subject.id] : null;
        const credits = enroll && enroll.credits !== undefined && enroll.credits !== null ? enroll.credits : '';
        const row = ws.addRow([
          idx + 1,
          student ? String(student.studentId || '') : '', // 强转字符串，Excel 不做科学计数法
          student ? (student.name || '') : '',
          student ? (student.className || '') : '',
          subject.name || '',
          credits,
          examTime,
          roomName,
          ''
        ]);
        row.eachCell(cell => {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          cell.border = thinBorder;
        });
      });
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
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

/**
 * 按科目聚合监考表数据（对应用户要求的「监考安排表」）。
 * 每行一门课，同时段同考场的多行在导出时做纵向合并单元格（序号/时间/地点/监考老师/校区）。
 * 返回行数组，每行含：subject、subjectName、examCount、deptText、majorText、timeText、roomText、
 *   firstDate、timeSlot、campusText、slotRoomKey。
 *   - slotRoomKey = 日期|时段|考场ID，用于识别哪些行需要合并
 */
function buildInvigilationRows() {
  if (!state.schedules || state.schedules.length === 0) return [];

  const bySubject = new Map();
  for (const item of state.schedules) {
    if (!item || !item.subjectId) continue;
    const key = JSON.stringify([item.subjectId, item.examDate, item.timeSlot, item.roomId]);
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(item);
  }

  const collator = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true }) : null;
  const rows = [];

  for (const items of bySubject.values()) {
    const subjectId = items[0].subjectId;
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) continue;

    const deptSet = new Set();
    const majorSet = new Set();
    const studentIdSet = new Set();
    const campusSet = new Set();
    let timeText = '';
    let roomName = '';
    let firstDate = '';
    let timeSlot = '';
    let roomId = '';

    for (const it of items) {
      const stu = state.students.find(s => s.id === it.studentId);
      if (stu) {
        studentIdSet.add(stu.id);
        if (stu.department) deptSet.add(stu.department);
        if (stu.major) majorSet.add(stu.major);
        // 校区去空格后收集，避免同名校区因空格差异被误判为多校区
        const campus = (stu.campus || '').trim();
        if (campus) campusSet.add(campus);
      }
      const t = formatExamTime(it.examDate, it.timeSlot);
      if (t && t !== '待安排') timeText = t;
      const room = state.rooms.find(r => r.id === it.roomId);
      if (room) roomName = room.name;
      if (it.examDate) firstDate = it.examDate;
      if (it.timeSlot) timeSlot = it.timeSlot;
      if (it.roomId) roomId = it.roomId;
    }

    const deptText = deptSet.size === 1 ? Array.from(deptSet)[0] : (deptSet.size > 1 ? '全校' : '');
    const majorText = majorSet.size === 1 ? Array.from(majorSet)[0] : '';
    const examCount = studentIdSet.size;
    // 不存在多校区情况，直接取校区名（多个时取第一个）
    const campusText = campusSet.size > 0 ? Array.from(campusSet)[0] : '';
    // 每组只包含同一科目、日期、时段和考场，人数与场次逐一对应。
    const slotRoomKey = `${firstDate}|${timeSlot}|${roomId}`;

    rows.push({
      subject, subjectName: subject.name || '', examCount, deptText, majorText,
      timeText, roomText: roomName, campusText, firstDate, timeSlot, slotRoomKey
    });
  }

  // 排序：先按考试日期，再按时间段，再按考场名，再按科目名
  rows.sort((a, b) => {
    if (a.firstDate !== b.firstDate) return a.firstDate.localeCompare(b.firstDate);
    if (a.timeSlot !== b.timeSlot) return (a.timeSlot || '').localeCompare(b.timeSlot || '');
    if (a.roomText !== b.roomText) return (a.roomText || '').localeCompare(b.roomText || '', 'zh-CN');
    const na = a.subjectName || '', nb = b.subjectName || '';
    if (collator) return collator.compare(na, nb);
    return na.localeCompare(nb, 'zh-CN');
  });

  return rows;
}

/**
 * 用 exceljs 生成原生 .xlsx 工作簿，包含两个 Sheet：
 *   Sheet 1 = 补考安排名单（每行 = 一个学生一门课，按姓名拼音排序）
 *   Sheet 2 = 监考安排表（每行 = 一门课聚合，监考老师三列留空供手填）
 * 学号/课程编号等长数字强制用 String 写入，避免 Excel 自动转科学计数法。
 * 返回 Promise<Buffer>（因为 exceljs 的 writeBuffer 是 async）。
 */
async function getExportListExcelBuffer() {
  const ExcelJS = getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '补考排考系统';

  // ========== Sheet 1：补考安排名单 ==========
  const sheet1 = workbook.addWorksheet('补考安排名单');
  const listHeaders = ['学号', '姓名', '学生所在院系', '班级名称', '课程名称', '课程属性', '年级', '总学时', '学分', '上课教师', '考试时间', '考试地点'];
  sheet1.columns = listHeaders.map(h => ({ header: h, key: h, width: 16 }));
  sheet1.getRow(1).font = { bold: true };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };

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

  const sorted = [...state.schedules].sort((a, b) => {
    const sa = state.students.find(s => s.id === a.studentId);
    const sb = state.students.find(s => s.id === b.studentId);
    const r = cmpPinyinName(sa, sb);
    if (r !== 0) return r;
    if (a.examDate !== b.examDate) return (a.examDate || '').localeCompare(b.examDate || '');
    const subjA = state.subjects.find(x => x.id === a.subjectId);
    const subjB = state.subjects.find(x => x.id === b.subjectId);
    return (subjA ? subjA.name || '' : '').localeCompare(subjB ? subjB.name || '' : '', 'zh-CN');
  });
  for (const item of sorted) {
    const student = state.students.find(s => s.id === item.studentId) || {};
    const subject = state.subjects.find(s => s.id === item.subjectId) || {};
    const room = state.rooms.find(r => r.id === item.roomId) || {};
    const enroll = student.enrollments && student.enrollments[item.subjectId] ? student.enrollments[item.subjectId] : {};
    const row = sheet1.addRow([
      String(student.studentId || ''), // 强转字符串，Excel 不做科学计数法
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
      room.name || '' // 无考场时留空（不再显示"待安排"）
    ]);
    row.eachCell(cell => { cell.alignment = { vertical: 'middle', horizontal: 'left' }; });
  }

  // ========== Sheet 2：监考安排表（每行一门课，同时段同考场的行做纵向合并）==========
  const sheet2 = workbook.addWorksheet('监考安排表');
  const invigHeaders = ['序号', '课程名称', '学生所在学院', '专业（公共基础课可不填）', '考试人数', '补考时间', '补考地点', '监考老师一', '监考老师二', '监考老师三', '考试校区'];
  sheet2.columns = invigHeaders.map((h, i) => ({
    header: h, key: h,
    width: [6, 22, 18, 20, 10, 26, 14, 14, 14, 14, 14][i] || 16
  }));
  sheet2.getRow(1).font = { bold: true };
  sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
  // 加粗黑色边框（medium 粗细）
  const mediumBlackBorder = { top: { style: 'medium', color: { argb: 'FF000000' } }, left: { style: 'medium', color: { argb: 'FF000000' } }, bottom: { style: 'medium', color: { argb: 'FF000000' } }, right: { style: 'medium', color: { argb: 'FF000000' } } };
  sheet2.getRow(1).eachCell(cell => { cell.border = mediumBlackBorder; });

  const invigRows = buildInvigilationRows();
  // 合并分组：slotRoomKey → [起始行号(1-based), 结束行号]
  const mergeGroups = new Map();
  invigRows.forEach((r, idx) => {
    const rowNum = idx + 2; // 第1行是表头
    // 序号按"同时段同考场"递增，同一组合并组共享同一个序号
    if (!mergeGroups.has(r.slotRoomKey)) {
      mergeGroups.set(r.slotRoomKey, { start: rowNum, end: rowNum, seq: mergeGroups.size + 1 });
    } else {
      mergeGroups.get(r.slotRoomKey).end = rowNum;
    }
    const group = mergeGroups.get(r.slotRoomKey);

    const row = sheet2.addRow([
      group.seq, r.subjectName, r.deptText, '', r.examCount,
      r.timeText, r.roomText, '', '', '', r.campusText
    ]);
    row.eachCell(cell => { cell.alignment = { vertical: 'middle', horizontal: 'center' }; cell.border = mediumBlackBorder; });
  });

  // 纵向合并单元格：仅序号(1)、补考地点(7)、监考老师一(8)、监考老师二(9)、监考老师三(10)、考试校区(11)
  // 不合并：课程名称(2)、学院(3)、专业(4)、考试人数(5)、补考时间(6)
  const MERGE_COLS = [1, 7, 8, 9, 10, 11];
  for (const { start, end } of mergeGroups.values()) {
    if (end > start) {
      for (const col of MERGE_COLS) {
        sheet2.mergeCells(start, col, end, col);
        // 合并后保留首行值，设居中对齐
        const cell = sheet2.getCell(start, col);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// 为保留接口签名兼容性（之前是同步返回 HTML 字符串），如果调用方还在同步调用这个旧名字就抛错
function getExportListExcelHtml() {
  throw new Error('getExportListExcelHtml 已弃用，请改用 async getExportListExcelBuffer()');
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
        jsonResponse(res, 200, {
          code: 0,
          msg: result.msg,
          data: {
            count: result.count,
            addedSubjects: result.addedSubjects || 0,
            diagnostic: result.diagnostic || null
          }
        });
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
        jsonResponse(res, 200, { code: result.ok ? 0 : (result.requiresConfirmation ? 2 : 1), msg: result.msg, data: result.data || [], requiresConfirmation: !!result.requiresConfirmation, confirmationToken: result.confirmationToken, warnings: result.warnings || [] });
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
    // 异步生成原生 .xlsx（exceljs），支持多 Sheet
    getExportListExcelBuffer()
      .then(buf => {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="exam_schedule_list.xlsx"; filename*=UTF-8''${encodeURIComponent('exam_schedule_学生名单与监考安排.xlsx')}`,
          'Content-Length': buf.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(buf);
      })
      .catch(err => {
        console.error('[exportList] 生成 xlsx 失败:', err);
        jsonResponse(res, 500, { code: 1, msg: '导出失败: ' + err.message });
      });
    return;
  }

  if (pathname === '/api/schedule/exportSignin' && req.method === 'GET') {
    if (!state.schedules || state.schedules.length === 0) {
      jsonResponse(res, 400, { code: 1, msg: '暂无排班数据，请先生成排班' });
      return;
    }
    // 异步生成原生 .xlsx（exceljs），保证每个科目一个独立工作表
    getExportSigninExcelBuffer()
      .then(buf => {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="exam_schedule_signin.xlsx"; filename*=UTF-8''${encodeURIComponent('exam_schedule_签到表.xlsx')}`,
          'Content-Length': buf.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(buf);
      })
      .catch(err => {
        console.error('[exportSignin] 生成 xlsx 失败:', err);
        jsonResponse(res, 500, { code: 1, msg: '导出失败: ' + err.message });
      });
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

