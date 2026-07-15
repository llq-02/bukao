#define _CRT_SECURE_NO_WARNINGS
#define NOMINMAX
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

using namespace std;

bool isValidUtf8(const string& str) {
    size_t i = 0;
    while (i < str.size()) {
        unsigned char c = static_cast<unsigned char>(str[i]);
        if (c < 0x80) {
            i++;
        }
        else if ((c & 0xE0) == 0xC0) {
            if (i + 1 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            if ((c2 & 0xC0) != 0x80) return false;
            i += 2;
        }
        else if ((c & 0xF0) == 0xE0) {
            if (i + 2 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            unsigned char c3 = static_cast<unsigned char>(str[i + 2]);
            if ((c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) return false;
            i += 3;
        }
        else if ((c & 0xF8) == 0xF0) {
            if (i + 3 >= str.size()) return false;
            unsigned char c2 = static_cast<unsigned char>(str[i + 1]);
            unsigned char c3 = static_cast<unsigned char>(str[i + 2]);
            unsigned char c4 = static_cast<unsigned char>(str[i + 3]);
            if ((c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80 || (c4 & 0xC0) != 0x80) return false;
            i += 4;
        }
        else {
            return false;
        }
    }
    return true;
}

const int MIN_CAPACITY = 20;
const int MAX_CAPACITY = 70;

const vector<string> DEFAULT_TIME_SLOTS = {
    "08:00-10:00",
    "10:30-12:30",
    "14:00-16:00",
    "16:30-18:30"
};

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

vector<Subject> subjects;
vector<Room> rooms;
vector<Student> students;
vector<ScheduleItem> schedules;

string generateId(const string& prefix) {
    static int counter = 0;
    return prefix + to_string(++counter);
}

void viewSchedules();

void clearInput() {
    cin.clear();
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
}

void displayMenu() {
    cout << "\n==========================================" << endl;
    cout << "        Exam Schedule System" << endl;
    cout << "==========================================" << endl;
    cout << "1. Import Students (Excel/CSV)" << endl;
    cout << "2. Generate Schedule" << endl;
    cout << "3. View Schedule" << endl;
    cout << "4. Export Schedule to Excel" << endl;
    cout << "0. Exit" << endl;
    cout << "==========================================" << endl;
    cout << "Enter option: ";
}

void displayStudentMenu() {
    cout << "\n------------------------" << endl;
    cout << "      Student Management" << endl;
    cout << "------------------------" << endl;
    cout << "1. Add Student" << endl;
    cout << "2. Edit Student" << endl;
    cout << "3. Delete Student" << endl;
    cout << "4. View Students" << endl;
    cout << "0. Back to Main Menu" << endl;
    cout << "------------------------" << endl;
    cout << "Enter option: ";
}

void displaySubjectMenu() {
    cout << "\n------------------------" << endl;
    cout << "      Subject Management" << endl;
    cout << "------------------------" << endl;
    cout << "1. Add Subject" << endl;
    cout << "2. Edit Subject" << endl;
    cout << "3. Delete Subject" << endl;
    cout << "4. View Subjects" << endl;
    cout << "0. Back to Main Menu" << endl;
    cout << "------------------------" << endl;
    cout << "Enter option: ";
}

void displayRoomMenu() {
    cout << "\n------------------------" << endl;
    cout << "      Room Management" << endl;
    cout << "------------------------" << endl;
    cout << "1. Add Room" << endl;
    cout << "2. Edit Room" << endl;
    cout << "3. Delete Room" << endl;
    cout << "4. View Rooms" << endl;
    cout << "0. Back to Main Menu" << endl;
    cout << "------------------------" << endl;
    cout << "Enter option: ";
}

void addStudent() {
    Student s;
    s.id = generateId("S");

    cout << "\nEnter student name: ";
    getline(cin, s.name);

    cout << "Enter student ID: ";
    getline(cin, s.studentId);

    cout << "\nAvailable subjects:" << endl;
    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << i + 1 << ". " << subjects[i].code << " - " << subjects[i].name
            << (subjects[i].isLabRequired ? " (Lab Required)" : "") << endl;
    }

    cout << "\nEnter subject numbers for make-up exam (space-separated, enter 0 to end): ";
    string input;
    getline(cin, input);
    istringstream iss(input);
    int num;
    while (iss >> num) {
        if (num == 0) break;
        if (num >= 1 && num <= static_cast<int>(subjects.size())) {
            s.subjectIds.push_back(subjects[num - 1].id);
        }
    }

    students.push_back(s);
    cout << "\nStudent added successfully!" << endl;
}

void batchImportStudents() {
    if (subjects.empty()) {
        cout << "\nPlease add subjects first!" << endl;
        return;
    }

    cout << "\n==========================================" << endl;
    cout << "        Batch Import Students" << endl;
    cout << "==========================================" << endl;
    cout << "\nAvailable subjects:" << endl;
    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << i + 1 << ". " << subjects[i].code << " - " << subjects[i].name << endl;
    }
    cout << "\nEnter student information, one per line:" << endl;
    cout << "Format: Name StudentID SubjectNum1 SubjectNum2 ... (space-separated)" << endl;
    cout << "Enter empty line to finish" << endl;
    cout << "----------------------------------------" << endl;

    string line;
    int count = 0;
    while (true) {
        getline(cin, line);
        if (line.empty()) break;

        istringstream iss(line);
        Student s;
        s.id = generateId("S");

        iss >> s.name >> s.studentId;

        int subNum;
        while (iss >> subNum) {
            if (subNum >= 1 && subNum <= static_cast<int>(subjects.size())) {
                s.subjectIds.push_back(subjects[subNum - 1].id);
            }
        }

        if (!s.name.empty() && !s.studentId.empty()) {
            students.push_back(s);
            count++;
            cout << "Added: " << s.name << " (" << s.studentId << ")" << endl;
        }
    }

    cout << "\nBatch import completed! Added " << count << " students." << endl;
}

void editStudent() {
    if (students.empty()) {
        cout << "\nNo student data!" << endl;
        return;
    }

    cout << "\nStudent List:" << endl;
    for (size_t i = 0; i < students.size(); ++i) {
        cout << i + 1 << ". " << students[i].studentId << " - " << students[i].name << endl;
    }

    cout << "\nEnter student number to edit: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(students.size())) {
        cout << "Invalid student number!" << endl;
        return;
    }

    Student& s = students[num - 1];
    cout << "\nCurrent Information:" << endl;
    cout << "Name: " << s.name << endl;
    cout << "Student ID: " << s.studentId << endl;
    cout << "Make-up Subjects: ";
    for (const string& subId : s.subjectIds) {
        auto it = find_if(subjects.begin(), subjects.end(), [&](const Subject& sub) {
            return sub.id == subId;
            });
        if (it != subjects.end()) {
            cout << it->name << " ";
        }
    }
    cout << endl;

    cout << "\nEnter new name (press enter to keep unchanged): ";
    string name;
    getline(cin, name);
    if (!name.empty()) s.name = name;

    cout << "Enter new student ID (press enter to keep unchanged): ";
    string sid;
    getline(cin, sid);
    if (!sid.empty()) s.studentId = sid;

    cout << "\nAvailable subjects:" << endl;
    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << i + 1 << ". " << subjects[i].code << " - " << subjects[i].name << endl;
    }

    cout << "\nEnter new subject numbers (space-separated, enter 0 to end): ";
    string input;
    getline(cin, input);
    istringstream iss(input);
    s.subjectIds.clear();
    int subNum;
    while (iss >> subNum) {
        if (subNum == 0) break;
        if (subNum >= 1 && subNum <= static_cast<int>(subjects.size())) {
            s.subjectIds.push_back(subjects[subNum - 1].id);
        }
    }

    cout << "\nStudent information updated successfully!" << endl;
}

void deleteStudent() {
    if (students.empty()) {
        cout << "\nNo student data!" << endl;
        return;
    }

    cout << "\nStudent List:" << endl;
    for (size_t i = 0; i < students.size(); ++i) {
        cout << i + 1 << ". " << students[i].studentId << " - " << students[i].name << endl;
    }

    cout << "\nEnter student number to delete: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(students.size())) {
        cout << "Invalid student number!" << endl;
        return;
    }

    students.erase(students.begin() + num - 1);
    cout << "\nStudent deleted successfully!" << endl;
}

void viewStudents() {
    if (students.empty()) {
        cout << "\nNo student data!" << endl;
        return;
    }

    cout << "\n--------------------------------------------------------------------------------------------------------------------------------------" << endl;
    cout << left
        << setw(6) << "No."
        << setw(14) << "StudentID"
        << setw(12) << "Name"
        << setw(12) << "Campus"
        << setw(20) << "Department"
        << setw(20) << "Major"
        << setw(16) << "Class"
        << setw(20) << "CourseCollege"
        << setw(16) << "CourseUnit" << endl;
    cout << "--------------------------------------------------------------------------------------------------------------------------------------" << endl;

    for (size_t i = 0; i < students.size(); ++i) {
        cout << left
            << setw(6) << i + 1
            << setw(14) << students[i].studentId
            << setw(12) << students[i].name
            << setw(12) << students[i].campus
            << setw(20) << students[i].department
            << setw(20) << students[i].major
            << setw(16) << students[i].className
            << setw(20) << students[i].courseCollege
            << setw(16) << students[i].courseUnit << endl;
    }

    cout << "--------------------------------------------------------------------------------------------------------------------------------------" << endl;
    cout << "Total: " << students.size() << " students" << endl;
}

void addSubject() {
    Subject sub;
    sub.id = generateId("SUB");

    cout << "\nEnter subject name: ";
    getline(cin, sub.name);

    cout << "Enter subject code: ";
    getline(cin, sub.code);

    cout << "Require lab (1=Yes, 0=No): ";
    int lab;
    cin >> lab;
    clearInput();
    sub.isLabRequired = (lab == 1);

    subjects.push_back(sub);
    cout << "\nSubject added successfully!" << endl;
}

void editSubject() {
    if (subjects.empty()) {
        cout << "\nNo subject data!" << endl;
        return;
    }

    cout << "\nSubject List:" << endl;
    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << i + 1 << ". " << subjects[i].code << " - " << subjects[i].name
            << (subjects[i].isLabRequired ? " (Lab Required)" : "") << endl;
    }

    cout << "\nEnter subject number to edit: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(subjects.size())) {
        cout << "Invalid subject number!" << endl;
        return;
    }

    Subject& sub = subjects[num - 1];
    cout << "\nCurrent Information:" << endl;
    cout << "Name: " << sub.name << endl;
    cout << "Code: " << sub.code << endl;
    cout << "Require Lab: " << (sub.isLabRequired ? "Yes" : "No") << endl;

    cout << "\nEnter new name (press enter to keep unchanged): ";
    string name;
    getline(cin, name);
    if (!name.empty()) sub.name = name;

    cout << "Enter new code (press enter to keep unchanged): ";
    string code;
    getline(cin, code);
    if (!code.empty()) sub.code = code;

    cout << "Require lab (1=Yes, 0=No, press enter to keep unchanged): ";
    string lab;
    getline(cin, lab);
    if (!lab.empty()) {
        sub.isLabRequired = (lab == "1");
    }

    cout << "\nSubject information updated successfully!" << endl;
}

void deleteSubject() {
    if (subjects.empty()) {
        cout << "\nNo subject data!" << endl;
        return;
    }

    cout << "\nSubject List:" << endl;
    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << i + 1 << ". " << subjects[i].code << " - " << subjects[i].name << endl;
    }

    cout << "\nEnter subject number to delete: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(subjects.size())) {
        cout << "Invalid subject number!" << endl;
        return;
    }

    string delId = subjects[num - 1].id;
    for (auto& s : students) {
        auto it = find(s.subjectIds.begin(), s.subjectIds.end(), delId);
        if (it != s.subjectIds.end()) {
            s.subjectIds.erase(it);
        }
    }

    subjects.erase(subjects.begin() + num - 1);
    cout << "\nSubject deleted successfully! Removed from related students." << endl;
}

void viewSubjects() {
    if (subjects.empty()) {
        cout << "\nNo subject data!" << endl;
        return;
    }

    cout << "\n==========================================" << endl;
    cout << setw(6) << "No." << setw(12) << "Code" << setw(20) << "Name"
        << setw(12) << "Lab Req." << endl;
    cout << "==========================================" << endl;

    for (size_t i = 0; i < subjects.size(); ++i) {
        cout << setw(6) << i + 1 << setw(12) << subjects[i].code
            << setw(20) << subjects[i].name
            << setw(12) << (subjects[i].isLabRequired ? "Yes" : "No") << endl;
    }

    cout << "==========================================" << endl;
    cout << "Total: " << subjects.size() << " subjects" << endl;
}

void addRoom() {
    Room r;
    r.id = generateId("R");

    cout << "\nEnter room name: ";
    getline(cin, r.name);

    cout << "Enter room type (1=Regular, 2=Lab): ";
    int type;
    cin >> type;
    clearInput();
    r.type = (type == 2) ? "lab" : "regular";

    int capacity;
    do {
        cout << "Enter room capacity (" << MIN_CAPACITY << "-" << MAX_CAPACITY << "): ";
        cin >> capacity;
        clearInput();
    } while (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY);
    r.capacity = capacity;

    rooms.push_back(r);
    cout << "\nRoom added successfully!" << endl;
}

void editRoom() {
    if (rooms.empty()) {
        cout << "\nNo room data!" << endl;
        return;
    }

    cout << "\nRoom List:" << endl;
    for (size_t i = 0; i < rooms.size(); ++i) {
        cout << i + 1 << ". " << rooms[i].name << " - "
            << (rooms[i].type == "lab" ? "Lab" : "Regular")
            << " (Capacity: " << rooms[i].capacity << ")" << endl;
    }

    cout << "\nEnter room number to edit: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(rooms.size())) {
        cout << "Invalid room number!" << endl;
        return;
    }

    Room& r = rooms[num - 1];
    cout << "\nCurrent Information:" << endl;
    cout << "Name: " << r.name << endl;
    cout << "Type: " << (r.type == "lab" ? "Lab" : "Regular") << endl;
    cout << "Capacity: " << r.capacity << endl;

    cout << "\nEnter new name (press enter to keep unchanged): ";
    string name;
    getline(cin, name);
    if (!name.empty()) r.name = name;

    cout << "Enter new type (1=Regular, 2=Lab, press enter to keep unchanged): ";
    string type;
    getline(cin, type);
    if (!type.empty()) {
        r.type = (type == "2") ? "lab" : "regular";
    }

    cout << "Enter new capacity (" << MIN_CAPACITY << "-" << MAX_CAPACITY << ", press enter to keep unchanged): ";
    string cap;
    getline(cin, cap);
    if (!cap.empty()) {
        int capacity = stoi(cap);
        if (capacity >= MIN_CAPACITY && capacity <= MAX_CAPACITY) {
            r.capacity = capacity;
        }
        else {
            cout << "Capacity out of range, keeping original!" << endl;
        }
    }

    cout << "\nRoom information updated successfully!" << endl;
}

void deleteRoom() {
    if (rooms.empty()) {
        cout << "\nNo room data!" << endl;
        return;
    }

    cout << "\nRoom List:" << endl;
    for (size_t i = 0; i < rooms.size(); ++i) {
        cout << i + 1 << ". " << rooms[i].name << " - "
            << (rooms[i].type == "lab" ? "Lab" : "Regular") << endl;
    }

    cout << "\nEnter room number to delete: ";
    int num;
    cin >> num;
    clearInput();

    if (num < 1 || num > static_cast<int>(rooms.size())) {
        cout << "Invalid room number!" << endl;
        return;
    }

    rooms.erase(rooms.begin() + num - 1);
    cout << "\nRoom deleted successfully!" << endl;
}

void viewRooms() {
    if (rooms.empty()) {
        cout << "\nNo room data!" << endl;
        return;
    }

    cout << "\n==========================================" << endl;
    cout << setw(6) << "No." << setw(20) << "Name" << setw(12) << "Type"
        << setw(8) << "Capacity" << endl;
    cout << "==========================================" << endl;

    for (size_t i = 0; i < rooms.size(); ++i) {
        cout << setw(6) << i + 1 << setw(20) << rooms[i].name
            << setw(12) << (rooms[i].type == "lab" ? "Lab" : "Regular")
            << setw(8) << rooms[i].capacity << endl;
    }

    cout << "==========================================" << endl;
    cout << "Total: " << rooms.size() << " rooms" << endl;
}

vector<ScheduleItem> generateSchedule() {
    if (students.empty()) {
        cout << "\nNo students! Please import students first." << endl;
        return {};
    }

    const int DEFAULT_REGULAR_CAPACITY = 90;
    const int DEFAULT_LAB_CAPACITY = 70;
    const int MIN_REGULAR_STUDENTS = 40;
    const int MIN_LAB_STUDENTS = 20;

    cout << "\n==========================================" << endl;
    cout << "        Generate Exam Schedule" << endl;
    cout << "==========================================" << endl;

    cout << "\nEnter start exam date (format: YYYY-MM-DD): ";
    string startDate;
    getline(cin, startDate);

    cout << "\nEnter number of time slots per day (1-4): ";
    int timeSlotsPerDay;
    while (!(cin >> timeSlotsPerDay) || timeSlotsPerDay < 1 || timeSlotsPerDay > 4) {
        cin.clear();
        cin.ignore(numeric_limits<streamsize>::max(), '\n');
        cout << "Invalid! Enter 1-4: ";
    }

    cout << "\n=== Exam Rooms ===" << endl;
    cout << "(Regular rooms: " << DEFAULT_REGULAR_CAPACITY << " seats each, Lab rooms: " << DEFAULT_LAB_CAPACITY << " seats each)" << endl;
    
    cout << "Enter number of regular exam rooms: ";
    int regularRoomCount;
    while (!(cin >> regularRoomCount) || regularRoomCount < 1) {
        cin.clear();
        cin.ignore(numeric_limits<streamsize>::max(), '\n');
        cout << "Invalid! Enter at least 1: ";
    }

    cout << "Enter number of lab exam rooms: ";
    int labRoomCount;
    while (!(cin >> labRoomCount) || labRoomCount < 0) {
        cin.clear();
        cin.ignore(numeric_limits<streamsize>::max(), '\n');
        cout << "Invalid! Enter 0 or more: ";
    }
    clearInput();

    rooms.clear();
    for (int i = 1; i <= regularRoomCount; i++) {
        Room r;
        r.id = "R" + to_string(i);
        r.name = "Room " + to_string(i);
        r.type = "regular";
        r.capacity = DEFAULT_REGULAR_CAPACITY;
        rooms.push_back(r);
    }
    for (int i = 1; i <= labRoomCount; i++) {
        Room r;
        r.id = "LAB" + to_string(i);
        r.name = "Lab " + to_string(i);
        r.type = "lab";
        r.capacity = DEFAULT_LAB_CAPACITY;
        rooms.push_back(r);
    }

    cout << "\n[LOG] Created " << regularRoomCount << " regular rooms (capacity: " << DEFAULT_REGULAR_CAPACITY << ")" << endl;
    cout << "[LOG] Created " << labRoomCount << " lab rooms (capacity: " << DEFAULT_LAB_CAPACITY << ")" << endl;

    int labSubjectCount = 0;
    int regularSubjectCount = 0;
    for (const Subject& sub : subjects) {
        if (sub.isLabRequired) labSubjectCount++;
        else regularSubjectCount++;
    }
    cout << "[LOG] Found " << labSubjectCount << " lab exam subjects, " << regularSubjectCount << " regular exam subjects" << endl;

    vector<Room> regularRooms, labRooms;
    for (const Room& room : rooms) {
        if (room.type == "regular") {
            regularRooms.push_back(room);
        }
        else {
            labRooms.push_back(room);
        }
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

    int totalTimeSlots = max(totalRequiredSlots, static_cast<int>(sortedSubjects.size()));
    int maxTimeSlots = static_cast<int>(sortedSubjects.size()) * 2;
    cout << "[LOG] Total required time slots: " << totalTimeSlots << endl;
    cout << "[LOG] Time slots per day: " << timeSlotsPerDay << endl;
    cout << "[LOG] Estimated exam days: " << (totalTimeSlots + timeSlotsPerDay - 1) / timeSlotsPerDay << endl;

    vector<ScheduleItem> newSchedules;
    map<string, set<string>> studentAssignedTimes;
    map<string, bool> studentSubjectAssigned;
    map<string, string> subjectAssignedTime;

    int slotIdx = 0;
    while (slotIdx < maxTimeSlots && subjectAssignedTime.size() < sortedSubjects.size()) {
        string timeSlot = "T" + to_string(slotIdx + 1);
        
        int dayOffset = slotIdx / timeSlotsPerDay;
        
        int year, month, day;
        sscanf(startDate.c_str(), "%d-%d-%d", &year, &month, &day);
        
        struct tm tmDate = {0};
        tmDate.tm_year = year - 1900;
        tmDate.tm_mon = month - 1;
        tmDate.tm_mday = day + dayOffset;
        mktime(&tmDate);
        
        char dateBuffer[20];
        strftime(dateBuffer, sizeof(dateBuffer), "%Y-%m-%d", &tmDate);
        string currentDate(dateBuffer);

        map<string, int> roomCount;
        map<string, vector<string>> roomSubjects;
        for (const Room& room : rooms) {
            roomCount[room.id] = 0;
            roomSubjects[room.id] = vector<string>();
        }

        bool slotUsed = false;

        vector<string> largeSubjects;
        vector<string> smallSubjects;
        
        for (const string& subjectId : sortedSubjects) {
            if (subjectAssignedTime.find(subjectId) != subjectAssignedTime.end()) continue;
            
            auto subIt = find_if(subjects.begin(), subjects.end(),
                [&](const Subject& sub) { return sub.id == subjectId; });
            if (subIt == subjects.end()) continue;
            
            int capacity = subIt->isLabRequired ? DEFAULT_LAB_CAPACITY : DEFAULT_REGULAR_CAPACITY;
            int minStudents = subIt->isLabRequired ? MIN_LAB_STUDENTS : MIN_REGULAR_STUDENTS;
            
            int count = 0;
            for (const Student& student : students) {
                auto it = find(student.subjectIds.begin(), student.subjectIds.end(), subjectId);
                if (it == student.subjectIds.end()) continue;
                string key = student.id + "_" + subjectId;
                if (studentSubjectAssigned[key]) continue;
                if (studentAssignedTimes[student.id].count(timeSlot)) continue;
                count++;
            }
            
            if (count >= minStudents) {
                largeSubjects.push_back(subjectId);
                cout << "[LOG] Subject " << subIt->name << " (" << (subIt->isLabRequired ? "Lab" : "Regular") 
                    << ") is large: " << count << " >= " << minStudents << endl;
            } else if (count > 0) {
                smallSubjects.push_back(subjectId);
                cout << "[LOG] Subject " << subIt->name << " (" << (subIt->isLabRequired ? "Lab" : "Regular") 
                    << ") is small: " << count << " < " << minStudents << endl;
            }
        }

        for (const string& subjectId : largeSubjects) {
            if (subjectAssignedTime.find(subjectId) != subjectAssignedTime.end()) continue;

            auto subIt = find_if(subjects.begin(), subjects.end(),
                [&](const Subject& sub) { return sub.id == subjectId; });
            if (subIt == subjects.end()) continue;

            bool isLabRequired = subIt->isLabRequired;
            const vector<Room>& targetRooms = isLabRequired ? labRooms : regularRooms;
            int capacity = isLabRequired ? DEFAULT_LAB_CAPACITY : DEFAULT_REGULAR_CAPACITY;

            if (targetRooms.empty()) {
                cout << "[WARNING] No " << (isLabRequired ? "lab" : "regular") << " rooms for large subject " 
                    << subIt->name << ", skipping!" << endl;
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

            int roomsNeeded = (static_cast<int>(availableStudents.size()) + capacity - 1) / capacity;

            int availableRooms = 0;
            for (const Room& room : targetRooms) {
                if (roomCount[room.id] == 0) availableRooms++;
            }

            if (availableRooms < roomsNeeded) continue;

            vector<ScheduleItem> tempItems;
            vector<pair<string, string>> tempAssignedStudents;
            map<string, int> tempRoomCount = roomCount;
            map<string, vector<string>> tempRoomSubjects = roomSubjects;

            int studentIndex = 0;
            for (const Room& room : targetRooms) {
                if (studentIndex >= static_cast<int>(availableStudents.size())) break;
                if (tempRoomCount[room.id] != 0) continue;

                tempRoomSubjects[room.id].push_back(subjectId);

                while (studentIndex < static_cast<int>(availableStudents.size()) && 
                       tempRoomCount[room.id] < room.capacity) {
                    const auto& studentPair = availableStudents[studentIndex];
                    const string& studentId = studentPair.first;
                    string key = studentId + "_" + subjectId;

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
                    studentIndex++;
                }
            }

            if (tempItems.size() == availableStudents.size()) {
                for (const auto& item : tempItems) {
                    newSchedules.push_back(item);
                }
                for (const auto& studentPair : tempAssignedStudents) {
                    const string& studentId = studentPair.first;
                    string key = studentId + "_" + subjectId;
                    studentAssignedTimes[studentId].insert(timeSlot);
                    studentSubjectAssigned[key] = true;
                }
                roomCount = tempRoomCount;
                roomSubjects = tempRoomSubjects;
                
                subjectAssignedTime[subjectId] = timeSlot;
                slotUsed = true;
                cout << "[LOG] Subject " << subIt->name << " assigned to " << timeSlot 
                    << " (" << tempItems.size() << " students, " << roomsNeeded << " rooms)" << endl;
            }
        }

        vector<pair<string, pair<string, vector<pair<string, string> > > > > pendingRegularSubjects;
        vector<pair<string, pair<string, vector<pair<string, string> > > > > pendingLabSubjects;
        
        for (const string& subjectId : smallSubjects) {
            if (subjectAssignedTime.find(subjectId) != subjectAssignedTime.end()) continue;

            auto subIt = find_if(subjects.begin(), subjects.end(),
                [&](const Subject& sub) { return sub.id == subjectId; });
            if (subIt == subjects.end()) continue;

            bool isLabRequired = subIt->isLabRequired;
            const vector<Room>& targetRooms = isLabRequired ? labRooms : regularRooms;
            int capacity = isLabRequired ? DEFAULT_LAB_CAPACITY : DEFAULT_REGULAR_CAPACITY;
            int minStudents = isLabRequired ? MIN_LAB_STUDENTS : MIN_REGULAR_STUDENTS;

            if (targetRooms.empty()) {
                cout << "[WARNING] No " << (isLabRequired ? "lab" : "regular") << " rooms for small subject " 
                    << subIt->name << ", skipping!" << endl;
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

            bool canAssign = false;
            string assignedRoomId = "";

            for (const Room& room : targetRooms) {
                if (roomCount[room.id] > 0 && 
                    roomCount[room.id] + static_cast<int>(availableStudents.size()) <= room.capacity) {
                    int newCount = roomCount[room.id] + static_cast<int>(availableStudents.size());
                    if (newCount >= minStudents) {
                        canAssign = true;
                        assignedRoomId = room.id;
                        break;
                    }
                }
            }

            if (canAssign && !assignedRoomId.empty()) {
                vector<ScheduleItem> tempItems;
                vector<pair<string, string>> tempAssignedStudents;

                for (const auto& studentPair : availableStudents) {
                    const string& studentId = studentPair.first;
                    string key = studentId + "_" + subjectId;

                    ScheduleItem item;
                    item.id = generateId("SCH");
                    item.studentId = studentId;
                    item.subjectId = subjectId;
                    item.roomId = assignedRoomId;
                    item.timeSlot = timeSlot;
                    item.examDate = currentDate;

                    tempItems.push_back(item);
                    tempAssignedStudents.push_back(studentPair);
                }

                for (const auto& item : tempItems) {
                    newSchedules.push_back(item);
                }
                for (const auto& studentPair : tempAssignedStudents) {
                    const string& studentId = studentPair.first;
                    string key = studentId + "_" + subjectId;
                    studentAssignedTimes[studentId].insert(timeSlot);
                    studentSubjectAssigned[key] = true;
                }
                roomCount[assignedRoomId] += static_cast<int>(tempItems.size());
                
                auto it = find(roomSubjects[assignedRoomId].begin(), roomSubjects[assignedRoomId].end(), subjectId);
                if (it == roomSubjects[assignedRoomId].end()) {
                    roomSubjects[assignedRoomId].push_back(subjectId);
                }
                
                subjectAssignedTime[subjectId] = timeSlot;
                slotUsed = true;
                
                auto roomIt = find_if(rooms.begin(), rooms.end(),
                    [&](const Room& rm) { return rm.id == assignedRoomId; });
                string roomName = roomIt != rooms.end() ? roomIt->name : "Unknown";
                cout << "[LOG] Subject " << subIt->name << " assigned to " << timeSlot 
                    << " Room " << roomName << " (" << tempItems.size() << " students, mixed)" << endl;
            } else {
                if (isLabRequired) {
                    pendingLabSubjects.emplace_back(subjectId, make_pair(subIt->name, availableStudents));
                } else {
                    pendingRegularSubjects.emplace_back(subjectId, make_pair(subIt->name, availableStudents));
                }
            }
        }

        auto assignPendingSubjects = [&](vector<pair<string, pair<string, vector<pair<string, string> > > > >& pending,
            const vector<Room>& targetRooms, int capacity, int minStudents) {
            
            if (pending.empty() || targetRooms.empty()) return;

            vector<string> emptyRooms;
            for (const Room& room : targetRooms) {
                if (roomCount[room.id] == 0) {
                    emptyRooms.push_back(room.id);
                }
            }

            if (emptyRooms.empty()) return;

            sort(pending.begin(), pending.end(), [](const auto& a, const auto& b) {
                return a.second.second.size() > b.second.second.size();
            });

            for (const string& roomId : emptyRooms) {
                if (pending.empty()) break;

                vector<pair<string, pair<string, vector<pair<string, string> > > > > toAssign;
                vector<size_t> toEraseIndices;
                int totalStudents = 0;

                int idx = 0;
                for (auto it = pending.begin(); it != pending.end(); ++it, ++idx) {
                    int subCount = static_cast<int>(it->second.second.size());
                    if (totalStudents + subCount <= capacity) {
                        toAssign.push_back(*it);
                        toEraseIndices.push_back(idx);
                        totalStudents += subCount;
                    }
                }

                bool meetsMin = (totalStudents >= minStudents);
                bool isLastResort = (pending.size() == static_cast<size_t>(toAssign.size()));

                if (meetsMin || isLastResort) {
                    for (size_t i = toEraseIndices.size() - 1; i != SIZE_MAX; --i) {
                        auto eraseIt = pending.begin();
                        advance(eraseIt, toEraseIndices[i]);
                        pending.erase(eraseIt);
                    }

                    if (!meetsMin && isLastResort) {
                        auto roomIt = find_if(rooms.begin(), rooms.end(),
                            [&](const Room& rm) { return rm.id == roomId; });
                        string roomName = roomIt != rooms.end() ? roomIt->name : "Unknown";
                        cout << "[WARNING] Room " << roomName << " has " << totalStudents 
                            << " students, below minimum " << minStudents << endl;
                    }

                    for (const auto& subjectPair : toAssign) {
                        const string& subjectId = subjectPair.first;
                        const string& subjectName = subjectPair.second.first;
                        const vector<pair<string, string> >& studentsForSubject = subjectPair.second.second;

                        for (const auto& studentPair : studentsForSubject) {
                            const string& studentId = studentPair.first;
                            string key = studentId + "_" + subjectId;

                            ScheduleItem item;
                            item.id = generateId("SCH");
                            item.studentId = studentId;
                            item.subjectId = subjectId;
                            item.roomId = roomId;
                            item.timeSlot = timeSlot;
                            item.examDate = currentDate;

                            newSchedules.push_back(item);
                            studentAssignedTimes[studentId].insert(timeSlot);
                            studentSubjectAssigned[key] = true;
                        }
                        roomCount[roomId] += static_cast<int>(studentsForSubject.size());
                        roomSubjects[roomId].push_back(subjectId);
                        subjectAssignedTime[subjectId] = timeSlot;
                        slotUsed = true;

                        auto roomIt = find_if(rooms.begin(), rooms.end(),
                            [&](const Room& rm) { return rm.id == roomId; });
                        string roomName = roomIt != rooms.end() ? roomIt->name : "Unknown";
                        cout << "[LOG] Subject " << subjectName << " assigned to " << timeSlot 
                            << " Room " << roomName << " (" << studentsForSubject.size() << " students, mixed)" << endl;
                    }
                } else {
                    break;
                }
            }
        };

        assignPendingSubjects(pendingRegularSubjects, regularRooms, DEFAULT_REGULAR_CAPACITY, MIN_REGULAR_STUDENTS);
        assignPendingSubjects(pendingLabSubjects, labRooms, DEFAULT_LAB_CAPACITY, MIN_LAB_STUDENTS);

        slotIdx++;
    }

    if (subjectAssignedTime.size() < sortedSubjects.size()) {
        cout << "\n[WARNING] Not all subjects could be scheduled!" << endl;
        for (const string& subjectId : sortedSubjects) {
            if (subjectAssignedTime.find(subjectId) == subjectAssignedTime.end()) {
                auto subIt = find_if(subjects.begin(), subjects.end(),
                    [&](const Subject& sub) { return sub.id == subjectId; });
                if (subIt != subjects.end()) {
                    cout << "  - " << subIt->name << " could not be scheduled" << endl;
                }
            }
        }
    }

    int unassignedCount = 0;
    for (const Student& student : students) {
        for (const string& subjectId : student.subjectIds) {
            string key = student.id + "_" + subjectId;
            if (!studentSubjectAssigned[key]) {
                unassignedCount++;
            }
        }
    }

    if (unassignedCount > 0) {
        cout << "\nWarning: " << unassignedCount << " subject-student combinations cannot be scheduled!" << endl;
        cout << "Consider adding more rooms or time slots." << endl;
    }

    cout << "\n[LOG] Total scheduled: " << newSchedules.size() << endl;
    return newSchedules;
}

void runScheduleGeneration() {
    cout << "\n==========================================" << endl;
    cout << "        Generate Schedule" << endl;
    cout << "==========================================" << endl;

    schedules = generateSchedule();

    if (!schedules.empty()) {
        cout << "\nSchedule generated! Total: " << schedules.size() << " entries." << endl;
        cout << "View schedule (1=Yes, 0=No): ";
        int choice;
        cin >> choice;
        clearInput();

        if (choice == 1) {
            viewSchedules();
        }
    }
}

void viewSchedules() {
    if (schedules.empty()) {
        cout << "\nNo schedule data! Please generate schedule first." << endl;
        return;
    }

    cout << "\n==========================================" << endl;
    cout << "        View Schedule" << endl;
    cout << "==========================================" << endl;

    cout << "\n1. View by Time Slot" << endl;
    cout << "2. View by Room" << endl;
    cout << "3. View by Student" << endl;
    cout << "4. View by Subject" << endl;
    cout << "\nSelect view mode: ";
    int choice;
    cin >> choice;
    clearInput();

    if (choice == 1) {
        map<string, vector<ScheduleItem>> byDate;
        for (const auto& s : schedules) {
            byDate[s.examDate].push_back(s);
        }

        for (const auto& datePair : byDate) {
            const string& date = datePair.first;
            const vector<ScheduleItem>& dateItems = datePair.second;
            
            map<string, vector<ScheduleItem>> byTime;
            for (const auto& item : dateItems) {
                byTime[item.timeSlot].push_back(item);
            }

            for (const auto& timePair : byTime) {
                const string& time = timePair.first;
                const vector<ScheduleItem>& items = timePair.second;
                cout << "\n=======================" << endl;
                cout << "Date: " << date << " | Time Slot: " << time << endl;
                cout << "=======================" << endl;

                map<string, vector<ScheduleItem>> byRoom;
                for (const auto& item : items) {
                    byRoom[item.roomId].push_back(item);
                }

                for (const auto& roomPair : byRoom) {
                    const string& roomId = roomPair.first;
                    const vector<ScheduleItem>& roomItems = roomPair.second;
                    auto roomIt = find_if(rooms.begin(), rooms.end(),
                        [&](const Room& rm) { return rm.id == roomId; });
                    if (roomIt != rooms.end()) {
                        cout << "\nRoom: " << roomIt->name << " ("
                            << (roomIt->type == "lab" ? "Lab" : "Regular")
                            << ", Count: " << roomItems.size() << "/" << roomIt->capacity << ")" << endl;
                        cout << "----------------------------------------" << endl;
                        cout << setw(12) << "StudentID" << setw(12) << "Name" << setw(20) << "Subject" << endl;
                        cout << "----------------------------------------" << endl;

                        for (const auto& item : roomItems) {
                            auto studentIt = find_if(students.begin(), students.end(),
                                [&](const Student& st) { return st.id == item.studentId; });
                            auto subIt = find_if(subjects.begin(), subjects.end(),
                                [&](const Subject& sb) { return sb.id == item.subjectId; });

                            if (studentIt != students.end() && subIt != subjects.end()) {
                                cout << setw(12) << studentIt->studentId
                                    << setw(12) << studentIt->name
                                    << setw(20) << subIt->name << endl;
                            }
                        }
                    }
                }
            }
        }
    }
    else if (choice == 2) {
        map<string, vector<ScheduleItem>> byRoom;
        for (const auto& s : schedules) {
            byRoom[s.roomId].push_back(s);
        }

        for (const auto& roomPair : byRoom) {
            const string& roomId = roomPair.first;
            const vector<ScheduleItem>& items = roomPair.second;
            auto roomIt = find_if(rooms.begin(), rooms.end(),
                [&](const Room& rm) { return rm.id == roomId; });
            if (roomIt == rooms.end()) continue;

            cout << "\n------------------------" << endl;
            cout << "Room: " << roomIt->name << " ("
                << (roomIt->type == "lab" ? "Lab" : "Regular")
                << ", Capacity: " << roomIt->capacity << ")" << endl;
            cout << "------------------------" << endl;

            map<string, vector<ScheduleItem>> byDate;
            for (const auto& item : items) {
                byDate[item.examDate].push_back(item);
            }

            for (const auto& datePair : byDate) {
                const string& date = datePair.first;
                const vector<ScheduleItem>& dateItems = datePair.second;

                map<string, vector<ScheduleItem>> byTime;
                for (const auto& item : dateItems) {
                    byTime[item.timeSlot].push_back(item);
                }

                for (const auto& timePair : byTime) {
                    const string& time = timePair.first;
                    const vector<ScheduleItem>& timeItems = timePair.second;
                    cout << "\nDate: " << date << " | Time Slot: " << time << " (" << timeItems.size() << " students)" << endl;
                    cout << "----------------------------------------" << endl;
                    cout << setw(12) << "StudentID" << setw(12) << "Name" << setw(20) << "Subject" << endl;
                    cout << "----------------------------------------" << endl;

                    for (const auto& item : timeItems) {
                        auto studentIt = find_if(students.begin(), students.end(),
                            [&](const Student& st) { return st.id == item.studentId; });
                        auto subIt = find_if(subjects.begin(), subjects.end(),
                            [&](const Subject& sb) { return sb.id == item.subjectId; });

                        if (studentIt != students.end() && subIt != subjects.end()) {
                            cout << setw(12) << studentIt->studentId
                                << setw(12) << studentIt->name
                                << setw(20) << subIt->name << endl;
                        }
                    }
                }
            }
        }
    }
    else if (choice == 3) {
        map<string, vector<ScheduleItem>> byStudent;
        for (const auto& s : schedules) {
            byStudent[s.studentId].push_back(s);
        }

        for (const auto& studentPair : byStudent) {
            const string& studentId = studentPair.first;
            const vector<ScheduleItem>& items = studentPair.second;
            auto studentIt = find_if(students.begin(), students.end(),
                [&](const Student& st) { return st.id == studentId; });
            if (studentIt == students.end()) continue;

            cout << "\n------------------------" << endl;
            cout << "Student: " << studentIt->name << " (" << studentIt->studentId << ")" << endl;
            cout << "------------------------" << endl;
            cout << setw(16) << "Date" << setw(16) << "Time Slot" << setw(16) << "Room" << setw(16) << "Subject" << endl;
            cout << "------------------------------------------------------------------------" << endl;

            for (const auto& item : items) {
                auto roomIt = find_if(rooms.begin(), rooms.end(),
                    [&](const Room& rm) { return rm.id == item.roomId; });
                auto subIt = find_if(subjects.begin(), subjects.end(),
                    [&](const Subject& sb) { return sb.id == item.subjectId; });

                cout << setw(16) << item.examDate
                    << setw(16) << item.timeSlot
                    << setw(16) << (roomIt != rooms.end() ? roomIt->name : "Unknown")
                    << setw(16) << (subIt != subjects.end() ? subIt->name : "Unknown") << endl;
            }
        }
    }
    else if (choice == 4) {
        map<string, vector<ScheduleItem>> bySubject;
        for (const auto& s : schedules) {
            bySubject[s.subjectId].push_back(s);
        }

        for (const auto& subjectPair : bySubject) {
            const string& subjectId = subjectPair.first;
            const vector<ScheduleItem>& items = subjectPair.second;
            auto subIt = find_if(subjects.begin(), subjects.end(),
                [&](const Subject& sb) { return sb.id == subjectId; });
            if (subIt == subjects.end()) continue;

            cout << "\n==========================================================================" << endl;
            cout << "Subject: " << subIt->code << " - " << subIt->name
                << (subIt->isLabRequired ? " (Lab Exam)" : " (Regular Exam)") << endl;
            cout << "==========================================================================" << endl;

            map<string, vector<ScheduleItem>> byDate;
            for (const auto& item : items) {
                byDate[item.examDate].push_back(item);
            }

            for (const auto& datePair : byDate) {
                const string& date = datePair.first;
                const vector<ScheduleItem>& dateItems = datePair.second;

                map<string, vector<ScheduleItem>> byTimeRoom;
                for (const auto& item : dateItems) {
                    string key = item.timeSlot + "|" + item.roomId;
                    byTimeRoom[key].push_back(item);
                }

                for (const auto& keyPair : byTimeRoom) {
                    const string& key = keyPair.first;
                    const vector<ScheduleItem>& slotItems = keyPair.second;
                    size_t pipePos = key.find("|");
                    string timeSlot = key.substr(0, pipePos);
                    string roomId = key.substr(pipePos + 1);

                    auto roomIt = find_if(rooms.begin(), rooms.end(),
                        [&](const Room& rm) { return rm.id == roomId; });

                    cout << "\n+------------------------------+------------------------------+" << endl;
                    cout << "| Exam Time: " << setw(16) << timeSlot
                        << " | Room: " << setw(16) << (roomIt != rooms.end() ? roomIt->name : "Unknown")
                        << " |" << endl;
                    cout << "+------------------------------+------------------------------+" << endl;
                    cout << "| " << setw(12) << "StudentID" << setw(12) << "Name" << " | " << setw(16) << "Room Type" << " |" << endl;
                    cout << "+------------------------------+------------------------------+" << endl;

                    for (const auto& item : slotItems) {
                        auto studentIt = find_if(students.begin(), students.end(),
                            [&](const Student& st) { return st.id == item.studentId; });

                        if (studentIt != students.end()) {
                            cout << "| " << setw(12) << studentIt->studentId
                                << setw(12) << studentIt->name << " | "
                                << setw(16) << (roomIt != rooms.end() ? (roomIt->type == "lab" ? "Lab" : "Regular") : "Unknown")
                                << " |" << endl;
                        }
                    }

                    cout << "+------------------------------+------------------------------+" << endl;
                    cout << "  Total students for this session: " << slotItems.size() << endl;
                }

            cout << "\nTotal students for this subject: " << items.size() << endl;
        }
    }
}}

void importData() {
    cout << "\nEnter data file path: ";
    string path;
    getline(cin, path);

    ifstream file(path);
    if (!file.is_open()) {
        cout << "Cannot open file!" << endl;
        return;
    }

    string line;
    string section;

    while (getline(file, line)) {
        if (line.find("[Subjects]") != string::npos) {
            section = "subjects";
            continue;
        }
        if (line.find("[Rooms]") != string::npos) {
            section = "rooms";
            continue;
        }
        if (line.find("[Students]") != string::npos) {
            section = "students";
            continue;
        }
        if (line.empty() || line[0] == '#') continue;

        istringstream iss(line);
        if (section == "subjects") {
            Subject sub;
            string lab;
            iss >> sub.id >> sub.code >> sub.name >> lab;
            sub.isLabRequired = (lab == "1");
            subjects.push_back(sub);
        }
        else if (section == "rooms") {
            Room r;
            iss >> r.id >> r.name >> r.type >> r.capacity;
            rooms.push_back(r);
        }
        else if (section == "students") {
            Student s;
            string subCount;
            iss >> s.id >> s.studentId >> s.name >> subCount;
            int count = stoi(subCount);
            for (int i = 0; i < count; ++i) {
                string subId;
                iss >> subId;
                s.subjectIds.push_back(subId);
            }
            students.push_back(s);
        }
    }

    file.close();
    cout << "\nData imported successfully!" << endl;
}

void exportData() {
    cout << "\nEnter export file path: ";
    string path;
    getline(cin, path);
    if (path.empty()) {
        getline(cin, path);
    }

    ofstream file(path);
    if (!file.is_open()) {
        cout << "Cannot create file!" << endl;
        return;
    }

    file << "# Exam Schedule System - Data Export" << endl << endl;

    file << "[Subjects]" << endl;
    for (const auto& s : subjects) {
        file << s.id << " " << s.code << " " << s.name << " "
            << (s.isLabRequired ? "1" : "0") << endl;
    }

    file << endl << "[Rooms]" << endl;
    for (const auto& r : rooms) {
        file << r.id << " " << r.name << " " << r.type << " " << r.capacity << endl;
    }

    file << endl << "[Students]" << endl;
    for (const auto& s : students) {
        file << s.id << " " << s.studentId << " " << s.name << " " << s.subjectIds.size();
        for (const auto& subId : s.subjectIds) {
            file << " " << subId;
        }
        file << endl;
    }

    if (!schedules.empty()) {
        file << endl << "[Schedules]" << endl;
        for (const auto& s : schedules) {
            file << s.id << " " << s.studentId << " " << s.subjectId << " "
                << s.roomId << " " << s.examDate << " " << s.timeSlot << endl;
        }
    }

    file.close();
    cout << "\nData exported successfully!" << endl;
    cout << "File saved to: " << path << endl;
}

void importStudentsFromExcel() {
    cout << "\n==========================================" << endl;
    cout << "        Import Students from Excel" << endl;
    cout << "==========================================" << endl;
    cout << "\nNote: Please save your Excel file as CSV format first." << endl;
    cout << "Supported CSV format (9 columns):" << endl;
    cout << "StudentID,Name,Campus,Department,Major,ClassName,CourseCode,CourseName,IsLabExam" << endl;
    cout << "(IsLabExam: 1=Lab exam, 0=Regular exam)" << endl;
    cout << "\nEnter CSV file path: ";
    string csvPath;
    getline(cin, csvPath);
    if (csvPath.empty()) {
        getline(cin, csvPath);
    }

    cout << "[LOG] CSV path entered: " << csvPath << endl;

    int len = MultiByteToWideChar(CP_ACP, 0, csvPath.c_str(), -1, NULL, 0);
    wchar_t* wpath = new wchar_t[len];
    MultiByteToWideChar(CP_ACP, 0, csvPath.c_str(), -1, wpath, len);

    FILE* fp = _wfopen(wpath, L"rb");
    delete[] wpath;

    if (!fp) {
        cout << "[ERROR] Cannot open CSV file: " << csvPath << endl;
        cout << "[ERROR] Please check if the file exists and you have permission to read it." << endl;
        return;
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
        if (hasBom) {
            content = content.substr(3);
        }
        cout << "[LOG] Detected UTF-8 encoding, converting to GBK..." << endl;
        
        int len = MultiByteToWideChar(CP_UTF8, 0, content.c_str(), -1, NULL, 0);
        wchar_t* wstr = new wchar_t[len];
        MultiByteToWideChar(CP_UTF8, 0, content.c_str(), -1, wstr, len);
        
        int gbkLen = WideCharToMultiByte(CP_ACP, 0, wstr, -1, NULL, 0, NULL, NULL);
        char* gbkStr = new char[gbkLen];
        WideCharToMultiByte(CP_ACP, 0, wstr, -1, gbkStr, gbkLen, NULL, NULL);
        
        content = gbkStr;
        delete[] wstr;
        delete[] gbkStr;
    }
    else {
        cout << "[LOG] Detected GBK encoding." << endl;
    }

    istringstream contentStream(content);
    string line;
    if (!getline(contentStream, line)) {
        cout << "[ERROR] The file is empty or cannot be read!" << endl;
        return;
    }

    if (line.size() >= 3 &&
        static_cast<unsigned char>(line[0]) == 0xEF &&
        static_cast<unsigned char>(line[1]) == 0xBB &&
        static_cast<unsigned char>(line[2]) == 0xBF) {
        line = line.substr(3);
        cout << "[LOG] Detected UTF-8 BOM, skipping..." << endl;
    }

    map<string, Student> studentMap;
    map<string, string> subjectCodeToId;
    int lineNumber = 1;
    int validLines = 0;
    int skippedLines = 0;
    int newSubjectsCreated = 0;

    while (getline(contentStream, line)) {
        lineNumber++;

        if (line.empty()) {
            skippedLines++;
            continue;
        }

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
        if (commaPos != string::npos) {
            isLabExamStr = isLabExamStr.substr(0, commaPos);
        }
        size_t quotePos = isLabExamStr.find('"');
        if (quotePos != string::npos) {
            isLabExamStr = isLabExamStr.substr(0, quotePos);
        }

        bool isLabExam = false;
        if (isLabExamStr == "1" || isLabExamStr == "yes" || isLabExamStr == "true") {
            isLabExam = true;
        } else {
            unsigned char* p = reinterpret_cast<unsigned char*>(&isLabExamStr[0]);
            if (isLabExamStr.size() >= 2 && p[0] == 0xCA && p[1] == 0xC7) {
                isLabExam = true;
            } else if (isLabExamStr.size() >= 3 && p[0] == 0xE6 && p[1] == 0x98 && p[2] == 0xAF) {
                isLabExam = true;
            }
        }

        if (studentId.empty() && name.empty()) {
            skippedLines++;
            continue;
        }

        string subjectId;
        if (!courseCode.empty() && !courseName.empty()) {
            if (subjectCodeToId.find(courseCode) != subjectCodeToId.end()) {
                subjectId = subjectCodeToId[courseCode];
            }
            else {
                auto existingSub = find_if(subjects.begin(), subjects.end(),
                    [&](const Subject& s) { return s.code == courseCode || s.name == courseName; });
                if (existingSub != subjects.end()) {
                    subjectId = existingSub->id;
                    subjectCodeToId[courseCode] = subjectId;
                }
                else {
                    Subject newSub;
                    newSub.id = generateId("SUB");
                    newSub.name = courseName;
                    newSub.code = courseCode;
                    newSub.isLabRequired = isLabExam;
                    subjects.push_back(newSub);
                    subjectId = newSub.id;
                    subjectCodeToId[courseCode] = subjectId;
                    newSubjectsCreated++;
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
        }
        else {
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

            if (!subjectId.empty()) {
                s.subjectIds.push_back(subjectId);
            }

            studentMap[studentId] = s;
            validLines++;
        }
    }

    for (const auto& pair : studentMap) {
        students.push_back(pair.second);
    }

    cout << "\n[LOG] Total lines read: " << lineNumber << endl;
    cout << "[LOG] Valid student records: " << validLines << endl;
    cout << "[LOG] Skipped empty lines: " << skippedLines << endl;
    cout << "[LOG] New subjects created: " << newSubjectsCreated << endl;
    cout << "\nSuccessfully imported " << studentMap.size() << " students!" << endl;

    int studentsWithSubjects = 0;
    int studentsWithoutSubjects = 0;
    for (const auto& s : students) {
        if (!s.subjectIds.empty()) {
            studentsWithSubjects++;
        }
        else {
            studentsWithoutSubjects++;
        }
    }

    cout << "\n" << studentsWithSubjects << " students have subjects assigned from Excel." << endl;
    if (studentsWithoutSubjects > 0) {
        cout << studentsWithoutSubjects << " students have no subjects assigned." << endl;
    }

    cout << "\nCurrent subjects in system (" << subjects.size() << "):" << endl;
    for (const auto& sub : subjects) {
        cout << "  - " << sub.code << " : " << sub.name << endl;
    }
}

void exportScheduleToCSV() {
    if (schedules.empty()) {
        cout << "\nNo schedule data! Please generate schedule first." << endl;
        return;
    }

    cout << "\nEnter CSV export file path: ";
    string path;
    getline(cin, path);
    if (path.empty()) {
        getline(cin, path);
    }

    if (!path.empty() && path.front() == '\"') {
        path = path.substr(1);
    }
    if (!path.empty() && path.back() == '\"') {
        path = path.substr(0, path.size() - 1);
    }

    ofstream file(path);
    if (!file.is_open()) {
        cout << "Cannot create file! path: " << path << endl;
        return;
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
    cout << "\n[LOG] Schedule exported to CSV successfully!" << endl;
    cout << "[LOG] CSV file saved to: " << path << endl;

    string excelPath = path;
    size_t dotPos = excelPath.find_last_of('.');
    if (dotPos != string::npos) {
        excelPath = excelPath.substr(0, dotPos) + ".xls";
    }
    else {
        excelPath += ".xls";
    }

    cout << "[LOG] Excel file will be saved to: " << excelPath << endl;
    cout << "[LOG] Generating Excel file..." << endl;

    ofstream excelFile(excelPath);
    if (!excelFile.is_open()) {
        cout << "[ERROR] Cannot create Excel file!" << endl;
        return;
    }

    excelFile << "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" ";
    excelFile << "xmlns:x=\"urn:schemas-microsoft-com:office:excel\">" << endl;
    excelFile << "<head>" << endl;
    excelFile << "<meta charset=\"UTF-8\">" << endl;
    excelFile << "<style>" << endl;
    excelFile << "table { border-collapse: collapse; font-family: Arial, sans-serif; }" << endl;
    excelFile << "th { background-color: #4472C4; color: white; font-weight: bold; padding: 8px; border: 1px solid #333; text-align: center; }" << endl;
    excelFile << "td { padding: 6px; border: 1px solid #ccc; }" << endl;
    excelFile << ".title { font-size: 14px; font-weight: bold; background-color: #D9E1F2; color: #1F4E79; }" << endl;
    excelFile << ".info { font-weight: bold; background-color: #E6F1F7; }" << endl;
    excelFile << "</style>" << endl;
    excelFile << "</head>" << endl;
    excelFile << "<body>" << endl;

    excelFile << "<table>" << endl;
    excelFile << "<tr><th colspan=\"14\">Exam Schedule</th></tr>" << endl;
    excelFile << "<tr>" << endl;
    excelFile << "<th>Subject Code</th>" << endl;
    excelFile << "<th>Subject Name</th>" << endl;
    excelFile << "<th>Exam Date</th>" << endl;
    excelFile << "<th>Time Slot</th>" << endl;
    excelFile << "<th>Room Name</th>" << endl;
    excelFile << "<th>Room Type</th>" << endl;
    excelFile << "<th>Student ID</th>" << endl;
    excelFile << "<th>Student Name</th>" << endl;
    excelFile << "<th>Campus</th>" << endl;
    excelFile << "<th>Department</th>" << endl;
    excelFile << "<th>Major</th>" << endl;
    excelFile << "<th>Class</th>" << endl;
    excelFile << "<th>Course College</th>" << endl;
    excelFile << "<th>Course Unit</th>" << endl;
    excelFile << "</tr>" << endl;

    for (const auto& schedule : schedules) {
        auto subIt = find_if(subjects.begin(), subjects.end(),
            [&](const Subject& sb) { return sb.id == schedule.subjectId; });
        auto roomIt = find_if(rooms.begin(), rooms.end(),
            [&](const Room& rm) { return rm.id == schedule.roomId; });
        auto studentIt = find_if(students.begin(), students.end(),
            [&](const Student& st) { return st.id == schedule.studentId; });

        if (subIt != subjects.end() && roomIt != rooms.end() && studentIt != students.end()) {
            excelFile << "<tr>" << endl;
            excelFile << "<td>" << subIt->code << "</td>" << endl;
            excelFile << "<td>" << subIt->name << "</td>" << endl;
            excelFile << "<td>" << schedule.examDate << "</td>" << endl;
            excelFile << "<td>" << schedule.timeSlot << "</td>" << endl;
            excelFile << "<td>" << roomIt->name << "</td>" << endl;
            excelFile << "<td>" << (roomIt->type == "lab" ? "Lab" : "Regular") << "</td>" << endl;
            excelFile << "<td>" << studentIt->studentId << "</td>" << endl;
            excelFile << "<td>" << studentIt->name << "</td>" << endl;
            excelFile << "<td>" << studentIt->campus << "</td>" << endl;
            excelFile << "<td>" << studentIt->department << "</td>" << endl;
            excelFile << "<td>" << studentIt->major << "</td>" << endl;
            excelFile << "<td>" << studentIt->className << "</td>" << endl;
            excelFile << "<td>" << studentIt->courseCollege << "</td>" << endl;
            excelFile << "<td>" << studentIt->courseUnit << "</td>" << endl;
            excelFile << "</tr>" << endl;
        }
    }

    excelFile << "</table>" << endl;
    excelFile << "</body>" << endl;
    excelFile << "</html>" << endl;

    excelFile.close();
    cout << "\n[LOG] Excel file generated successfully!" << endl;
    cout << "[LOG] Excel file saved to: " << excelPath << endl;
}

void initializeMockData() {
    subjects = {
        {"SUB1", "Advanced Math", "MATH101", false},
        {"SUB2", "College English", "ENG101", false},
        {"SUB3", "Computer Basics", "CS101", true},
        {"SUB4", "Data Structure", "CS201", true},
        {"SUB5", "Linear Algebra", "MATH201", false},
        {"SUB6", "Physics Lab", "PHY102", true}
    };

    rooms = {
        {"R1", "Classroom A101", "regular", 50},
        {"R2", "Classroom A102", "regular", 60},
        {"R3", "Classroom B201", "regular", 45},
        {"R4", "Lab C101", "lab", 30},
        {"R5", "Lab C102", "lab", 35},
        {"R6", "Lab C201", "lab", 40}
    };

    students = {};

    cout << "\nSample data loaded!" << endl;
}

int main() {
    SetConsoleOutputCP(CP_ACP);
    SetConsoleCP(CP_ACP);

    cout << "==========================================" << endl;
    cout << "        Exam Schedule System" << endl;
    cout << "==========================================" << endl;

    rooms = {
        {"R1", "Classroom A101", "regular", 50},
        {"R2", "Classroom A102", "regular", 60},
        {"R3", "Classroom B201", "regular", 45},
        {"R4", "Lab C101", "lab", 30},
        {"R5", "Lab C102", "lab", 35},
        {"R6", "Lab C201", "lab", 40}
    };

    cout << "\nSystem initialized!" << endl;
    cout << rooms.size() << " exam rooms loaded." << endl;

    int choice;
    while (true) {
        displayMenu();
        while (!(cin >> choice)) {
            cin.clear();
            cin.ignore(numeric_limits<streamsize>::max(), '\n');
            cout << "输入无效！请输入数字: ";
        }
        clearInput();

        switch (choice) {
        case 1:
            importStudentsFromExcel();
            break;
        case 2:
            runScheduleGeneration();
            break;
        case 3:
            viewSchedules();
            break;
        case 4:
            exportScheduleToCSV();
            break;
        case 0:
            cout << "\nThank you for using Exam Schedule System!" << endl;
            return 0;
        default:
            cout << "Invalid option! Please try again." << endl;
        }
    }

    return 0;
}