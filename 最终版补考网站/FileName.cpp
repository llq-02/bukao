/* ========================================================================
 * FileName.cpp   早期 Windows-only 版本的 C++ 后端（已弃用）
 *
 * 当前线上使用的是同一目录下的 Node.js 版本 server.js：
 *   - 零外部依赖，Linux / Windows / macOS 直接运行： node server.js
 *   - 支持完整 API（仅名单模式 / 生成 / 导出 / 理论下限紧凑算法 等）
 *
 * 本文件因为大量使用 Winsock2 / MultiByteToWideChar / SetConsoleCP /
 * SOCKET / _wfopen 等 Win32 专有 API，在 Linux 下无法编译，故统一用
 *  #ifdef _WIN32 包裹，并在非 Windows 平台给出降级 #error 提示。
 * ======================================================================== */

#ifdef _WIN32
#define _CRT_SECURE_NO_WARNINGS
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <set>
#include <algorithm>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <limits>
#include <cstdlib>
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <cctype>

#pragma comment(lib, "ws2_32.lib")
#else
/* ===== Linux / macOS 下的降级提示（仅此一段，其他内容都在 _WIN32 块里）===== */
#include <cstdio>
#error "FileName.cpp 是早期 Windows-only 版本，Linux 下请使用同目录 Node.js 版本：node server.js"
int main() {
    printf("FileName.cpp 仅支持 Windows 平台；请在 Linux 运行: node server.js\n");
    return 0;
}
#endif /* _WIN32 */

#ifdef _WIN32

using namespace std;

// ==================== 常量定义 ====================
const int MIN_CAPACITY = 20;
const int MAX_CAPACITY = 70;
const int DEFAULT_REGULAR_CAPACITY = 50;
const int DEFAULT_LAB_CAPACITY = 30;
const int HTTP_PORT = 8080;
const int BUFFER_SIZE = 65536;

const vector<string> DEFAULT_TIME_SLOTS = {
    "08:00-10:00",
    "10:30-12:30",
    "14:00-16:00",
    "16:30-18:30"
};

// ==================== 数据结构 ====================
struct Subject {
    string id;
    string name;
    string code;
    bool isLabRequired = false;
};

struct Room {
    string id;
    string name;
    string type;
    int capacity = 0;
};

struct Student {
    string id;
    string name;
    string studentId;
    string campus;
    string department;
    string major;
    string className;
    string courseCollege;
    string courseUnit;
    vector<string> subjectIds;
};

struct ScheduleItem {
    string id;
    string studentId;
    string subjectId;
    string roomId;
    string timeSlot;
    string examDate;
};

struct GenerateParams {
    string startDate;
    int timeSlotsPerDay = 4;
    int regularRoomCount = 3;
    int labRoomCount = 3;
};

struct ImportResult {
    bool success = false;
    string message;
    int validStudents = 0;
    int newSubjects = 0;
    int totalLines = 0;
};

struct GenerateResult {
    bool success = false;
    string message;
    int totalScheduled = 0;
    int unassignedCount = 0;
    vector<string> warnings;
};

struct ExportResult {
    bool success = false;
    string message;
    string csvPath;
    string excelPath;
};

// ==================== 全局数据 ====================
vector<Subject> subjects;
vector<Room> rooms;
vector<Student> students;
vector<ScheduleItem> schedules;

// ==================== 工具函数 ====================
string generateId(const string& prefix) {
    static int counter = 0;
    return prefix + to_string(++counter);
}

bool isValidUtf8(const string& str) {
    size_t i = 0;
    while (i < str.size()) {
        unsigned char c = static_cast<unsigned char>(str[i]);
        if (c < 0x80) {
            i++;
        } else if ((c & 0xE0) == 0xC0) {
            if (i + 1 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            if ((c2 & 0xC0) != 0x80) return false;
            i += 2;
        } else if ((c & 0xF0) == 0xE0) {
            if (i + 2 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            unsigned char c3 = static_cast<unsigned char>(str[i + 2]);
            if ((c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) return false;
            i += 3;
        } else if ((c & 0xF8) == 0xF0) {
            if (i + 3 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            unsigned char c3 = static_cast<unsigned char>(str[i + 2]);
            unsigned char c4 = static_cast<unsigned char>(str[i + 3]);
            if ((c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80 || (c4 & 0xC0) != 0x80) return false;
            i += 4;
        } else {
            return false;
        }
    }
    return true;
}

string urlDecode(const string& str) {
    string decoded;
    for (size_t i = 0; i < str.size(); i++) {
        if (str[i] == '%' && i + 2 < str.size()) {
            int value = 0;
            istringstream iss(str.substr(i + 1, 2));
            if (iss >> hex >> value) {
                decoded += static_cast<char>(value);
                i += 2;
            } else {
                decoded += str[i];
            }
        } else if (str[i] == '+') {
            decoded += ' ';
        } else {
            decoded += str[i];
        }
    }
    return decoded;
}

// ==================== JSON 工具函数 ====================
string jsonEscape(const string& s) {
    string result;
    for (char c : s) {
        switch (c) {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    sprintf(buf, "\\u%04x", c);
                    result += buf;
                } else {
                    result += c;
                }
        }
    }
    return result;
}

string subjectToJson(const Subject& s) {
    ostringstream oss;
    oss << "{"
        << "\"id\":\"" << jsonEscape(s.id) << "\","
        << "\"name\":\"" << jsonEscape(s.name) << "\","
        << "\"code\":\"" << jsonEscape(s.code) << "\","
        << "\"isLabRequired\":" << (s.isLabRequired ? "true" : "false")
        << "}";
    return oss.str();
}

string roomToJson(const Room& r) {
    ostringstream oss;
    oss << "{"
        << "\"id\":\"" << jsonEscape(r.id) << "\","
        << "\"name\":\"" << jsonEscape(r.name) << "\","
        << "\"type\":\"" << jsonEscape(r.type) << "\","
        << "\"capacity\":" << r.capacity
        << "}";
    return oss.str();
}

string studentToJson(const Student& s) {
    ostringstream oss;
    oss << "{"
        << "\"id\":\"" << jsonEscape(s.id) << "\","
        << "\"name\":\"" << jsonEscape(s.name) << "\","
        << "\"studentId\":\"" << jsonEscape(s.studentId) << "\","
        << "\"campus\":\"" << jsonEscape(s.campus) << "\","
        << "\"department\":\"" << jsonEscape(s.department) << "\","
        << "\"major\":\"" << jsonEscape(s.major) << "\","
        << "\"className\":\"" << jsonEscape(s.className) << "\","
        << "\"courseCollege\":\"" << jsonEscape(s.courseCollege) << "\","
        << "\"courseUnit\":\"" << jsonEscape(s.courseUnit) << "\","
        << "\"subjectIds\":[";
    for (size_t i = 0; i < s.subjectIds.size(); i++) {
        if (i > 0) oss << ",";
        oss << "\"" << jsonEscape(s.subjectIds[i]) << "\"";
    }
    oss << "]}";
    return oss.str();
}

string scheduleItemToJson(const ScheduleItem& sch) {
    auto subIt = find_if(subjects.begin(), subjects.end(),
        [&](const Subject& sb) { return sb.id == sch.subjectId; });
    auto roomIt = find_if(rooms.begin(), rooms.end(),
        [&](const Room& rm) { return rm.id == sch.roomId; });
    auto studentIt = find_if(students.begin(), students.end(),
        [&](const Student& st) { return st.id == sch.studentId; });

    ostringstream oss;
    oss << "{"
        << "\"id\":\"" << jsonEscape(sch.id) << "\","
        << "\"studentId\":\"" << jsonEscape(sch.studentId) << "\","
        << "\"subjectId\":\"" << jsonEscape(sch.subjectId) << "\","
        << "\"roomId\":\"" << jsonEscape(sch.roomId) << "\","
        << "\"timeSlot\":\"" << jsonEscape(sch.timeSlot) << "\","
        << "\"examDate\":\"" << jsonEscape(sch.examDate) << "\","
        << "\"subjectName\":\"" << (subIt != subjects.end() ? jsonEscape(subIt->name) : "") << "\","
        << "\"subjectCode\":\"" << (subIt != subjects.end() ? jsonEscape(subIt->code) : "") << "\","
        << "\"roomName\":\"" << (roomIt != rooms.end() ? jsonEscape(roomIt->name) : "") << "\","
        << "\"roomType\":\"" << (roomIt != rooms.end() ? jsonEscape(roomIt->type) : "") << "\","
        << "\"studentName\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->name) : "") << "\","
        << "\"studentNumber\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->studentId) : "") << "\","
        << "\"campus\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->campus) : "") << "\","
        << "\"department\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->department) : "") << "\","
        << "\"major\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->major) : "") << "\","
        << "\"className\":\"" << (studentIt != students.end() ? jsonEscape(studentIt->className) : "") << "\""
        << "}";
    return oss.str();
}

// 简单 JSON 解析器 - 提取键值对
string getJsonValue(const string& json, const string& key) {
    string searchKey = "\"" + key + "\"";
    size_t pos = json.find(searchKey);
    if (pos == string::npos) return "";
    pos = json.find(':', pos + searchKey.size());
    if (pos == string::npos) return "";
    pos++;
    while (pos < json.size() && isspace(json[pos])) pos++;
    if (pos >= json.size()) return "";

    if (json[pos] == '"') {
        pos++;
        string result;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) {
                char next = json[pos + 1];
                switch (next) {
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    case 'n': result += '\n'; break;
                    case 't': result += '\t'; break;
                    case 'r': result += '\r'; break;
                    default: result += next;
                }
                pos += 2;
            } else {
                result += json[pos];
                pos++;
            }
        }
        return result;
    } else {
        string result;
        while (pos < json.size() && json[pos] != ',' && json[pos] != '}' && json[pos] != ']') {
            result += json[pos];
            pos++;
        }
        while (!result.empty() && isspace(result.back())) result.pop_back();
        return result;
    }
}

// ==================== 核心业务逻辑：导入学生 ====================
ImportResult importStudentsFromCSV(const string& csvPath) {
    ImportResult result;

    int len = MultiByteToWideChar(CP_ACP, 0, csvPath.c_str(), -1, NULL, 0);
    wchar_t* wpath = new wchar_t[len];
    MultiByteToWideChar(CP_ACP, 0, csvPath.c_str(), -1, wpath, len);

    FILE* fp = _wfopen(wpath, L"rb");
    delete[] wpath;

    if (!fp) {
        result.message = "Cannot open CSV file: " + csvPath;
        return result;
    }

    fseek(fp, 0, SEEK_END);
    long fileSize = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    char* buffer = new char[fileSize + 1];
    fread(buffer, 1, fileSize, fp);
    buffer[fileSize] = '\0';

    string content(buffer);
    delete[] buffer;
    fclose(fp);

    bool hasBom = (content.size() >= 3 &&
        static_cast<unsigned char>(content[0]) == 0xEF &&
        static_cast<unsigned char>(content[1]) == 0xBB &&
        static_cast<unsigned char>(content[2]) == 0xBF);

    string testContent = hasBom ? content.substr(3) : content;
    bool isUtf8File = isValidUtf8(testContent);

    if (hasBom || isUtf8File) {
        if (hasBom) content = content.substr(3);
        int wlen = MultiByteToWideChar(CP_UTF8, 0, content.c_str(), -1, NULL, 0);
        wchar_t* wstr = new wchar_t[wlen];
        MultiByteToWideChar(CP_UTF8, 0, content.c_str(), -1, wstr, wlen);
        int gbkLen = WideCharToMultiByte(CP_ACP, 0, wstr, -1, NULL, 0, NULL, NULL);
        char* gbkStr = new char[gbkLen];
        WideCharToMultiByte(CP_ACP, 0, wstr, -1, gbkStr, gbkLen, NULL, NULL);
        content = gbkStr;
        delete[] wstr;
        delete[] gbkStr;
    }

    istringstream contentStream(content);
    string line;
    if (!getline(contentStream, line)) {
        result.message = "The file is empty or cannot be read!";
        return result;
    }

    if (line.size() >= 3 &&
        static_cast<unsigned char>(line[0]) == 0xEF &&
        static_cast<unsigned char>(line[1]) == 0xBB &&
        static_cast<unsigned char>(line[2]) == 0xBF) {
        line = line.substr(3);
    }

    map<string, Student> studentMap;
    map<string, string> subjectCodeToId;
    int lineNumber = 1;
    int skippedLines = 0;

    while (getline(contentStream, line)) {
        lineNumber++;
        if (line.empty()) { skippedLines++; continue; }

        istringstream iss(line);
        string studentId, name, campus, department, major, className, courseCode, courseName, isLabExamStr;

        getline(iss, studentId, ',');
        getline(iss, name, ',');
        getline(iss, campus, ',');
        getline(iss, department, ',');
        getline(iss, major, ',');
        getline(iss, className, ',');
        getline(iss, courseCode, ',');
        getline(iss, courseName, ',');
        getline(iss, isLabExamStr);

        size_t commaPos = isLabExamStr.find(',');
        if (commaPos != string::npos) isLabExamStr = isLabExamStr.substr(0, commaPos);
        size_t quotePos = isLabExamStr.find('"');
        if (quotePos != string::npos) isLabExamStr = isLabExamStr.substr(0, quotePos);

        bool isLabExam = (isLabExamStr == "1" || isLabExamStr == "yes" || isLabExamStr == "true");

        if (studentId.empty() && name.empty()) { skippedLines++; continue; }

        string subjectId;
        if (!courseCode.empty() && !courseName.empty()) {
            if (subjectCodeToId.find(courseCode) != subjectCodeToId.end()) {
                subjectId = subjectCodeToId[courseCode];
            } else {
                auto existingSub = find_if(subjects.begin(), subjects.end(),
                    [&](const Subject& s) { return s.code == courseCode || s.name == courseName; });
                if (existingSub != subjects.end()) {
                    subjectId = existingSub->id;
                    subjectCodeToId[courseCode] = subjectId;
                } else {
                    Subject newSub;
                    newSub.id = generateId("SUB");
                    newSub.name = courseName;
                    newSub.code = courseCode;
                    newSub.isLabRequired = isLabExam;
                    subjects.push_back(newSub);
                    subjectId = newSub.id;
                    subjectCodeToId[courseCode] = subjectId;
                    result.newSubjects++;
                }
            }
        }

        auto it = studentMap.find(studentId);
        if (it != studentMap.end()) {
            Student& existing = it->second;
            if (!subjectId.empty()) {
                auto existingSubIt = find(existing.subjectIds.begin(), existing.subjectIds.end(), subjectId);
                if (existingSubIt == existing.subjectIds.end()) {
                    existing.subjectIds.push_back(subjectId);
                }
            }
        } else {
            Student s;
            s.id = generateId("S");
            s.studentId = studentId;
            s.name = name;
            s.campus = campus;
            s.department = department;
            s.major = major;
            s.className = className;
            s.courseCollege = "";
            s.courseUnit = "";
            if (!subjectId.empty()) s.subjectIds.push_back(subjectId);
            studentMap[studentId] = s;
            result.validStudents++;
        }
    }

    for (const auto& pair : studentMap) {
        students.push_back(pair.second);
    }

    result.totalLines = lineNumber;
    result.success = true;
    result.message = "Successfully imported " + to_string(studentMap.size()) + " students";
    return result;
}

// ==================== 核心业务逻辑：生成排课 ====================
GenerateResult generateScheduleCore(const GenerateParams& params) {
    GenerateResult result;

    if (students.empty()) {
        result.message = "No students! Please import students first.";
        return result;
    }

    if (params.timeSlotsPerDay < 1 || params.timeSlotsPerDay > 4) {
        result.message = "Invalid timeSlotsPerDay, must be 1-4.";
        return result;
    }

    if (params.regularRoomCount < 1) {
        result.message = "regularRoomCount must be at least 1.";
        return result;
    }

    rooms.clear();
    for (int i = 1; i <= params.regularRoomCount; i++) {
        Room r;
        r.id = "R" + to_string(i);
        r.name = "Room " + to_string(i);
        r.type = "regular";
        r.capacity = DEFAULT_REGULAR_CAPACITY;
        rooms.push_back(r);
    }
    for (int i = 1; i <= params.labRoomCount; i++) {
        Room r;
        r.id = "LAB" + to_string(i);
        r.name = "Lab " + to_string(i);
        r.type = "lab";
        r.capacity = DEFAULT_LAB_CAPACITY;
        rooms.push_back(r);
    }

    vector<Room> regularRooms, labRooms;
    for (const Room& room : rooms) {
        if (room.type == "regular") regularRooms.push_back(room);
        else labRooms.push_back(room);
    }

    map<string, int> subjectStudentCount;
    for (const Student& student : students) {
        for (const string& subjectId : student.subjectIds) {
            subjectStudentCount[subjectId]++;
        }
    }

    vector<string> sortedSubjects;
    for (const auto& pair : subjectStudentCount) {
        sortedSubjects.push_back(pair.first);
    }
    sort(sortedSubjects.begin(), sortedSubjects.end(), [&](const string& a, const string& b) {
        return subjectStudentCount[a] > subjectStudentCount[b];
    });

    int totalRequiredSlots = 0;
    for (const string& subjectId : sortedSubjects) {
        int count = subjectStudentCount[subjectId];
        auto subIt = find_if(subjects.begin(), subjects.end(),
            [&](const Subject& sub) { return sub.id == subjectId; });
        if (subIt == subjects.end()) continue;
        int capacity = subIt->isLabRequired ? DEFAULT_LAB_CAPACITY : DEFAULT_REGULAR_CAPACITY;
        int roomsNeeded = (count + capacity - 1) / capacity;
        totalRequiredSlots = max(totalRequiredSlots, roomsNeeded);
    }

    int maxTimeSlots = static_cast<int>(sortedSubjects.size()) * 2;

    vector<ScheduleItem> newSchedules;
    map<string, set<string>> studentAssignedTimes;
    map<string, bool> studentSubjectAssigned;
    map<string, string> subjectAssignedTime;

    int slotIdx = 0;
    while (slotIdx < maxTimeSlots && subjectAssignedTime.size() < sortedSubjects.size()) {
        string timeSlot = "T" + to_string(slotIdx + 1);
        int dayOffset = slotIdx / params.timeSlotsPerDay;

        int year, month, day;
        sscanf(params.startDate.c_str(), "%d-%d-%d", &year, &month, &day);

        struct tm tmDate = {0};
        tmDate.tm_year = year - 1900;
        tmDate.tm_mon = month - 1;
        tmDate.tm_mday = day + dayOffset;
        mktime(&tmDate);

        char dateBuffer[20];
        strftime(dateBuffer, sizeof(dateBuffer), "%Y-%m-%d", &tmDate);
        string currentDate(dateBuffer);

        map<string, int> roomCount;
        map<string, string> roomSubjectMap;
        for (const Room& room : rooms) {
            roomCount[room.id] = 0;
            roomSubjectMap[room.id] = "";
        }

        for (const string& subjectId : sortedSubjects) {
            if (subjectAssignedTime.find(subjectId) != subjectAssignedTime.end()) continue;

            auto subIt = find_if(subjects.begin(), subjects.end(),
                [&](const Subject& sub) { return sub.id == subjectId; });
            if (subIt == subjects.end()) continue;

            bool isLabRequired = subIt->isLabRequired;
            const vector<Room>& targetRooms = isLabRequired ? labRooms : regularRooms;

            if (targetRooms.empty()) {
                result.warnings.push_back("No " + string(isLabRequired ? "lab" : "regular") +
                    " rooms available for " + subIt->name);
                continue;
            }

            vector<pair<string, string>> availableStudents;
            for (const Student& student : students) {
                if (student.subjectIds.empty()) continue;
                auto it = find(student.subjectIds.begin(), student.subjectIds.end(), subjectId);
                if (it == student.subjectIds.end()) continue;
                string key = student.id + "_" + subjectId;
                if (studentSubjectAssigned[key]) continue;
                if (studentAssignedTimes[student.id].count(timeSlot)) continue;
                availableStudents.emplace_back(student.id, student.name);
            }

            if (availableStudents.empty()) continue;

            int capacity = isLabRequired ? DEFAULT_LAB_CAPACITY : DEFAULT_REGULAR_CAPACITY;
            int roomsNeeded = (static_cast<int>(availableStudents.size()) + capacity - 1) / capacity;

            int availableRooms = 0;
            for (const Room& room : targetRooms) {
                if (roomCount[room.id] == 0) availableRooms++;
            }

            if (availableRooms < roomsNeeded) continue;

            vector<ScheduleItem> tempItems;
            vector<pair<string, string>> tempAssignedStudents;
            map<string, int> tempRoomCount = roomCount;
            map<string, string> tempRoomSubjectMap = roomSubjectMap;

            for (const auto& studentPair : availableStudents) {
                const string& studentId = studentPair.first;
                string key = studentId + "_" + subjectId;
                bool assigned = false;

                for (const Room& room : targetRooms) {
                    if (tempRoomCount[room.id] < room.capacity) {
                        if (tempRoomSubjectMap[room.id].empty()) {
                            tempRoomSubjectMap[room.id] = subjectId;
                        } else if (tempRoomSubjectMap[room.id] != subjectId) {
                            continue;
                        }

                        ScheduleItem item;
                        item.id = generateId("SCH");
                        item.studentId = studentId;
                        item.subjectId = subjectId;
                        item.roomId = room.id;
                        item.timeSlot = timeSlot;
                        item.examDate = currentDate;

                        tempItems.push_back(item);
                        tempRoomCount[room.id]++;
                        tempAssignedStudents.push_back(studentPair);
                        assigned = true;
                        break;
                    }
                }

                if (!assigned) {
                    tempItems.clear();
                    tempAssignedStudents.clear();
                    break;
                }
            }

            if (!tempItems.empty()) {
                for (const auto& item : tempItems) newSchedules.push_back(item);
                for (const auto& studentPair : tempAssignedStudents) {
                    const string& studentId = studentPair.first;
                    string key = studentId + "_" + subjectId;
                    studentAssignedTimes[studentId].insert(timeSlot);
                    studentSubjectAssigned[key] = true;
                }
                roomCount = tempRoomCount;
                roomSubjectMap = tempRoomSubjectMap;
                subjectAssignedTime[subjectId] = timeSlot;
            }
        }
        slotIdx++;
    }

    if (subjectAssignedTime.size() < sortedSubjects.size()) {
        for (const string& subjectId : sortedSubjects) {
            if (subjectAssignedTime.find(subjectId) == subjectAssignedTime.end()) {
                auto subIt = find_if(subjects.begin(), subjects.end(),
                    [&](const Subject& sub) { return sub.id == subjectId; });
                if (subIt != subjects.end()) {
                    result.warnings.push_back(subIt->name + " could not be scheduled");
                }
            }
        }
    }

    for (const Student& student : students) {
        for (const string& subjectId : student.subjectIds) {
            string key = student.id + "_" + subjectId;
            if (!studentSubjectAssigned[key]) {
                result.unassignedCount++;
            }
        }
    }

    schedules = newSchedules;
    result.totalScheduled = static_cast<int>(newSchedules.size());
    result.success = true;
    result.message = "Schedule generated: " + to_string(newSchedules.size()) + " entries";
    return result;
}

// ==================== 核心业务逻辑：导出排课 ====================
ExportResult exportScheduleToFiles(const string& basePath) {
    ExportResult result;
    if (schedules.empty()) {
        result.message = "No schedule data! Please generate schedule first.";
        return result;
    }

    string csvPath = basePath;
    size_t dotPos = csvPath.find_last_of('.');
    if (dotPos != string::npos) csvPath = csvPath.substr(0, dotPos) + ".csv";
    else csvPath += ".csv";

    ofstream file(csvPath);
    if (!file.is_open()) {
        result.message = "Cannot create CSV file: " + csvPath;
        return result;
    }

    file << "SubjectCode,SubjectName,ExamDate,TimeSlot,RoomName,RoomType,StudentID,StudentName,Campus,Department,Major,ClassName,CourseCollege,CourseUnit" << endl;

    for (const auto& schedule : schedules) {
        auto subIt = find_if(subjects.begin(), subjects.end(),
            [&](const Subject& sb) { return sb.id == schedule.subjectId; });
        auto roomIt = find_if(rooms.begin(), rooms.end(),
            [&](const Room& rm) { return rm.id == schedule.roomId; });
        auto studentIt = find_if(students.begin(), students.end(),
            [&](const Student& st) { return st.id == schedule.studentId; });

        if (subIt != subjects.end() && roomIt != rooms.end() && studentIt != students.end()) {
            file << subIt->code << ","
                << subIt->name << ","
                << schedule.examDate << ","
                << schedule.timeSlot << ","
                << roomIt->name << ","
                << (roomIt->type == "lab" ? "Lab" : "Regular") << ","
                << studentIt->studentId << ","
                << studentIt->name << ","
                << studentIt->campus << ","
                << studentIt->department << ","
                << studentIt->major << ","
                << studentIt->className << ","
                << studentIt->courseCollege << ","
                << studentIt->courseUnit << endl;
        }
    }
    file.close();
    result.csvPath = csvPath;

    string excelPath = csvPath;
    dotPos = excelPath.find_last_of('.');
    if (dotPos != string::npos) excelPath = excelPath.substr(0, dotPos) + ".xls";
    else excelPath += ".xls";

    ofstream excelFile(excelPath);
    if (!excelFile.is_open()) {
        result.message = "Cannot create Excel file.";
        result.success = true;
        return result;
    }

    excelFile << "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" ";
    excelFile << "xmlns:x=\"urn:schemas-microsoft-com:office:excel\">" << endl;
    excelFile << "<head><meta charset=\"UTF-8\"><style>";
    excelFile << "table { border-collapse: collapse; font-family: Arial, sans-serif; }";
    excelFile << "th { background-color: #4472C4; color: white; font-weight: bold; padding: 8px; border: 1px solid #333; text-align: center; }";
    excelFile << "td { padding: 6px; border: 1px solid #ccc; }";
    excelFile << ".title { font-size: 14px; font-weight: bold; background-color: #D9E1F2; color: #1F4E79; }";
    excelFile << "</style></head><body><table>";
    excelFile << "<tr><th colspan=\"14\">Exam Schedule</th></tr>";
    excelFile << "<tr><th>Subject Code</th><th>Subject Name</th><th>Exam Date</th><th>Time Slot</th>";
    excelFile << "<th>Room Name</th><th>Room Type</th><th>Student ID</th><th>Student Name</th>";
    excelFile << "<th>Campus</th><th>Department</th><th>Major</th><th>Class</th>";
    excelFile << "<th>Course College</th><th>Course Unit</th></tr>";

    for (const auto& schedule : schedules) {
        auto subIt = find_if(subjects.begin(), subjects.end(),
            [&](const Subject& sb) { return sb.id == schedule.subjectId; });
        auto roomIt = find_if(rooms.begin(), rooms.end(),
            [&](const Room& rm) { return rm.id == schedule.roomId; });
        auto studentIt = find_if(students.begin(), students.end(),
            [&](const Student& st) { return st.id == schedule.studentId; });

        if (subIt != subjects.end() && roomIt != rooms.end() && studentIt != students.end()) {
            excelFile << "<tr>";
            excelFile << "<td>" << subIt->code << "</td>";
            excelFile << "<td>" << subIt->name << "</td>";
            excelFile << "<td>" << schedule.examDate << "</td>";
            excelFile << "<td>" << schedule.timeSlot << "</td>";
            excelFile << "<td>" << roomIt->name << "</td>";
            excelFile << "<td>" << (roomIt->type == "lab" ? "Lab" : "Regular") << "</td>";
            excelFile << "<td>" << studentIt->studentId << "</td>";
            excelFile << "<td>" << studentIt->name << "</td>";
            excelFile << "<td>" << studentIt->campus << "</td>";
            excelFile << "<td>" << studentIt->department << "</td>";
            excelFile << "<td>" << studentIt->major << "</td>";
            excelFile << "<td>" << studentIt->className << "</td>";
            excelFile << "<td>" << studentIt->courseCollege << "</td>";
            excelFile << "<td>" << studentIt->courseUnit << "</td>";
            excelFile << "</tr>";
        }
    }

    excelFile << "</table></body></html>";
    excelFile.close();
    result.excelPath = excelPath;
    result.success = true;
    result.message = "Exported successfully";
    return result;
}

// ==================== HTTP 响应构建 ====================
string buildHttpResponse(int statusCode, const string& contentType, const string& body, bool enableCors = true) {
    ostringstream oss;
    string statusText;
    switch (statusCode) {
        case 200: statusText = "OK"; break;
        case 201: statusText = "Created"; break;
        case 400: statusText = "Bad Request"; break;
        case 404: statusText = "Not Found"; break;
        case 500: statusText = "Internal Server Error"; break;
        default: statusText = "Unknown";
    }

    oss << "HTTP/1.1 " << statusCode << " " << statusText << "\r\n";
    oss << "Content-Type: " << contentType << "; charset=utf-8\r\n";
    oss << "Content-Length: " << body.size() << "\r\n";
    oss << "Connection: close\r\n";
    if (enableCors) {
        oss << "Access-Control-Allow-Origin: *\r\n";
        oss << "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n";
        oss << "Access-Control-Allow-Headers: Content-Type\r\n";
    }
    oss << "\r\n";
    oss << body;
    return oss.str();
}

string buildJsonResponse(int statusCode, const string& jsonBody) {
    return buildHttpResponse(statusCode, "application/json", jsonBody);
}

// ==================== API 处理函数 ====================
string handleApiImport(const string& body) {
    string path = getJsonValue(body, "filePath");
    if (path.empty()) {
        return buildJsonResponse(400, "{\"success\":false,\"message\":\"filePath is required\"}");
    }

    ImportResult result = importStudentsFromCSV(path);

    ostringstream oss;
    oss << "{"
        << "\"success\":" << (result.success ? "true" : "false") << ","
        << "\"message\":\"" << jsonEscape(result.message) << "\","
        << "\"validStudents\":" << result.validStudents << ","
        << "\"newSubjects\":" << result.newSubjects << ","
        << "\"totalLines\":" << result.totalLines
        << "}";
    return buildJsonResponse(result.success ? 200 : 500, oss.str());
}

string handleApiGenerate(const string& body) {
    GenerateParams params;
    params.startDate = getJsonValue(body, "startDate");

    string ts = getJsonValue(body, "timeSlotsPerDay");
    if (!ts.empty()) params.timeSlotsPerDay = stoi(ts);
    string rr = getJsonValue(body, "regularRoomCount");
    if (!rr.empty()) params.regularRoomCount = stoi(rr);
    string lr = getJsonValue(body, "labRoomCount");
    if (!lr.empty()) params.labRoomCount = stoi(lr);

    if (params.startDate.empty()) {
        return buildJsonResponse(400, "{\"success\":false,\"message\":\"startDate is required (YYYY-MM-DD)\"}");
    }

    GenerateResult result = generateScheduleCore(params);

    ostringstream oss;
    oss << "{"
        << "\"success\":" << (result.success ? "true" : "false") << ","
        << "\"message\":\"" << jsonEscape(result.message) << "\","
        << "\"totalScheduled\":" << result.totalScheduled << ","
        << "\"unassignedCount\":" << result.unassignedCount << ","
        << "\"warnings\":[";
    for (size_t i = 0; i < result.warnings.size(); i++) {
        if (i > 0) oss << ",";
        oss << "\"" << jsonEscape(result.warnings[i]) << "\"";
    }
    oss << "]}";
    return buildJsonResponse(result.success ? 200 : 500, oss.str());
}

string handleApiSchedules() {
    ostringstream oss;
    oss << "{\"success\":true,\"data\":[";
    for (size_t i = 0; i < schedules.size(); i++) {
        if (i > 0) oss << ",";
        oss << scheduleItemToJson(schedules[i]);
    }
    oss << "],\"total\":" << schedules.size() << "}";
    return buildJsonResponse(200, oss.str());
}

string handleApiExport(const string& body) {
    string basePath = getJsonValue(body, "outputPath");
    if (basePath.empty()) {
        basePath = "exam_schedule";
    }

    ExportResult result = exportScheduleToFiles(basePath);

    ostringstream oss;
    oss << "{"
        << "\"success\":" << (result.success ? "true" : "false") << ","
        << "\"message\":\"" << jsonEscape(result.message) << "\","
        << "\"csvPath\":\"" << jsonEscape(result.csvPath) << "\","
        << "\"excelPath\":\"" << jsonEscape(result.excelPath) << "\""
        << "}";
    return buildJsonResponse(result.success ? 200 : 500, oss.str());
}

string handleApiStudents() {
    ostringstream oss;
    oss << "{\"success\":true,\"data\":[";
    for (size_t i = 0; i < students.size(); i++) {
        if (i > 0) oss << ",";
        oss << studentToJson(students[i]);
    }
    oss << "],\"total\":" << students.size() << "}";
    return buildJsonResponse(200, oss.str());
}

string handleApiSubjects() {
    ostringstream oss;
    oss << "{\"success\":true,\"data\":[";
    for (size_t i = 0; i < subjects.size(); i++) {
        if (i > 0) oss << ",";
        oss << subjectToJson(subjects[i]);
    }
    oss << "],\"total\":" << subjects.size() << "}";
    return buildJsonResponse(200, oss.str());
}

string handleApiRooms() {
    ostringstream oss;
    oss << "{\"success\":true,\"data\":[";
    for (size_t i = 0; i < rooms.size(); i++) {
        if (i > 0) oss << ",";
        oss << roomToJson(rooms[i]);
    }
    oss << "],\"total\":" << rooms.size() << "}";
    return buildJsonResponse(200, oss.str());
}

string handleApiClear() {
    students.clear();
    subjects.clear();
    schedules.clear();
    return buildJsonResponse(200, "{\"success\":true,\"message\":\"All data cleared\"}");
}

string handleApiStats() {
    int studentsWithSubjects = 0;
    for (const auto& s : students) {
        if (!s.subjectIds.empty()) studentsWithSubjects++;
    }

    ostringstream oss;
    oss << "{"
        << "\"success\":true,"
        << "\"students\":" << students.size() << ","
        << "\"studentsWithSubjects\":" << studentsWithSubjects << ","
        << "\"subjects\":" << subjects.size() << ","
        << "\"rooms\":" << rooms.size() << ","
        << "\"schedules\":" << schedules.size()
        << "}";
    return buildJsonResponse(200, oss.str());
}

// ==================== 请求路由 ====================
struct HttpRequest {
    string method;
    string path;
    string body;
};

HttpRequest parseHttpRequest(const char* buffer) {
    HttpRequest req;
    string raw(buffer);
    size_t lineEnd = raw.find("\r\n");
    if (lineEnd == string::npos) return req;

    string firstLine = raw.substr(0, lineEnd);
    istringstream iss(firstLine);
    iss >> req.method >> req.path;

    size_t bodyStart = raw.find("\r\n\r\n");
    if (bodyStart != string::npos) {
        req.body = raw.substr(bodyStart + 4);
    }

    return req;
}

string handleOptions() {
    return buildHttpResponse(204, "text/plain", "");
}

string routeRequest(const HttpRequest& req) {
    if (req.method == "OPTIONS") {
        return handleOptions();
    }

    // API 路由
    if (req.method == "POST" && req.path == "/api/import") {
        return handleApiImport(req.body);
    }
    if (req.method == "POST" && req.path == "/api/generate") {
        return handleApiGenerate(req.body);
    }
    if (req.method == "POST" && req.path == "/api/export") {
        return handleApiExport(req.body);
    }
    if (req.method == "GET" && req.path == "/api/schedules") {
        return handleApiSchedules();
    }
    if (req.method == "GET" && req.path == "/api/students") {
        return handleApiStudents();
    }
    if (req.method == "GET" && req.path == "/api/subjects") {
        return handleApiSubjects();
    }
    if (req.method == "GET" && req.path == "/api/rooms") {
        return handleApiRooms();
    }
    if (req.method == "GET" && req.path == "/api/stats") {
        return handleApiStats();
    }
    if (req.method == "POST" && req.path == "/api/clear") {
        return handleApiClear();
    }

    // 健康检查
    if (req.method == "GET" && req.path == "/api/health") {
        return buildJsonResponse(200, "{\"status\":\"ok\",\"service\":\"ExamScheduleBackend\"}");
    }

    // 根路径 - API 文档
    if (req.method == "GET" && (req.path == "/" || req.path == "/index.html")) {
        string html = R"(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Exam Schedule Backend API</title></head>
<body style="font-family:Arial;padding:20px;">
<h1>Exam Schedule Backend API</h1>
<h2>Available Endpoints:</h2>
<table border="1" cellpadding="8" style="border-collapse:collapse;">
<tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
<tr><td>GET</td><td>/api/health</td><td>Health check</td></tr>
<tr><td>GET</td><td>/api/stats</td><td>Get statistics</td></tr>
<tr><td>POST</td><td>/api/import</td><td>Import students from CSV (body: {"filePath":"..."})</td></tr>
<tr><td>POST</td><td>/api/generate</td><td>Generate schedule (body: {"startDate":"YYYY-MM-DD","timeSlotsPerDay":4,"regularRoomCount":3,"labRoomCount":3})</td></tr>
<tr><td>GET</td><td>/api/schedules</td><td>Get all schedules</td></tr>
<tr><td>GET</td><td>/api/students</td><td>Get all students</td></tr>
<tr><td>GET</td><td>/api/subjects</td><td>Get all subjects</td></tr>
<tr><td>GET</td><td>/api/rooms</td><td>Get all rooms</td></tr>
<tr><td>POST</td><td>/api/export</td><td>Export schedule to files (body: {"outputPath":"..."})</td></tr>
<tr><td>POST</td><td>/api/clear</td><td>Clear all data</td></tr>
</table>
</body></html>)";
        return buildHttpResponse(200, "text/html", html);
    }

    return buildJsonResponse(404, "{\"success\":false,\"message\":\"Endpoint not found: " + jsonEscape(req.method + " " + req.path) + "\"}");
}

// ==================== HTTP 服务器 ====================
void initDefaultRooms() {
    rooms = {
        {"R1", "Classroom A101", "regular", 50},
        {"R2", "Classroom A102", "regular", 60},
        {"R3", "Classroom B201", "regular", 45},
        {"R4", "Lab C101", "lab", 30},
        {"R5", "Lab C102", "lab", 35},
        {"R6", "Lab C201", "lab", 40}
    };
}

void handleClient(SOCKET clientSocket) {
    char buffer[BUFFER_SIZE] = {0};
    int recvLen = recv(clientSocket, buffer, BUFFER_SIZE - 1, 0);

    if (recvLen <= 0) {
        closesocket(clientSocket);
        return;
    }

    HttpRequest req = parseHttpRequest(buffer);
    cout << "[HTTP] " << req.method << " " << req.path << endl;

    string response = routeRequest(req);
    send(clientSocket, response.c_str(), static_cast<int>(response.size()), 0);
    closesocket(clientSocket);
}

int startHttpServer() {
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        cerr << "[ERROR] WSAStartup failed" << endl;
        return 1;
    }

    SOCKET serverSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (serverSocket == INVALID_SOCKET) {
        cerr << "[ERROR] socket() failed: " << WSAGetLastError() << endl;
        WSACleanup();
        return 1;
    }

    int opt = 1;
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in serverAddr;
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = INADDR_ANY;
    serverAddr.sin_port = htons(HTTP_PORT);

    if (bind(serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
        cerr << "[ERROR] bind() failed: " << WSAGetLastError() << endl;
        closesocket(serverSocket);
        WSACleanup();
        return 1;
    }

    if (listen(serverSocket, SOMAXCONN) == SOCKET_ERROR) {
        cerr << "[ERROR] listen() failed: " << WSAGetLastError() << endl;
        closesocket(serverSocket);
        WSACleanup();
        return 1;
    }

    cout << "==========================================" << endl;
    cout << "  Exam Schedule Backend Server Started" << endl;
    cout << "==========================================" << endl;
    cout << "  Listening on: http://localhost:" << HTTP_PORT << endl;
    cout << "  API Docs:     http://localhost:" << HTTP_PORT << "/" << endl;
    cout << "  Health:       http://localhost:" << HTTP_PORT << "/api/health" << endl;
    cout << "==========================================" << endl;
    cout << " Press Ctrl+C to stop the server" << endl;
    cout << "==========================================" << endl << endl;

    while (true) {
        sockaddr_in clientAddr;
        int clientLen = sizeof(clientAddr);
        SOCKET clientSocket = accept(serverSocket, (sockaddr*)&clientAddr, &clientLen);

        if (clientSocket == INVALID_SOCKET) {
            cerr << "[ERROR] accept() failed: " << WSAGetLastError() << endl;
            continue;
        }

        handleClient(clientSocket);
    }

    closesocket(serverSocket);
    WSACleanup();
    return 0;
}

// ==================== 主函数 ====================
int main(int argc, char* argv[]) {
    SetConsoleOutputCP(CP_ACP);
    SetConsoleCP(CP_ACP);

    initDefaultRooms();
    cout << "[INIT] Loaded " << rooms.size() << " default exam rooms." << endl;

    // 支持命令行参数：--port 自定义端口
    for (int i = 1; i < argc - 1; i++) {
        if (string(argv[i]) == "--port" && i + 1 < argc) {
            // TODO: 自定义端口支持
        }
    }

    return startHttpServer();
}
#endif /* _WIN32 — 全文件 Windows-only 内容到此结束 */
