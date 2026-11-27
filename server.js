const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "teachers_db.json");

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Khởi tạo file lưu trữ dữ liệu nếu chưa có
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ teachers: {}, quizzes: {} }, null, 2), "utf8");
}

function readDb() {
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!data.teachers) data.teachers = {};
  if (!data.quizzes) data.quizzes = {};
  return data;
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Middleware xác thực cơ bản (nhận UID từ header hoặc Firebase ID Token)
function authenticateTeacher(req, res, next) {
  const teacherId = req.headers["x-teacher-id"];
  const authHeader = req.headers["authorization"];

  if (!teacherId && !authHeader) {
    return res.status(401).json({
      success: false,
      message: "Thiếu thông tin xác thực giáo viên (Authorization hoặc x-teacher-id)"
    });
  }

  req.teacherId = teacherId || authHeader.replace("Bearer ", "").trim();
  next();
}

/**
 * GET /api/teacher/profile
 * Lấy thông tin hồ sơ giáo viên (tự tạo hồ sơ mặc định nếu đăng nhập lần đầu)
 */
app.get("/api/teacher/profile", authenticateTeacher, (req, res) => {
  const db = readDb();
  const uid = req.teacherId;

  if (!db.teachers[uid]) {
    db.teachers[uid] = {
      uid,
      fullName: req.headers["x-teacher-name"] || "Giáo viên Tiếng Anh 12",
      email: req.headers["x-teacher-email"] || "",
      phone: "",
      school: "THPT",
      subject: "Tiếng Anh 12",
      bio: "",
      avatarUrl: "",
      totalQuizzes: 0,
      totalQuestions: 0,
      totalSubmissions: 0,
      updatedAt: Date.now()
    };
    writeDb(db);
  }

  return res.json({
    success: true,
    data: db.teachers[uid]
  });
});

/**
 * PUT /api/teacher/profile
 * Cập nhật thông tin hồ sơ giáo viên
 */
app.put("/api/teacher/profile", authenticateTeacher, (req, res) => {
  const db = readDb();
  const uid = req.teacherId;
  const { fullName, phone, school, subject, bio, avatarUrl } = req.body;

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({
      success: false,
      message: "Họ và tên giáo viên không được để trống"
    });
  }

  const existing = db.teachers[uid] || {
    uid,
    email: req.headers["x-teacher-email"] || "",
    totalQuizzes: 0,
    totalQuestions: 0,
    totalSubmissions: 0
  };

  db.teachers[uid] = {
    ...existing,
    fullName: fullName.trim(),
    phone: (phone ?? existing.phone ?? "").trim(),
    school: (school ?? existing.school ?? "").trim(),
    subject: (subject ?? existing.subject ?? "Tiếng Anh 12").trim(),
    bio: (bio ?? existing.bio ?? "").trim(),
    avatarUrl: avatarUrl ?? existing.avatarUrl ?? "",
    updatedAt: Date.now()
  };

  writeDb(db);

  return res.json({
    success: true,
    message: "Cập nhật hồ sơ thành công",
    data: db.teachers[uid]
  });
});

/**
 * POST /api/teacher/profile/sync-stats
 * Đồng bộ số liệu thống kê (số đề, số câu hỏi, lượt nộp bài) từ app sang server
 */
app.post("/api/teacher/profile/sync-stats", authenticateTeacher, (req, res) => {
  const db = readDb();
  const uid = req.teacherId;
  const { totalQuizzes, totalQuestions, totalSubmissions } = req.body;

  if (!db.teachers[uid]) {
    return res.status(404).json({ success: false, message: "Không tìm thấy hồ sơ giáo viên" });
  }

  db.teachers[uid].totalQuizzes = Number(totalQuizzes ?? db.teachers[uid].totalQuizzes);
  db.teachers[uid].totalQuestions = Number(totalQuestions ?? db.teachers[uid].totalQuestions);
  db.teachers[uid].totalSubmissions = Number(totalSubmissions ?? db.teachers[uid].totalSubmissions);
  db.teachers[uid].updatedAt = Date.now();

  writeDb(db);
  return res.json({ success: true, data: db.teachers[uid] });
});

/**
 * POST /api/teacher/quizzes/:quizId/questions/batch
 * Nhập danh sách câu hỏi hàng loạt từ file Excel/CSV vào đề thi
 */
app.post("/api/teacher/quizzes/:quizId/questions/batch", authenticateTeacher, (req, res) => {
  const db = readDb();
  const uid = req.teacherId;
  const { quizId } = req.params;

  const questions = Array.isArray(req.body) ? req.body : req.body.questions;

  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Danh sách câu hỏi trống hoặc không đúng định dạng"
    });
  }

  if (!db.quizzes[quizId]) {
    db.quizzes[quizId] = {
      quizId,
      teacherId: uid,
      questions: []
    };
  }

  const newQuestions = questions.map((q, index) => ({
    id: `q_${Date.now()}_${index}`,
    ...q,
    createdAt: Date.now()
  }));

  db.quizzes[quizId].questions.push(...newQuestions);

  if (db.teachers[uid]) {
    db.teachers[uid].totalQuestions = (db.teachers[uid].totalQuestions || 0) + newQuestions.length;
    db.teachers[uid].updatedAt = Date.now();
  }

  writeDb(db);

  return res.status(201).json({
    success: true,
    message: `Đã nhập thành công ${newQuestions.length} câu hỏi`,
    count: newQuestions.length,
    data: newQuestions
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Teacher API Server đang chạy tại http://0.0.0.0:${PORT}`);
});
