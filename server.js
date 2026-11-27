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
  fs.writeFileSync(DB_FILE, JSON.stringify({ teachers: {} }, null, 2), "utf8");
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
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

  // Nếu dùng Firebase Admin SDK, có thể verifyIdToken(token) tại đây.
  // Tạm thời ưu tiên x-teacher-id gửi kèm từ FirebaseAuth.getInstance().currentUser?.uid
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Teacher API Server đang chạy tại http://0.0.0.0:${PORT}`);
});
