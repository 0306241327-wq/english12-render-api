const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');

// 1. Khởi tạo Firebase (Ưu tiên biến môi trường trên Render, dự phòng file local)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fs.existsSync('./serviceAccountKey.json')) {
  serviceAccount = require('./serviceAccountKey.json');
} else {
  console.error('LỖI: Thiếu biến môi trường FIREBASE_SERVICE_ACCOUNT hoặc file serviceAccountKey.json');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } }); // Giới hạn 8MB

app.use(cors());
app.use(express.json());

// Middleware xác thực Firebase ID Token
async function verifyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Thiếu token đăng nhập' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    req.user = {
      uid: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || decoded.email?.split('@')[0] || 'Người dùng',
      role: userDoc.exists ? userDoc.data().role : null
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

// ==========================================
// HEALTH CHECK & THÔNG TIN USER
// ==========================================
app.get('/', (req, res) => {
  res.json({
    service: 'English 12 Quiz Web API',
    status: 'Online',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/me', verifyAuth, (req, res) => {
  res.json(req.user);
});

// ==========================================
// API HỌC SINH (STUDENT)
// ==========================================
app.get('/api/quizzes', verifyAuth, async (req, res) => {
  try {
    const snap = await db.collection('quizzes').where('status', '==', 'Live').get();
    const quizzes = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quizzes/:quizId/exam', verifyAuth, async (req, res) => {
  try {
    const quizRef = db.collection('quizzes').doc(req.params.quizId);
    const quizDoc = await quizRef.get();
    if (!quizDoc.exists) return res.status(404).json({ error: 'Không tìm thấy đề thi' });

    const quiz = { id: quizDoc.id, ...quizDoc.data() };
    if (quiz.status !== 'Live') {
      return res.status(403).json({ error: 'Đề thi chưa được mở' });
    }

    const qSnap = await quizRef.collection('questions').get();
    let questions = qSnap.docs.map(doc => {
      const q = doc.data();
      let options = [
        { key: 'A', text: q.optionA },
        { key: 'B', text: q.optionB },
        { key: 'C', text: q.optionC },
        { key: 'D', text: q.optionD }
      ];
      if (quiz.shuffleAnswers) options = options.sort(() => Math.random() - 0.5);
      return { id: doc.id, text: q.text, options };
    });

    if (quiz.shuffleQuestions) questions = questions.sort(() => Math.random() - 0.5);
    res.json({ quiz, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quizzes/:quizId/submit', verifyAuth, async (req, res) => {
  try {
    const { answers = {}, timeUp = false } = req.body;
    const quizRef = db.collection('quizzes').doc(req.params.quizId);
    const quizDoc = await quizRef.get();
    if (!quizDoc.exists) return res.status(404).json({ error: 'Đề thi không tồn tại' });

    const quiz = quizDoc.data();
    const qSnap = await quizRef.collection('questions').get();
    const total = qSnap.size;
    if (total === 0) return res.status(400).json({ error: 'Đề thi chưa có câu hỏi' });

    let correctCount = 0;
    let answeredCount = 0;

    qSnap.docs.forEach(doc => {
      const q = doc.data();
      const chosen = answers[doc.id];
      if (chosen) {
        answeredCount++;
        if (chosen === q.correctAnswer) correctCount++;
      }
    });

    const score = Math.round((correctCount * 1000) / total) / 100;
    const resultRef = db.collection('results').doc();

    const resultData = {
      id: resultRef.id,
      quizId: quizDoc.id,
      quizTitle: quiz.title || '',
      teacherUid: quiz.ownerId || '',
      userId: req.user.uid,
      userName: req.user.name,
      score,
      correctCount,
      totalQuestions: total,
      answeredCount,
      timeUp: Boolean(timeUp),
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await resultRef.set(resultData);
    res.json(resultData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my-results', verifyAuth, async (req, res) => {
  try {
    const snap = await db.collection('results').where('userId', '==', req.user.uid).get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API GIÁO VIÊN (TEACHER)
// ==========================================
app.get('/api/teacher/quizzes', verifyAuth, async (req, res) => {
  try {
    const snap = await db.collection('quizzes').where('ownerId', '==', req.user.uid).get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/quizzes', verifyAuth, async (req, res) => {
  try {
    const {
      id, topicName, title, durationMinutes = 45,
      maxAttempts = null, rankingEnabled = false,
      shuffleQuestions = false, shuffleAnswers = false, status = 'Upcoming'
    } = req.body;

    if (!title || !topicName) {
      return res.status(400).json({ error: 'Thiếu tiêu đề hoặc môn học' });
    }

    const ref = id ? db.collection('quizzes').doc(id) : db.collection('quizzes').doc();
    const existing = id ? await ref.get() : null;
    const questionCount = existing?.exists ? (existing.data().questionCount || 0) : 0;

    if (status === 'Live' && questionCount === 0) {
      return res.status(400).json({ error: 'Đề chưa có câu hỏi nên chưa thể đặt trạng thái Live' });
    }

    const data = {
      id: ref.id,
      ownerId: req.user.uid,
      topicName,
      title,
      questionCount,
      durationMinutes,
      maxAttempts,
      rankingEnabled,
      shuffleQuestions,
      shuffleAnswers,
      status
    };

    await ref.set(data, { merge: true });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/teacher/quizzes/:quizId/status', verifyAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Upcoming', 'Live', 'Completed'].includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }
    const ref = db.collection('quizzes').doc(req.params.quizId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Không tìm thấy đề thi' });
    if (doc.data().ownerId !== req.user.uid) return res.status(403).json({ error: 'Không có quyền sửa đề này' });
    if (status === 'Live' && (doc.data().questionCount || 0) === 0) {
      return res.status(400).json({ error: 'Hãy thêm câu hỏi trước khi mở đề' });
    }
    await ref.update({ status });
    res.json({ id: doc.id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teacher/quizzes/:quizId', verifyAuth, async (req, res) => {
  try {
    const quizRef = db.collection('quizzes').doc(req.params.quizId);
    const quizDoc = await quizRef.get();
    if (!quizDoc.exists) return res.status(404).json({ error: 'Không tìm thấy đề thi' });
    if (quizDoc.data().ownerId !== req.user.uid) return res.status(403).json({ error: 'Không có quyền xóa đề này' });

    const qSnap = await quizRef.collection('questions').get();
    const batch = db.batch();
    qSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(quizRef);
    await batch.commit();

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/quizzes/:quizId/import', verifyAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Vui lòng đính kèm file .xlsx hoặc .csv' });

    const quizRef = db.collection('quizzes').doc(req.params.quizId);
    const quizDoc = await quizRef.get();
    if (!quizDoc.exists) return res.status(404).json({ error: 'Đề thi không tồn tại' });
    if (quizDoc.data().ownerId !== req.user.uid) {
      return res.status(403).json({ error: 'Bạn không phải giáo viên sở hữu đề này' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0 || rows.length > 300) {
      return res.status(400).json({ error: 'File phải có từ 1 đến 300 câu hỏi' });
    }

    const questions = rows.map((row, idx) => {
      const norm = {};
      Object.keys(row).forEach(k => { norm[k.toLowerCase().replace(/[\s_-]+/g, '')] = String(row[k]).trim(); });

      const correct = (norm.correctanswer || '').toUpperCase();
      if (!norm.text || !norm.optiona || !norm.optionb || !norm.optionc || !norm.optiond || !['A', 'B', 'C', 'D'].includes(correct)) {
        throw new Error(`Dòng ${idx + 2} thiếu dữ liệu hoặc correctAnswer không phải A/B/C/D`);
      }
      return {
        text: norm.text,
        optionA: norm.optiona,
        optionB: norm.optionb,
        optionC: norm.optionc,
        optionD: norm.optiond,
        correctAnswer: correct,
        points: parseFloat(norm.points) > 0 ? parseFloat(norm.points) : 1.0
      };
    });

    const chunkSize = 15;
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize);
      const batch = db.batch();
      chunk.forEach(q => {
        const qRef = quizRef.collection('questions').doc();
        batch.set(qRef, { id: qRef.id, ...q });
      });
      batch.update(quizRef, { questionCount: admin.firestore.FieldValue.increment(chunk.length) });
      await batch.commit();
    }

    res.json({ imported: questions.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/teacher/quizzes/:quizId/results', verifyAuth, async (req, res) => {
  try {
    const snap = await db.collection('results')
      .where('teacherUid', '==', req.user.uid)
      .where('quizId', '==', req.params.quizId)
      .get();

    const list = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => b.score - a.score);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server chạy thành công tại cổng ${PORT}`);
});
