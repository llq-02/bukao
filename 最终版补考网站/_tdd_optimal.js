// ===== TDD RED: 严格最优性（Actual span == 理论下限 L） + msg 含"理论下限"/"最优" =====
const http = require('http');
function post(url, json) {
  const u = new URL(url); const body = JSON.stringify(json);
  return new Promise((res, rej) => {
    const req = http.request({hostname:u.hostname, port:u.port, path:u.pathname, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { res(JSON.parse(d)); } catch(e) { res({raw:d}); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}
const results = [];
function check(name, cond, note) { results.push({ name, pass: !!cond, note }); }
function ceilDiv(a,b){ return Math.ceil(a/b); }

// 理论下限 L = max( 容量维度, 学生冲突维度 )
// 容量维度：for each subject ceil(学生数_i / (roomCount_i * cap_i)) 求和 → totalSlots / 每天时段数，向上取整（含两端所以 = 向上取整 就是 span 天）
// 注意：普通科和机房科分开！机房科只能用机房容量，普通科用普通教室容量
// 学生冲突维度：max(每人科目数) / 每天时段数，向上取整
// 理论下限 L = max( 维度1普通, 维度2机房, 维度3学生 )
// 维度1（普通）: 普通科实例 = Σceil(学生数_i / (regNum*regCap)); 每天最多 (regNum*S) 实例; daysReg = ⌈实例/(regNum*S)⌉
// 维度2（机房）: 同理 daysLab
// 维度3（学生冲突）: ⌈max(每人科目数)/S⌉
function calcTheory(subjects, students, slots, regNum, regCap, labNum, labCap) {
  const bySubj = new Map();
  for (const s of students) s.subjectIds.forEach(id => bySubj.set(id, (bySubj.get(id)||0)+1));
  const S = slots.length;
  const capRegular = Math.max(1, regNum * regCap);
  const capLab    = Math.max(1, labNum * labCap);
  const regParallel = Math.max(1, (regNum>0?regNum:1) * S);
  const labParallel = Math.max(1, (labNum>0?labNum:1) * S);
  let regInstances = 0, labInstances = 0;
  for (const sub of subjects) {
    const cnt = bySubj.get(sub.id) || 0;
    if (cnt === 0) continue;
    if (sub.isLabRequired) {
      if (labNum > 0 && labCap > 0) labInstances += ceilDiv(cnt, capLab);
    } else {
      if (regNum > 0 && regCap > 0) regInstances += ceilDiv(cnt, capRegular);
    }
  }
  const daysReg = regInstances>0 ? ceilDiv(regInstances, regParallel) : 0;
  const daysLab = labInstances>0 ? ceilDiv(labInstances, labParallel) : 0;
  const maxSubjPerStudent = Math.max(...students.map(s => s.subjectIds.length), 0);
  const studentDays = ceilDiv(maxSubjPerStudent, S);
  const L = Math.max(daysReg, daysLab, studentDays, 1);
  return { regInstances, labInstances, daysReg, daysLab, maxSubjPerStudent, studentDays, L };
}

// ==== 场景1: 10科 × 100学生，所有学生报相同10科。1普通教室×容量20，每天2时段。 ====
// 每科 100/(1*20) = 5 slot。10科×5=50 slot。容量维度: ⌈50/2⌉ = 25天。
// 每人10科 → ⌈10/2⌉ = 5 天。L = max(25, 5) = 25天。
const subj1 = []; for (let i=1;i<=10;i++) subj1.push({id:`SUB${i}`,code:`C${i}`,name:`科${i}`,isLabRequired:false});
const stud1 = [];
for (let i=1;i<=100;i++) {
  const subjectIds = subj1.map(s=>s.id); const en={}; subjectIds.forEach(s=>en[s]={courseAttr:'必修',grade:'2023',totalHours:48,credits:3,teacher:'T'});
  stud1.push({id:`s${i}`,studentId:String(2025000+i),name:`学生${i}`,campus:'南',department:'计算机',major:'软工',className:'软2301',subjectIds,enrollments:en});
}
// ==== 场景2: 80科 × 500学生。5普×50 + 2机×30，每天5时段。 ====
const subj2 = []; for (let i=1;i<=80;i++) subj2.push({id:`SUB${i}`,code:`C${i}`,name:`科目${i}`,isLabRequired:(i%7===0)});
const stud2 = [];
for (let i=1;i<=500;i++) {
  const subjectIds = []; for (const k of [3,5,7,11,13,17,19,23]) { const id=`SUB${(((i-1)*k)%80)+1}`; if (!subjectIds.includes(id)) subjectIds.push(id); }
  let f=1; while(subjectIds.length<8){const id=`SUB${f++}`; if(!subjectIds.includes(id))subjectIds.push(id);}
  const en={}; subjectIds.forEach(s=>en[s]={courseAttr:'必修',grade:'2023',totalHours:48,credits:3,teacher:'T'});
  stud2.push({id:`s${i}`,studentId:String(2025000+i),name:`学生${i}`,campus:'南',department:'计算机',major:'软工',className:'软2301',subjectIds,enrollments:en});
}
// ==== 场景3: listOnly 6科 × 8学生 × 每人3科（4时段/天，1科1slot）。 ====
const subj3 = []; for (let i=1;i<=6;i++) subj3.push({id:`SUB${i}`,code:`C${i}`,name:`科目${i}`,isLabRequired:false});
const stud3 = [];
for (let i=1;i<=8;i++) {
  const subjectIds = [`SUB${((i-1)%6)+1}`,`SUB${((i)%6)+1}`,`SUB${((i+1)%6)+1}`];
  const en={}; subjectIds.forEach(s=>en[s]={courseAttr:'必修',grade:'2023',totalHours:48,credits:3,teacher:'T'});
  stud3.push({id:`s${i}`,studentId:String(2025000+i),name:`学生${i}`,campus:'南',department:'计算机',major:'软工',className:'软2301',subjectIds,enrollments:en});
}

(async () => {
  // Scene 1
  await post('http://localhost:8080/api/data/reset', {});
  await post('http://localhost:8080/api/data/restore', { subjects: subj1, rooms: [], students: stud1, schedules: [] });
  const g1 = await post('http://localhost:8080/api/schedule/generate', { startDate:'2026-08-20', customSlots:['08:00-10:00','14:00-16:00'], regularRoomNum:1, regularCapacity:20 });
  const th1 = calcTheory(subj1, stud1, ['08:00-10:00','14:00-16:00'], 1, 20, 0, 30);
  const sc1 = g1.data || [];
  const mn1 = sc1.reduce((a,s)=>s.examDate<a?s.examDate:a,'9'), mx1 = sc1.reduce((a,s)=>s.examDate>a?s.examDate:a,'0');
  const actualDays1 = Math.round((new Date(mx1)-new Date(mn1))/86400000) + 1;
  check('T1a: 场景1 msg含\"理论下限\"+\"最优\"', /理论下限.*天.*最优|最优.*理论下限/.test(g1.msg||''), `msg=${g1.msg}`);
  check('T1b: 场景1 实际天数 exactly = 理论下限', actualDays1 === th1.L, `理论下限=${JSON.stringify(th1)} → L=${th1.L}, 实际 mn=${mn1} mx=${mx1} 天数=${actualDays1}`);
  check('T1c: 场景1 schedule条数=1000', sc1.length===1000, `cnt=${sc1.length}`);

  // Scene 2
  await post('http://localhost:8080/api/data/reset', {});
  await post('http://localhost:8080/api/data/restore', { subjects: subj2, rooms: [], students: stud2, schedules: [] });
  const g2 = await post('http://localhost:8080/api/schedule/generate', {
    startDate:'2026-08-20', customSlots:['08:00-10:00','10:30-12:30','14:00-16:00','16:30-18:30','19:00-21:00'],
    regularRoomNum:5, regularCapacity:50, labRoomNum:2, labCapacity:30
  });
  const th2 = calcTheory(subj2, stud2, ['08:00-10:00','10:30-12:30','14:00-16:00','16:30-18:30','19:00-21:00'], 5, 50, 2, 30);
  const sc2 = g2.data || [];
  const mn2 = sc2.reduce((a,s)=>s.examDate<a?s.examDate:a,'9'), mx2 = sc2.reduce((a,s)=>s.examDate>a?s.examDate:a,'0');
  const actualDays2 = Math.round((new Date(mx2)-new Date(mn2))/86400000) + 1;
  console.log(`  场景2 理论=${JSON.stringify(th2)}, 实际 mn=${mn2} mx=${mx2} 天数=${actualDays2} msg=${g2.msg}`);
  check('T2a: 场景2 msg含\"理论下限\"', g2.msg && g2.msg.indexOf('理论下限') >= 0, `msg=${g2.msg}`);
  check('T2b: 场景2 实际天数 ≤ 理论下限（容差+1，允许学生极小冲突）', actualDays2 <= th2.L + 1, `L=${th2.L} actual=${actualDays2}`);
  check('T2c: 场景2 绝不跨到9月', mx2 < '2026-09-01', `max=${mx2}`);
  check('T2d: 场景2 条数=4000', sc2.length===4000, `cnt=${sc2.length}`);

  // Scene 3 (listOnly)
  await post('http://localhost:8080/api/data/reset', {});
  await post('http://localhost:8080/api/data/restore', { subjects: subj3, rooms: [], students: stud3, schedules: [] });
  const g3 = await post('http://localhost:8080/api/schedule/generate', {
    startDate:'2026-09-01', customSlots:['08:00-10:00','10:30-12:30','14:00-16:00','16:30-18:30'],
    regularRoomNum:0, labRoomNum:0
  });
  const slots3Cnt = 4;
  // listOnly 理论下限：无教室容量限制，多科可共享同一时段
  // 唯一约束：同一学生同一时段只能考一科
  // 每人最多 3 科 / 每天 4 时段 → ⌈3/4⌉=1 天
  const L3 = Math.max(1, ceilDiv(Math.max(...stud3.map(s=>s.subjectIds.length)), slots3Cnt));
  const sc3 = g3.data || [];
  const mn3 = sc3.reduce((a,s)=>s.examDate<a?s.examDate:a,'9'), mx3 = sc3.reduce((a,s)=>s.examDate>a?s.examDate:a,'0');
  const actualDays3 = Math.round((new Date(mx3)-new Date(mn3))/86400000) + 1;
  check('T3a: listOnly msg含\"理论下限\"+\"最优\"', /理论下限.*天.*最优|最优.*理论下限/.test(g3.msg||''), `msg=${g3.msg}`);
  check('T3b: listOnly 实际 exactly = 理论下限', actualDays3 === L3, `L=${L3} actual=${actualDays3} mn=${mn3} mx=${mx3}`);
  check('T3c: listOnly 24条', sc3.length === 24, `cnt=${sc3.length}`);

  console.log('\n================ TEST SUMMARY ================');
  let failed = 0;
  for (const t of results) {
    const mark = t.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}  ${t.name}${t.note?`  :: ${t.note}`:''}`);
    if (!t.pass) failed++;
  }
  console.log(`\nTotal ${results.length}: PASS=${results.length-failed} FAIL=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e=>{console.error(e);process.exit(2)});
