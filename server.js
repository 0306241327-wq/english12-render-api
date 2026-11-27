/**
 * POST /api/teacher/quizzes/:quizId/questions/batch
 * Nhập danh sách câu hỏi hàng loạt từ file Excel/CSV vào đề thi
 */
app.post("/api/teacher/quizzes/:quizId/questions/batch", authenticateTeacher, (req, res) => {
  const db = readDb();
  const uid = req.teacherId;
  const { quizId } = req.params;

  // Hỗ trợ nhận mảng câu hỏi dù app gửi dưới dạng { questions: [...] } hay gửi trực tiếp mảng [...]
  const questions = Array.isArray(req.body) ? req.body : req.body.questions;

  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Danh sách câu hỏi trống hoặc không đúng định dạng"
    });
  }

  // Khởi tạo cấu trúc lưu trữ quizzes nếu chưa có trong teachers_db.json
  if (!db.quizzes) {
    db.quizzes = {};
  }
  if (!db.quizzes[quizId]) {
    db.quizzes[quizId] = {
      quizId,
      teacherId: uid,
      questions: []
    };
  }

  // Gắn ID và lưu các câu hỏi mới vào bộ đề
  const newQuestions = questions.map((q, index) => ({
    id: `q_${Date.now()}_${index}`,
    ...q,
    createdAt: Date.now()
  }));

  db.quizzes[quizId].questions.push(...newQuestions);

  // Cập nhật lại tổng số câu hỏi của giáo viên nếu đã có hồ sơ
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
