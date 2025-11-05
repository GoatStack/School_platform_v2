// Node.js 백엔드 서버 (SQLite 사용) - 보안 강화 버전
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET;

if (!JWT_SECRET || !JWT_ADMIN_SECRET) {
    console.error('Set JWT_SECRET and JWT_ADMIN_SECRET in .env file');
    process.exit(1);
}

// 임시 인증 세션 저장소 (메모리 기반, 서버 재시작 시 초기화)
const tempAuthSessions = new Map(); // key: sessionId, value: { adminId, ipAddress, createdAt, pinAttempts }
const SESSION_EXPIRY = 5 * 60 * 1000; // 5분
const MAX_PIN_ATTEMPTS = 3; // PIN 최대 시도 횟수

// 만료된 세션 정리 (1분마다)
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of tempAuthSessions.entries()) {
        if (now - session.createdAt > SESSION_EXPIRY) {
            tempAuthSessions.delete(sessionId);
        }
    }
}, 60 * 1000);

// Trust proxy
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : 1);

// 보안 헤더 설정
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'none'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Rate limiting 설정
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 100, // 최대 100 요청
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
            retryAfter: Math.ceil(15 * 60) // 15분을 초 단위로
        });
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 5, // 최대 5회 시도
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.',
            retryAfter: Math.ceil(15 * 60) // 15분을 초 단위로
        });
    }
});

app.use('/api/', apiLimiter);
app.use('/api/admin/login', authLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 허용된 이미지 MIME 타입
const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// 파일명 sanitization 함수
function sanitizeFilename(filename) {
    // 위험한 문자 제거
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\.\./g, '_')
        .substring(0, 255); // 파일명 길이 제한
}

// Multer 설정 (보안 강화)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();

        // 확장자 검증
        if (!allowedExtensions.includes(ext)) {
            return cb(new Error('허용되지 않은 파일 형식입니다.'), false);
        }

        const sanitizedName = sanitizeFilename(path.basename(file.originalname, ext));
        cb(null, uniqueSuffix + '-' + sanitizedName + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB 제한
        files: 10 // 최대 10개 파일
    },
    fileFilter: function (req, file, cb) {
        // MIME 타입 검증
        if (!allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
            return cb(new Error('이미지 파일만 업로드 가능합니다.'), false);
        }

        // 확장자 검증
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return cb(new Error('허용되지 않은 파일 확장자입니다.'), false);
        }

        cb(null, true);
    }
});

// 미들웨어
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// 입력값 sanitization 미들웨어
function sanitizeInput(req, res, next) {
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitizeHtml(req.body[key], {
                    allowedTags: [],
                    allowedAttributes: {}
                });
            }
        });
    }
    next();
}

// JWT 토큰 검증 미들웨어 (사용자)
function authenticateUser(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;

    if (!token) {
        return res.status(401).json({ error: '인증이 필요합니다.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
}

// JWT 토큰 검증 미들웨어 (관리자)
// IP 주소 가져오기 함수
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    // IPv6 localhost를 IPv4로 변환
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        return '127.0.0.1';
    }
    // IPv6를 IPv4로 변환 (::ffff: prefix 제거)
    if (ip && ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    return ip || 'unknown';
}

// 관리자 인증 미들웨어 (보안 강화)
function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.adminToken;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!token) {
        return res.status(401).json({ error: '관리자 인증이 필요합니다.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_ADMIN_SECRET);

        // 토큰 만료 시간 확인 (추가 검증)
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < now) {
            return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
        }

        // 관리자 계정 상태 확인
        db.get('SELECT * FROM admins WHERE id = ?', [decoded.id], (err, admin) => {
            if (err || !admin) {
                return res.status(401).json({ error: '유효하지 않은 관리자 계정입니다.' });
            }

            // 계정 잠금 확인
            if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
                return res.status(403).json({ error: '계정이 잠금되었습니다.' });
            }

            // 현재 활성 세션 토큰 확인 (다른 PC에서 로그인했는지 확인)
            if (admin.current_session_token && admin.current_session_token !== token) {
                return res.status(401).json({
                    error: '다른 위치에서 로그인하여 세션이 종료되었습니다. 다시 로그인해주세요.',
                    sessionTerminated: true
                });
            }

            // 세션 토큰이 없는 경우도 무효 (새 로그인 필요)
            if (!admin.current_session_token) {
                return res.status(401).json({
                    error: '세션이 만료되었습니다. 다시 로그인해주세요.',
                    sessionTerminated: true
                });
            }

            req.admin = decoded;

            // 관리자 활동 로깅 (중요한 작업만)
            const action = req.method + ' ' + req.path;
            if (req.method !== 'GET' || req.path.includes('/api/stats')) {
                db.run(
                    'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)',
                    [decoded.id, action, ipAddress, userAgent]
                );
            }

            next();
        });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
        }
        return res.status(401).json({ error: '유효하지 않은 관리자 토큰입니다.' });
    }
}

// 깔끔한 URL 라우트 (HTML 확장자 제거)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 관리자 페이지 접근 시 토큰 검증 (선택적)
app.get('/admin', (req, res) => {
    // 토큰이 있으면 검증, 없으면 HTML만 제공 (클라이언트에서 처리)
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/project-detail', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'project-detail.html'));
});

// SQLite 데이터베이스 연결
if (!fs.existsSync(path.join(__dirname, 'database'))) {
    fs.mkdirSync(path.join(__dirname, 'database'), { recursive: true });
}

const dbPath = path.join(__dirname, 'database', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// 데이터베이스 초기화
function initDatabase() {
    db.serialize(() => {
        // 관리자 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login_at DATETIME,
                failed_login_attempts INTEGER DEFAULT 0,
                locked_until DATETIME,
                current_session_token TEXT
            )
        `);

        // 관리자 활동 로그 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS admin_activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER,
                action TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES admins(id)
            )
        `);

        // 관리자 로그인 시도 로그 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS admin_login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                ip_address TEXT,
                success INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 사용자 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT NOT NULL,
                grade TEXT NOT NULL,
                class_name TEXT NOT NULL,
                student_number INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                approved_at DATETIME,
                signup_ip_address TEXT,
                signup_user_agent TEXT,
                signup_referer TEXT,
                signup_accept_language TEXT,
                signup_accept_encoding TEXT,
                signup_accept_charset TEXT,
                signup_platform TEXT,
                signup_device_type TEXT
            )
        `);

        // 통합 프로젝트 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                applicant_name TEXT NOT NULL,
                contact TEXT NOT NULL,
                email TEXT NOT NULL,
                user_id INTEGER,
                project_url TEXT,
                image_url TEXT,
                image_size TEXT DEFAULT 'cover',
                detail_description TEXT,
                features TEXT,
                tech_stack TEXT,
                links TEXT,
                project_images TEXT,
                status TEXT DEFAULT 'pending',
                deadline TEXT,
                detail_url TEXT,
                detail_images TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                approved_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // 기존 테이블에 새로운 컬럼 추가 (마이그레이션)
        const addColumns = [
            'ALTER TABLE users ADD COLUMN student_number INTEGER',
            'ALTER TABLE users ADD COLUMN grade TEXT',
            'ALTER TABLE users ADD COLUMN class_name TEXT',
            'ALTER TABLE users ADD COLUMN username TEXT',
            'ALTER TABLE users ADD COLUMN signup_ip_address TEXT',
            'ALTER TABLE users ADD COLUMN signup_user_agent TEXT',
            'ALTER TABLE users ADD COLUMN signup_referer TEXT',
            'ALTER TABLE users ADD COLUMN signup_accept_language TEXT',
            'ALTER TABLE users ADD COLUMN signup_accept_encoding TEXT',
            'ALTER TABLE users ADD COLUMN signup_accept_charset TEXT',
            'ALTER TABLE users ADD COLUMN signup_platform TEXT',
            'ALTER TABLE users ADD COLUMN signup_device_type TEXT',
            'ALTER TABLE projects ADD COLUMN user_id INTEGER',
            // 관리자 테이블 보안 컬럼 추가
            'ALTER TABLE admins ADD COLUMN last_login_at DATETIME',
            'ALTER TABLE admins ADD COLUMN failed_login_attempts INTEGER DEFAULT 0',
            'ALTER TABLE admins ADD COLUMN locked_until DATETIME',
            'ALTER TABLE admins ADD COLUMN pin TEXT',
            'ALTER TABLE admins ADD COLUMN current_session_token TEXT'
        ];

        addColumns.forEach(sql => {
            db.run(sql, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('컬럼 추가 오류:', err);
                }
            });
        });

        // 기본 관리자 계정 생성 (비밀번호: admin123, PIN: 1234)
        const defaultPassword = bcrypt.hashSync('admin123', 10);
        const defaultPin = bcrypt.hashSync('1234', 10);
        db.run(`
            INSERT OR IGNORE INTO admins (username, password, pin) 
            VALUES ('admin', ?, ?)
        `, [defaultPassword, defaultPin]);

        // 기존 관리자 계정에 기본 PIN 설정 (PIN이 없는 경우)
        db.run(`
            UPDATE admins 
            SET pin = ? 
            WHERE pin IS NULL OR pin = ''
        `, [defaultPin]);

    });
}

// 관리자 로그인 API (보안 강화)
// 1단계: 사용자명/비밀번호 확인
app.post('/api/admin/login-step1', sanitizeInput, (req, res) => {
    const { username, password } = req.body;
    const ipAddress = getClientIp(req);

    if (!username || !password) {
        return res.status(400).json({ error: '사용자명과 비밀번호를 입력해주세요.' });
    }

    db.get(
        'SELECT * FROM admins WHERE username = ?',
        [username],
        (err, admin) => {
            if (err) {
                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [username, ipAddress, 0]
                );
                return res.status(500).json({ error: '서버 오류' });
            }

            if (!admin) {
                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [username, ipAddress, 0]
                );
                return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
            }

            // 계정 잠금 확인
            if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
                const lockTime = Math.ceil((new Date(admin.locked_until) - new Date()) / 1000 / 60);
                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [username, ipAddress, 0]
                );
                return res.status(403).json({
                    error: `계정이 잠금되었습니다. ${lockTime}분 후 다시 시도해주세요.`
                });
            }

            if (bcrypt.compareSync(password, admin.password)) {
                // 1단계 성공 - 서버 측 세션 생성
                const sessionId = require('crypto').randomBytes(32).toString('hex');
                const sessionData = {
                    adminId: admin.id,
                    username: admin.username,
                    ipAddress: ipAddress,
                    createdAt: Date.now(),
                    pinAttempts: 0
                };
                tempAuthSessions.set(sessionId, sessionData);

                // 세션 ID만 클라이언트에 전달 (토큰 없이)
                res.json({
                    success: true,
                    message: '1단계 인증 성공',
                    sessionId: sessionId
                });
            } else {
                // 로그인 실패 - 실패 횟수 증가
                const failedAttempts = (admin.failed_login_attempts || 0) + 1;
                let lockedUntil = null;

                if (failedAttempts >= 5) {
                    lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                }

                db.run(
                    'UPDATE admins SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                    [failedAttempts, lockedUntil ? lockedUntil.toISOString() : null, admin.id]
                );

                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [username, ipAddress, 0]
                );

                return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
            }
        }
    );
});

// 2단계: PIN 확인 및 최종 로그인
app.post('/api/admin/login-step2', sanitizeInput, (req, res) => {
    const { sessionId, pin } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!sessionId || !pin) {
        return res.status(400).json({ error: '인증 정보가 올바르지 않습니다.' });
    }

    // 서버 측 세션 검증
    const session = tempAuthSessions.get(sessionId);
    if (!session) {
        return res.status(401).json({ error: '인증 세션이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
    }

    // 세션 만료 확인
    if (Date.now() - session.createdAt > SESSION_EXPIRY) {
        tempAuthSessions.delete(sessionId);
        return res.status(401).json({ error: '인증 세션이 만료되었습니다. 다시 로그인해주세요.' });
    }

    // IP 주소 검증 제거 (서버 배포 환경에서 IP가 변경될 수 있으므로)
    // IP 검증은 제거하고 세션 ID와 PIN만으로 인증 진행

    // PIN 시도 횟수 확인
    if (session.pinAttempts >= MAX_PIN_ATTEMPTS) {
        tempAuthSessions.delete(sessionId);
        return res.status(403).json({ error: 'PIN 시도 횟수를 초과했습니다. 다시 로그인해주세요.' });
    }

    db.get(
        'SELECT * FROM admins WHERE id = ?',
        [session.adminId],
        (err, admin) => {
            if (err || !admin) {
                tempAuthSessions.delete(sessionId);
                return res.status(500).json({ error: '서버 오류' });
            }

            // PIN 검증
            if (!admin.pin) {
                tempAuthSessions.delete(sessionId);
                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [admin.username, ipAddress, 0]
                );
                return res.status(401).json({ error: 'PIN이 설정되지 않았습니다. 관리자에게 문의하세요.' });
            }

            if (!bcrypt.compareSync(pin, admin.pin)) {
                // PIN 오류 - 세션 내 시도 횟수 증가
                session.pinAttempts += 1;

                // 계정 전체 실패 횟수도 증가
                const failedAttempts = (admin.failed_login_attempts || 0) + 1;
                let lockedUntil = null;

                if (failedAttempts >= 5) {
                    lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                    tempAuthSessions.delete(sessionId); // 계정 잠금 시 세션 삭제
                }

                db.run(
                    'UPDATE admins SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                    [failedAttempts, lockedUntil ? lockedUntil.toISOString() : null, admin.id]
                );

                db.run(
                    'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                    [admin.username, ipAddress, 0]
                );

                if (session.pinAttempts >= MAX_PIN_ATTEMPTS) {
                    tempAuthSessions.delete(sessionId);
                    return res.status(401).json({ error: `PIN 시도 횟수를 초과했습니다 (${MAX_PIN_ATTEMPTS}회). 다시 로그인해주세요.` });
                }

                return res.status(401).json({ error: `PIN이 올바르지 않습니다. (${session.pinAttempts}/${MAX_PIN_ATTEMPTS}회 시도)` });
            }

            // PIN 검증 성공 - 세션 삭제
            tempAuthSessions.delete(sessionId);

            // 최종 토큰 발급 (고유 ID 포함)
            const tokenId = require('crypto').randomBytes(32).toString('hex');
            const token = jwt.sign(
                { id: admin.id, username: admin.username, role: 'admin', jti: tokenId },
                JWT_ADMIN_SECRET,
                { expiresIn: '4h' }
            );

            // 기존 세션 무효화 및 새 세션 저장 (동시 로그인 방지)
            db.run(
                'UPDATE admins SET failed_login_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, current_session_token = ? WHERE id = ?',
                [token, admin.id]
            );

            db.run(
                'INSERT INTO admin_login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                [admin.username, ipAddress, 1]
            );

            db.run(
                'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                [admin.id, 'login', ipAddress, userAgent, `관리자 로그인 성공 (PIN 인증) - IP: ${ipAddress}`]
            );

            res.json({
                success: true,
                message: '로그인 성공',
                token: token,
                admin: { id: admin.id, username: admin.username }
            });
        }
    );
});

// 관리자 로그아웃 API
app.post('/api/admin/logout', authenticateAdmin, (req, res) => {
    const adminId = req.admin.id;

    // 세션 토큰 초기화
    db.run(
        'UPDATE admins SET current_session_token = NULL WHERE id = ?',
        [adminId],
        (err) => {
            if (err) {
                console.error('로그아웃 처리 오류:', err);
            }

            // 로그아웃 활동 로깅
            const ipAddress = getClientIp(req);
            const userAgent = req.headers['user-agent'] || 'unknown';
            db.run(
                'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                [adminId, 'logout', ipAddress, userAgent, '관리자 로그아웃']
            );

            res.json({ success: true, message: '로그아웃되었습니다.' });
        }
    );
});

// 관리자 비밀번호 변경 API
app.post('/api/admin/change-password', authenticateAdmin, sanitizeInput, (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const adminId = req.admin.id;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: '새 비밀번호는 최소 8자 이상이어야 합니다.' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: '새 비밀번호가 일치하지 않습니다.' });
    }

    // 현재 비밀번호 확인
    db.get('SELECT * FROM admins WHERE id = ?', [adminId], (err, admin) => {
        if (err || !admin) {
            return res.status(500).json({ error: '서버 오류' });
        }

        if (!bcrypt.compareSync(currentPassword, admin.password)) {
            db.run(
                'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                [adminId, 'change_password_failed', ipAddress, userAgent, '비밀번호 변경 실패 (현재 비밀번호 불일치)']
            );
            return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
        }

        // 새 비밀번호 해시화
        const hashedPassword = bcrypt.hashSync(newPassword, 10);

        // 비밀번호 업데이트
        db.run(
            'UPDATE admins SET password = ? WHERE id = ?',
            [hashedPassword, adminId],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: '비밀번호 변경 중 오류가 발생했습니다.' });
                }

                // 활동 로깅
                db.run(
                    'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                    [adminId, 'change_password', ipAddress, userAgent, '비밀번호 변경 성공']
                );

                res.json({ success: true, message: '비밀번호가 성공적으로 변경되었습니다.' });
            }
        );
    });
});

// 관리자 사용자명 변경 API
app.post('/api/admin/change-username', authenticateAdmin, sanitizeInput, (req, res) => {
    const { currentPassword, newUsername } = req.body;
    const adminId = req.admin.id;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!currentPassword || !newUsername) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: '사용자명은 3~20자 사이여야 합니다.' });
    }

    // 현재 비밀번호 확인
    db.get('SELECT * FROM admins WHERE id = ?', [adminId], (err, admin) => {
        if (err || !admin) {
            return res.status(500).json({ error: '서버 오류' });
        }

        if (!bcrypt.compareSync(currentPassword, admin.password)) {
            db.run(
                'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                [adminId, 'change_username_failed', ipAddress, userAgent, `사용자명 변경 실패 (현재 비밀번호 불일치) - 시도한 사용자명: ${newUsername}`]
            );
            return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
        }

        // 사용자명 중복 확인
        db.get('SELECT * FROM admins WHERE username = ? AND id != ?', [newUsername, adminId], (err, existingAdmin) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }

            if (existingAdmin) {
                return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });
            }

            // 사용자명 업데이트
            db.run(
                'UPDATE admins SET username = ? WHERE id = ?',
                [newUsername, adminId],
                (err) => {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });
                        }
                        return res.status(500).json({ error: '사용자명 변경 중 오류가 발생했습니다.' });
                    }

                    // 활동 로깅
                    db.run(
                        'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                        [adminId, 'change_username', ipAddress, userAgent, `사용자명 변경: ${admin.username} → ${newUsername}`]
                    );

                    res.json({
                        success: true,
                        message: '사용자명이 성공적으로 변경되었습니다. 다시 로그인해주세요.',
                        newUsername: newUsername
                    });
                }
            );
        });
    });
});

// 관리자 PIN 변경 API
app.post('/api/admin/change-pin', authenticateAdmin, sanitizeInput, (req, res) => {
    const { currentPin, newPin, confirmNewPin } = req.body;
    const adminId = req.admin.id;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!currentPin || !newPin || !confirmNewPin) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    // PIN 형식 검증
    if (!/^\d+$/.test(currentPin) || !/^\d+$/.test(newPin) || !/^\d+$/.test(confirmNewPin)) {
        return res.status(400).json({ error: 'PIN은 숫자만 입력 가능합니다.' });
    }

    if (newPin.length < 4 || newPin.length > 6) {
        return res.status(400).json({ error: '새 PIN은 4~6자리 숫자여야 합니다.' });
    }

    if (newPin !== confirmNewPin) {
        return res.status(400).json({ error: '새 PIN이 일치하지 않습니다.' });
    }

    // 현재 PIN 확인
    db.get('SELECT * FROM admins WHERE id = ?', [adminId], (err, admin) => {
        if (err || !admin) {
            return res.status(500).json({ error: '서버 오류' });
        }

        if (!admin.pin) {
            return res.status(400).json({ error: 'PIN이 설정되지 않았습니다.' });
        }

        if (!bcrypt.compareSync(currentPin, admin.pin)) {
            db.run(
                'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                [adminId, 'change_pin_failed', ipAddress, userAgent, 'PIN 변경 실패 (현재 PIN 불일치)']
            );
            return res.status(401).json({ error: '현재 PIN이 올바르지 않습니다.' });
        }

        // 새 PIN 해시화
        const hashedPin = bcrypt.hashSync(newPin, 10);

        // PIN 업데이트
        db.run(
            'UPDATE admins SET pin = ? WHERE id = ?',
            [hashedPin, adminId],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'PIN 변경 중 오류가 발생했습니다.' });
                }

                // 활동 로깅
                db.run(
                    'INSERT INTO admin_activity_logs (admin_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
                    [adminId, 'change_pin', ipAddress, userAgent, 'PIN 변경 성공']
                );

                res.json({ success: true, message: 'PIN이 성공적으로 변경되었습니다.' });
            }
        );
    });
});

// 기존 로그인 API (2단계 로그인으로 대체됨)
app.post('/api/admin/login', sanitizeInput, (req, res) => {
    return res.status(400).json({ error: '2단계 로그인을 사용해주세요. /api/admin/login-step1 을 사용하세요.' });
});

// 사용자 회원가입 API
app.post('/api/users/register', sanitizeInput, (req, res) => {
    const { email, username, password, fullName, grade, className, studentNumber } = req.body;

    // 입력값 검증
    if (!email || !username || !password || !fullName || !grade || !className || !studentNumber) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    if (!validator.isEmail(email)) {
        return res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' });
    }

    // 아이디 검증 (3~20자, 영문, 숫자, 언더스코어, 하이픈만 허용)
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        return res.status(400).json({ error: '아이디는 3~20자의 영문, 숫자, _, - 만 사용 가능합니다.' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: '비밀번호는 최소 8자 이상이어야 합니다.' });
    }

    // 비밀번호 해시화
    const hashedPassword = bcrypt.hashSync(password, 10);

    // 회원가입 시 보안 정보 수집
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const referer = req.headers['referer'] || req.headers['referrer'] || 'unknown';
    const acceptLanguage = req.headers['accept-language'] || 'unknown';
    const acceptEncoding = req.headers['accept-encoding'] || 'unknown';
    const acceptCharset = req.headers['accept-charset'] || 'unknown';

    // User-Agent에서 플랫폼 및 디바이스 타입 추출
    let platform = 'unknown';
    let deviceType = 'unknown';

    if (userAgent) {
        // 플랫폼 추출
        if (userAgent.includes('Windows')) {
            platform = 'Windows';
        } else if (userAgent.includes('Mac')) {
            platform = 'macOS';
        } else if (userAgent.includes('Linux')) {
            platform = 'Linux';
        } else if (userAgent.includes('Android')) {
            platform = 'Android';
        } else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
            platform = 'iOS';
        }

        // 디바이스 타입 추출
        if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
            deviceType = 'Mobile';
        } else if (userAgent.includes('Tablet')) {
            deviceType = 'Tablet';
        } else {
            deviceType = 'Desktop';
        }
    }

    db.run(
        `INSERT INTO users (email, username, password, full_name, grade, class_name, student_number, 
         signup_ip_address, signup_user_agent, signup_referer, signup_accept_language, 
         signup_accept_encoding, signup_accept_charset, signup_platform, signup_device_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [email, username, hashedPassword, fullName, grade, className, studentNumber,
            ipAddress, userAgent, referer, acceptLanguage, acceptEncoding, acceptCharset, platform, deviceType],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    if (err.message.includes('email')) {
                        return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
                    }
                    if (err.message.includes('username')) {
                        return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
                    }
                }
                return res.status(500).json({ error: '회원가입 중 오류가 발생했습니다.' });
            }

            res.json({
                success: true,
                message: '회원가입이 완료되었습니다. 관리자 승인 후 로그인이 가능합니다.',
                userId: this.lastID
            });
        }
    );
});

// 사용자 로그인 API
app.post('/api/users/login', sanitizeInput, (req, res) => {
    const { login, password } = req.body; // login은 email 또는 username

    if (!login || !password) {
        return res.status(400).json({ error: '이메일/아이디와 비밀번호를 입력해주세요.' });
    }

    // 이메일 형식인지 확인
    const isEmail = validator.isEmail(login);

    // 이메일이면 email로, 아니면 username으로 검색
    const query = isEmail
        ? 'SELECT * FROM users WHERE email = ?'
        : 'SELECT * FROM users WHERE username = ?';

    db.get(
        query,
        [login],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }

            if (!user) {
                return res.status(401).json({ error: '잘못된 이메일/아이디 또는 비밀번호입니다.' });
            }

            if (bcrypt.compareSync(password, user.password)) {
                // 사용자 상태 확인
                if (user.status === 'pending') {
                    return res.status(403).json({
                        error: 'pending',
                        message: '관리자 승인 후 로그인이 가능합니다.'
                    });
                } else if (user.status === 'rejected') {
                    return res.status(403).json({
                        error: 'rejected',
                        message: '회원가입이 거부되었습니다. 관리자에게 문의하세요.'
                    });
                }

                const token = jwt.sign(
                    { id: user.id, email: user.email, role: 'user' },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );

                res.json({
                    success: true,
                    message: '로그인 성공',
                    token: token,
                    user: {
                        id: user.id,
                        fullName: user.full_name,
                        email: user.email,
                        grade: user.grade,
                        className: user.class_name,
                        studentNumber: user.student_number
                    }
                });
            } else {
                res.status(401).json({ error: '잘못된 이메일 또는 비밀번호입니다.' });
            }
        }
    );
});

// 사용자 목록 조회 API (관리자용)
app.get('/api/users', authenticateAdmin, (req, res) => {
    db.all(
        'SELECT id, email, username, full_name, grade, class_name, student_number, status, created_at, approved_at FROM users ORDER BY created_at DESC',
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }
            res.json(users);
        }
    );
});

// 사용자 상세 정보 조회 API
app.get('/api/users/:id', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
        return res.status(400).json({ error: '유효하지 않은 사용자 ID입니다.' });
    }

    db.get(
        `SELECT id, email, username, full_name, grade, class_name, student_number, status, 
         created_at, approved_at, signup_ip_address, signup_user_agent, signup_referer, 
         signup_accept_language, signup_accept_encoding, signup_accept_charset, 
         signup_platform, signup_device_type
         FROM users WHERE id = ?`,
        [userId],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }

            if (!user) {
                return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            }

            res.json(user);
        }
    );
});

// 사용자 승인 API
app.post('/api/users/:id/approve', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
        return res.status(400).json({ error: '유효하지 않은 사용자 ID입니다.' });
    }

    db.run(
        'UPDATE users SET status = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['approved', userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '승인 처리 중 오류 발생' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            }

            res.json({ success: true, message: '사용자가 승인되었습니다' });
        }
    );
});

// 사용자 거부 API
app.post('/api/users/:id/reject', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
        return res.status(400).json({ error: '유효하지 않은 사용자 ID입니다.' });
    }

    db.run(
        'UPDATE users SET status = ? WHERE id = ?',
        ['rejected', userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '거부 처리 중 오류 발생' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            }

            res.json({ success: true, message: '사용자가 거부되었습니다' });
        }
    );
});

// 프로젝트 신청 목록 조회 API (관리자용)
app.get('/api/applications', authenticateAdmin, (req, res) => {
    db.all(
        'SELECT * FROM projects WHERE status = "pending" ORDER BY created_at DESC',
        (err, applications) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }
            res.json(applications);
        }
    );
});

// 프로젝트 신청 승인 API
app.post('/api/applications/:id/approve', authenticateAdmin, (req, res) => {
    const projectId = parseInt(req.params.id);

    if (isNaN(projectId)) {
        return res.status(400).json({ error: '유효하지 않은 프로젝트 ID입니다.' });
    }

    db.run(
        'UPDATE projects SET status = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['approved', projectId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '승인 처리 중 오류 발생' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다' });
            }

            res.json({
                success: true,
                message: '프로젝트가 승인되었습니다',
                projectId: projectId
            });
        }
    );
});

// 프로젝트 신청 거부 API
app.post('/api/applications/:id/reject', authenticateAdmin, (req, res) => {
    const projectId = parseInt(req.params.id);

    if (isNaN(projectId)) {
        return res.status(400).json({ error: '유효하지 않은 프로젝트 ID입니다.' });
    }

    db.run(
        'UPDATE projects SET status = ? WHERE id = ?',
        ['rejected', projectId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '거부 처리 중 오류 발생' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
            }

            res.json({ success: true, message: '신청이 거부되었습니다' });
        }
    );
});

// 승인된 프로젝트 목록 조회 API (공개)
app.get('/api/projects', (req, res) => {
    db.all(
        'SELECT id, title, description, category, project_url, image_url, image_size, created_at FROM projects WHERE status = "approved" ORDER BY created_at DESC',
        (err, projects) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }
            res.json(projects);
        }
    );
});

// 승인된 프로젝트 조회 API (단일) - 공개
app.get('/api/projects/:id', (req, res) => {
    const projectId = parseInt(req.params.id);

    if (isNaN(projectId)) {
        return res.status(400).json({ error: '유효하지 않은 프로젝트 ID입니다.' });
    }

    db.get(
        'SELECT * FROM projects WHERE id = ? AND status = "approved"',
        [projectId],
        (err, project) => {
            if (err) {
                return res.status(500).json({ error: '프로젝트 조회 중 오류 발생' });
            }

            if (!project) {
                return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
            }

            res.json(project);
        }
    );
});

// 승인된 프로젝트 수정 API (소유자 또는 관리자만)
app.put('/api/projects/:id', authenticateAdminOrUser, sanitizeInput, (req, res) => {
    const projectId = parseInt(req.params.id);
    const userId = req.user?.id || req.admin?.id;
    const userRole = req.user?.role || req.admin?.role || 'user';

    if (isNaN(projectId)) {
        return res.status(400).json({ error: '유효하지 않은 프로젝트 ID입니다.' });
    }

    // 먼저 프로젝트 소유자 확인
    db.get(
        'SELECT user_id FROM projects WHERE id = ? AND status = "approved"',
        [projectId],
        (err, project) => {
            if (err) {
                return res.status(500).json({ error: '프로젝트 조회 중 오류 발생' });
            }

            if (!project) {
                return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
            }

            // 관리자가 아니고 소유자도 아니면 거부
            if (userRole !== 'admin' && project.user_id !== userId) {
                return res.status(403).json({ error: '프로젝트를 수정할 권한이 없습니다.' });
            }

            const {
                title, description, project_url, image_size,
                detail_url, detail_images, detail_description, features, tech_stack, links
            } = req.body;

            db.run(
                `UPDATE projects 
                 SET title = ?, description = ?, project_url = ?, image_size = ?,
                     detail_url = ?, detail_images = ?, detail_description = ?, features = ?, tech_stack = ?, links = ?
                 WHERE id = ? AND status = "approved"`,
                [title, description, project_url, image_size,
                    detail_url, detail_images, detail_description, features, tech_stack, links, projectId],
                function (err) {
                    if (err) {
                        return res.status(500).json({ error: '수정 처리 중 오류 발생' });
                    }

                    if (this.changes === 0) {
                        return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
                    }

                    res.json({ success: true, message: '프로젝트가 수정되었습니다' });
                }
            );
        }
    );
});

// 승인된 프로젝트 삭제 API (소유자 또는 관리자만)
// 관리자 또는 사용자 인증 미들웨어
function authenticateAdminOrUser(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.adminToken || req.cookies?.userToken;

    if (!token) {
        return res.status(401).json({ error: '인증이 필요합니다.' });
    }

    // 관리자 토큰 먼저 확인
    try {
        const decoded = jwt.verify(token, JWT_ADMIN_SECRET);
        req.admin = decoded;
        req.user = { id: decoded.id, role: 'admin' };
        return next();
    } catch (e) {
        // 관리자 토큰이 아니면 일반 사용자 토큰 확인
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (error) {
            return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
        }
    }
}

app.delete('/api/projects/:id', authenticateAdminOrUser, (req, res) => {
    const projectId = parseInt(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.role || req.admin?.role || 'user';

    if (isNaN(projectId)) {
        return res.status(400).json({ error: '유효하지 않은 프로젝트 ID입니다.' });
    }

    // 먼저 프로젝트 소유자 확인
    db.get(
        'SELECT user_id FROM projects WHERE id = ? AND status = "approved"',
        [projectId],
        (err, project) => {
            if (err) {
                return res.status(500).json({ error: '프로젝트 조회 중 오류 발생' });
            }

            if (!project) {
                return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
            }

            // 관리자가 아니고 소유자도 아니면 거부
            if (userRole !== 'admin' && project.user_id !== userId) {
                return res.status(403).json({ error: '프로젝트를 삭제할 권한이 없습니다.' });
            }

            db.run(
                'DELETE FROM projects WHERE id = ? AND status = "approved"',
                [projectId],
                function (err) {
                    if (err) {
                        return res.status(500).json({ error: '삭제 중 오류 발생' });
                    }

                    if (this.changes === 0) {
                        return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
                    }

                    res.json({ success: true, message: '프로젝트가 삭제되었습니다' });
                }
            );
        }
    );
});

// 사용자 삭제 API (관리자만)
app.delete('/api/users/:id', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
        return res.status(400).json({ error: '유효하지 않은 사용자 ID입니다.' });
    }

    db.run(
        'DELETE FROM users WHERE id = ?',
        [userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '사용자 삭제 중 오류 발생' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            }

            res.json({ success: true, message: '사용자가 삭제되었습니다' });
        }
    );
});

// 통계 정보 API (관리자만)
app.get('/api/stats', authenticateAdmin, (req, res) => {
    const stats = {};

    // 대기 중인 신청 수
    db.get(
        'SELECT COUNT(*) as count FROM projects WHERE status = "pending"',
        (err, result) => {
            if (err) return res.status(500).json({ error: '서버 오류' });
            stats.pending = result.count;

            // 승인된 프로젝트 수
            db.get(
                'SELECT COUNT(*) as count FROM projects WHERE status = "approved"',
                (err, result) => {
                    if (err) return res.status(500).json({ error: '서버 오류' });
                    stats.approved = result.count;

                    // 전체 프로젝트 수 (승인된 프로젝트만)
                    stats.total = stats.approved;
                    res.json(stats);
                }
            );
        }
    );
});

// 관리자 활동 로그 API (관리자만)
app.get('/api/admin/activity-logs', authenticateAdmin, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    db.all(
        `SELECT 
            aal.id,
            aal.admin_id,
            a.username,
            aal.action,
            aal.ip_address,
            aal.user_agent,
            aal.details,
            aal.created_at
        FROM admin_activity_logs aal
        LEFT JOIN admins a ON aal.admin_id = a.id
        ORDER BY aal.created_at DESC
        LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, logs) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }
            res.json({ logs });
        }
    );
});

// 관리자 로그인 시도 로그 API (관리자만)
app.get('/api/admin/login-attempts', authenticateAdmin, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    db.all(
        `SELECT 
            id,
            username,
            ip_address,
            success,
            created_at
        FROM admin_login_attempts
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, attempts) => {
            if (err) {
                return res.status(500).json({ error: '서버 오류' });
            }
            res.json({ attempts });
        }
    );
});

// 이미지 업로드 API (인증된 사용자만)
app.post('/api/upload', authenticateUser, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    }

    if (!fs.existsSync(path.join(__dirname, 'public', 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({
        success: true,
        message: '이미지가 업로드되었습니다.',
        imageUrl: imageUrl,
        filename: req.file.filename
    });
});

// 여러 이미지 업로드 API (인증된 사용자만)
app.post('/api/upload-multiple', authenticateAdminOrUser, upload.array('images', 10), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.json({
        success: true,
        message: '이미지들이 업로드되었습니다.',
        imageUrls: imageUrls,
        filenames: req.files.map(file => file.filename)
    });
});

// 프로젝트 신청 저장 API (등록 폼에서 사용, 인증된 사용자만)
app.post('/api/applications', authenticateUser, sanitizeInput, (req, res) => {
    const {
        title, description, category, applicant_name, contact, email,
        project_url, image_size, detail_description,
        features, tech_stack, links, project_images
    } = req.body;

    // 입력값 검증
    if (!title || !description || !category || !contact) {
        return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
    }

    // URL 검증
    if (project_url && !validator.isURL(project_url)) {
        return res.status(400).json({ error: '유효한 URL을 입력해주세요.' });
    }

    // 첫 번째 이미지를 메인 이미지로 사용
    let mainImageUrl = '';
    if (project_images) {
        try {
            const images = JSON.parse(project_images);
            if (images.length > 0) {
                mainImageUrl = images[0];
            }
        } catch (e) {
            console.error('이미지 데이터 파싱 오류:', e);
        }
    }

    db.run(
        `INSERT INTO projects 
         (title, description, category, applicant_name, contact, email, project_url, image_url, 
          image_size, detail_description, features, tech_stack, links, project_images, user_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [title, description, category, applicant_name, contact, email || req.user.email, project_url, mainImageUrl,
            image_size || 'cover', detail_description || '', features || '', tech_stack || '',
            links || '', project_images || '', req.user.id],
        function (err) {
            if (err) {
                return res.status(500).json({ error: '신청 저장 중 오류 발생' });
            }

            const projectId = this.lastID;

            res.json({
                success: true,
                message: '신청이 접수되었습니다',
                projectId: projectId
            });
        }
    );
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 서버 실행: http://localhost:${PORT}`);
    initDatabase();
});

module.exports = app;
