const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and rooms
const users = new Map();
const rooms = new Map();
const activeCalls = new Map();
const userAuth = new Map(); // username -> passwordHash
const sessionTokens = new Map(); // token -> username
const pendingInvites = new Map(); // socketId -> roomId

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');
const avatars = new Map();

// Multer storage for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        } catch (e) {}
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
        const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
        cb(null, name);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if ((file.mimetype || '').startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    },
});

function loadUsersFromFile() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2), 'utf8');
        }
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const obj = JSON.parse(raw || '{}');
        for (const [uname, hash] of Object.entries(obj)) {
            userAuth.set(uname, hash);
        }
        console.log(`Loaded ${userAuth.size} user account(s)`);
    } catch (e) {
        console.error('Failed to load users file', e);
    }
}

function saveUsersToFile() {
    try {
        const obj = Object.fromEntries(userAuth.entries());
        fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save users file', e);
    }
}

function loadAvatarsFromFile() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(AVATARS_FILE)) {
            fs.writeFileSync(AVATARS_FILE, JSON.stringify({}, null, 2), 'utf8');
        }
        const raw = fs.readFileSync(AVATARS_FILE, 'utf8');
        const obj = JSON.parse(raw || '{}');
        avatars.clear();
        for (const [uname, url] of Object.entries(obj)) {
            avatars.set(uname, url);
        }
        console.log(`Loaded ${avatars.size} avatar(s)`);
    } catch (e) {
        console.error('Failed to load avatars file', e);
    }
}

function saveAvatarsToFile() {
    try {
        const obj = Object.fromEntries(avatars.entries());
        fs.writeFileSync(AVATARS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save avatars file', e);
    }
}

function parseCookies(req) {
    const header = req.headers?.cookie || '';
    const out = {};
    header.split(';').forEach(part => {
        const [k, v] = part.split('=');
        if (!k) return;
        out[k.trim()] = decodeURIComponent((v || '').trim());
    });
    return out;
}

function issueSession(res, username) {
    const token = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(token, username);
    res.setHeader('Set-Cookie', `auth=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function getUserFromReq(req) {
    const cookies = parseCookies(req);
    const token = cookies.auth;
    if (!token) return null;
    const username = sessionTokens.get(token);
    return username || null;
}

// Initialize a default group/room
rooms.set('general', new Set());
loadUsersFromFile();
loadAvatarsFromFile();

// Auth endpoints
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ ok: false, error: 'Username and password are required' });
        }
        const uname = String(username).trim();
        if (uname.length < 3 || uname.length > 20) {
            return res.status(400).json({ ok: false, error: 'Username must be 3-20 characters' });
        }
        if (userAuth.has(uname)) {
            return res.status(409).json({ ok: false, error: 'Username already exists' });
        }
        const pwd = String(password);
        if (pwd.length < 6 || pwd.length > 100) {
            return res.status(400).json({ ok: false, error: 'Password must be 6-100 characters' });
        }
        const hash = await bcrypt.hash(pwd, 10);
        userAuth.set(uname, hash);
        saveUsersToFile();
        return res.json({ ok: true });
    } catch (e) {
        console.error('Register error', e);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ ok: false, error: 'Username and password are required' });
        }
        const uname = String(username).trim();
        const stored = userAuth.get(uname);
        if (!stored) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        const ok = await bcrypt.compare(String(password), stored);
        if (!ok) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        issueSession(res, uname);
        return res.json({ ok: true, username: uname });
    } catch (e) {
        console.error('Login error', e);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

app.get('/api/me', (req, res) => {
    const username = getUserFromReq(req);
    if (!username) {
        return res.status(401).json({ ok: false });
    }
    return res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies.auth;
    if (token) {
        sessionTokens.delete(token);
    }
    res.setHeader('Set-Cookie', 'auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    return res.json({ ok: true });
});

// Upload photo endpoint
app.post('/api/upload/avatar', (req, res) => {
    upload.single('avatar')(req, res, (err) => {
        if (err) {
            const msg = err.message || String(err);
            const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(code).json({ ok: false, error: `Upload error: ${msg}` });
        }
        const username = getUserFromReq(req);
        if (!username) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        try {
            if (!req.file) {
                return res.status(400).json({ ok: false, error: 'No file uploaded' });
            }
            const publicUrl = `/uploads/${req.file.filename}`;
            avatars.set(username, publicUrl);
            saveAvatarsToFile();
            // Also push updated users list with avatar urls
            const usersList = Array.from(users.values()).map(u => ({
                id: u.id,
                username: u.username,
                currentRoom: u.currentRoom,
                avatarUrl: avatars.get(u.username) || null,
            }));
            io.emit('users-update', usersList);
            return res.json({ ok: true, url: publicUrl });
        } catch (e) {
            console.error('Avatar upload error', e);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    });
});

app.post('/api/upload/photo', (req, res) => {
    upload.single('photo')(req, res, (err) => {
        if (err) {
            const msg = err.message || String(err);
            const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(code).json({ ok: false, error: `Upload error: ${msg}` });
        }
        const username = getUserFromReq(req);
        if (!username) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        try {
            const body = req.body || {};
            const roomId = String(body.roomId || '').trim();
            if (!roomId) {
                return res.status(400).json({ ok: false, error: 'roomId is required' });
            }
            if (!req.file) {
                return res.status(400).json({ ok: false, error: 'No file uploaded' });
            }
            const publicUrl = `/uploads/${req.file.filename}`;
            const messageData = {
                id: Date.now(),
                username,
                message: '',
                imageUrl: publicUrl,
                avatarUrl: avatars.get(username) || null,
                timestamp: new Date(),
                roomId
            };
            io.to(roomId).emit('new-message', messageData);
            return res.json({ ok: true, url: publicUrl, message: messageData });
        } catch (e) {
            console.error('Upload error', e);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    });
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    // Capture pending invite room from cookie set by /invite/:roomId
    try {
        const cookieHeader = (socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie) || '';
        let inviteRoom = null;
        cookieHeader.split(';').forEach(part => {
            const [k, v] = part.split('=');
            if (k && k.trim() === 'invite') {
                inviteRoom = decodeURIComponent((v || '').trim());
            }
        });
        if (inviteRoom) {
            pendingInvites.set(socket.id, inviteRoom);
        }
    } catch {}

    // Handle user joining
    socket.on('user-join', (data) => {
        users.set(socket.id, {
            id: socket.id,
            username: data.username,
            currentRoom: null
        });
        
        // Broadcast updated users list
        broadcastUsersList();

        // Auto-join pending invite room if present
        const invRoom = pendingInvites.get(socket.id);
        if (invRoom) {
            const user = users.get(socket.id);
            if (user) {
                if (user.currentRoom) {
                    socket.leave(user.currentRoom);
                }
                socket.join(invRoom);
                user.currentRoom = invRoom;
                if (!rooms.has(invRoom)) {
                    rooms.set(invRoom, new Set());
                }
                rooms.get(invRoom).add(socket.id);
                socket.emit('room-joined', invRoom);
                broadcastGroupsList();
            }
            pendingInvites.delete(socket.id);
        }
    });

    // Groups: send list
    socket.on('get-groups', () => {
        socket.emit('groups-update', listGroupsForSocket(socket.id));
    });

    // Groups: create new
    socket.on('create-group', (groupId) => {
        const id = String(groupId || '').trim();
        if (id && !rooms.has(id)) {
            rooms.set(id, new Set());
            // Add creator to the new group so only they can see it until others join via invite
            rooms.get(id).add(socket.id);
            broadcastGroupsList();
        }
    });

    // Handle joining a room
    socket.on('join-room', (roomId) => {
        const user = users.get(socket.id);
        if (user) {
            // Leave previous room
            if (user.currentRoom) {
                socket.leave(user.currentRoom);
            }
            
            // Join new room
            socket.join(roomId);
            user.currentRoom = roomId;
            
            // Add room if it doesn't exist
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }
            rooms.get(roomId).add(socket.id);
            
            socket.emit('room-joined', roomId);
            broadcastGroupsList();
        }
    });

    // Handle sending messages
    socket.on('send-message', (data) => {
        const messageData = {
            id: Date.now(),
            username: data.username,
            message: data.message,
            avatarUrl: avatars.get(data.username) || null,
            timestamp: new Date(),
            roomId: data.roomId
        };
        
        // Broadcast message to room
        io.to(data.roomId).emit('new-message', messageData);
    });

    // Handle call initiation
    socket.on('initiate-call', (data) => {
        const caller = users.get(socket.id);
        if (caller) {
            // Find target user by username (in a real app, you'd use proper user IDs)
            let targetSocketId = null;
            for (const [socketId, user] of users.entries()) {
                if (user.username === data.targetUserId) {
                    targetSocketId = socketId;
                    break;
                }
            }
            
            if (targetSocketId) {
                const callId = `call_${Date.now()}`;
                activeCalls.set(callId, {
                    callerId: socket.id,
                    targetId: targetSocketId,
                    callType: data.callType,
                    status: 'pending'
                });
                
                // Send call invitation to target user
                io.to(targetSocketId).emit('incoming-call', {
                    callerId: socket.id,
                    callerName: caller.username,
                    callType: data.callType,
                    callId: callId
                });
            }
        }
    });

    // Handle call response
    socket.on('call-response', (data) => {
        const callId = findCallByParticipant(socket.id);
        if (callId) {
            const call = activeCalls.get(callId);
            if (data.accepted) {
                call.status = 'active';
                
                // Notify both users that call started
                io.to(call.callerId).emit('call-started', { callId });
                io.to(call.targetId).emit('call-started', { callId });
            } else {
                // Call declined
                io.to(call.callerId).emit('call-declined');
                activeCalls.delete(callId);
            }
        }
    });

    // Handle ending calls
    socket.on('end-call', (callId) => {
        const call = activeCalls.get(callId);
        if (call) {
            // Notify both users that call ended
            io.to(call.callerId).emit('call-ended');
            io.to(call.targetId).emit('call-ended');
            activeCalls.delete(callId);
        }
    });

    // WebRTC signaling
    socket.on('webrtc-offer', (data) => {
        socket.to(data.targetId).emit('webrtc-offer', {
            offer: data.offer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.targetId).emit('webrtc-answer', {
            answer: data.answer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.targetId).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // End any active calls
        const callId = findCallByParticipant(socket.id);
        if (callId) {
            const call = activeCalls.get(callId);
            const otherUserId = call.callerId === socket.id ? call.targetId : call.callerId;
            io.to(otherUserId).emit('call-ended');
            activeCalls.delete(callId);
        }
        
        // Remove user from all rooms and users list
        for (const [roomId, members] of rooms.entries()) {
            if (members.delete(socket.id) && members.size === 0) {
                rooms.delete(roomId);
            }
        }
        
        users.delete(socket.id);
        broadcastUsersList();
        broadcastGroupsList();
    });

    function findCallByParticipant(socketId) {
        for (const [callId, call] of activeCalls.entries()) {
            if (call.callerId === socketId || call.targetId === socketId) {
                return callId;
            }
        }
        return null;
    }

    function broadcastUsersList() {
        const usersList = Array.from(users.values()).map(u => ({
            id: u.id,
            username: u.username,
            currentRoom: u.currentRoom,
            avatarUrl: avatars.get(u.username) || null,
        }));
        io.emit('users-update', usersList);
    }

    function listGroupsForSocket(socketId) {
        return Array.from(rooms.entries())
            .filter(([id, members]) => members.has(socketId))
            .map(([id, members]) => ({
                id,
                memberCount: members.size
            }));
    }

    function broadcastGroupsList() {
        for (const sid of users.keys()) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
                s.emit('groups-update', listGroupsForSocket(sid));
            }
        }
    }
});

app.get('/invite/:roomId', (req, res) => {
    const roomId = String(req.params.roomId || '').trim();
    // Set a short-lived cookie so server can auto-join after socket connects
    res.setHeader('Set-Cookie', `invite=${encodeURIComponent(roomId)}; Path=/; Max-Age=600; SameSite=Lax`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});