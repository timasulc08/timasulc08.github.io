#!/usr/bin/env node
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
const userRoles = new Map(); // username -> role ('admin' or 'user')
const sessionTokens = new Map(); // token -> username
const pendingInvites = new Map(); // socketId -> roomId

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROLES_FILE = path.join(DATA_DIR, 'roles.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');
const avatars = new Map();
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '500', 10);
let roomMessages = {};
let dmMessages = {};

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
        const raw = fs.readFileSync(USERS_FILE, 'utf8').trim();
        const obj = raw ? JSON.parse(raw) : {};
        userAuth.clear();
        for (const [uname, hash] of Object.entries(obj)) {
            userAuth.set(uname, hash);
        }
        console.log(`Loaded ${userAuth.size} user account(s)`);
    } catch (e) {
        console.error('Failed to load users file', e);
        userAuth.clear();
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

function loadRolesFromFile() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        userRoles.clear();
        userRoles.set('admin', 'admin');
        
        if (fs.existsSync(ROLES_FILE)) {
            try {
                const raw = fs.readFileSync(ROLES_FILE, 'utf8').trim();
                if (raw && raw.length > 0) {
                    const obj = JSON.parse(raw);
                    userRoles.clear();
                    for (const [uname, role] of Object.entries(obj)) {
                        userRoles.set(uname, role);
                    }
                }
            } catch (parseError) {
                console.log('Invalid roles file, using defaults');
            }
        }
        
        saveRolesToFile();
        console.log(`Loaded ${userRoles.size} user role(s)`);
    } catch (e) {
        console.error('Failed to load roles file', e);
        userRoles.clear();
        userRoles.set('admin', 'admin');
    }
}

function saveRolesToFile() {
    try {
        const obj = Object.fromEntries(userRoles.entries());
        fs.writeFileSync(ROLES_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save roles file', e);
    }
}

function getUserRole(username) {
    return userRoles.get(username) || 'user';
}

function isAdmin(username) {
    return getUserRole(username) === 'admin';
}

function loadMessagesFromFile() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(MESSAGES_FILE)) {
            fs.writeFileSync(MESSAGES_FILE, JSON.stringify({}, null, 2), 'utf8');
        }
        const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        if (parsed && (parsed.rooms || parsed.dms)) {
            roomMessages = parsed.rooms || {};
            dmMessages = parsed.dms || {};
        } else {
            // Backward compatibility: old format was just room messages object
            roomMessages = parsed || {};
            dmMessages = {};
        }
    } catch (e) {
        console.error('Failed to load messages file', e);
        roomMessages = {};
        dmMessages = {};
    }
}

function saveMessagesToFile() {
    try {
        const payload = { __format: 'v2', rooms: roomMessages, dms: dmMessages };
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save messages file', e);
    }
}

function appendMessage(roomId, message) {
    const id = String(roomId);
    if (!roomMessages[id]) roomMessages[id] = [];
    roomMessages[id].push(message);
    if (roomMessages[id].length > MAX_HISTORY) {
        roomMessages[id] = roomMessages[id].slice(-MAX_HISTORY);
    }
    saveMessagesToFile();
}

function getRoomMessages(roomId) {
    const id = String(roomId);
    return Array.isArray(roomMessages[id]) ? roomMessages[id] : [];
}

function dmKey(a, b) {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    return [x, y].sort((m, n) => m.localeCompare(n)).join('|');
}

function appendDM(userA, userB, message) {
    const key = dmKey(userA, userB);
    if (!dmMessages[key]) dmMessages[key] = [];
    dmMessages[key].push(message);
    if (dmMessages[key].length > MAX_HISTORY) {
        dmMessages[key] = dmMessages[key].slice(-MAX_HISTORY);
    }
    saveMessagesToFile();
}

function getDM(userA, userB) {
    const key = dmKey(userA, userB);
    return Array.isArray(dmMessages[key]) ? dmMessages[key] : [];
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize a default group/room
rooms.set('general', new Set());
try {
    loadUsersFromFile();
    loadAvatarsFromFile();
    loadRolesFromFile();
    loadMessagesFromFile();
} catch (e) {
    console.log('Using default settings');
}

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
                role: getUserRole(username),
                timestamp: new Date(),
                roomId,
                replyToId: body.replyToId || null,
                replyToUsername: body.replyToUsername || null,
                replyToSnippet: body.replyToSnippet || null,
            };
            io.to(roomId).emit('new-message', messageData);
            appendMessage(roomId, messageData);
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
            currentRoom: null,
            online: true,
            lastSeen: new Date()
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
                // Send recent history to this user only
                try {
                    const hist = getRoomMessages(invRoom).slice(-100);
                    for (const m of hist) {
                        socket.emit('new-message', m);
                    }
                } catch {}
                broadcastGroupsList();
            }
            pendingInvites.delete(socket.id);
        }
    });

    // Groups: send list
    socket.on('get-groups', () => {
        socket.emit('groups-update', listGroupsForSocket(socket.id));
    });

    // Private messages: send
    socket.on('send-private', (data) => {
        const fromUser = users.get(socket.id);
        if (!fromUser) return;
        const toName = String((data && (data.to || data.toUsername)) || '').trim();
        const text = String((data && data.message) || '').trim();
        if (!toName || !text) return;

        let targetSocketId = null;
        for (const [sid, u] of users.entries()) {
            if (u.username === toName) { targetSocketId = sid; break; }
        }
        const msg = {
            id: Date.now(),
            username: fromUser.username,
            to: toName,
            message: text,
            avatarUrl: avatars.get(fromUser.username) || null,
            role: getUserRole(fromUser.username),
            timestamp: new Date(),
            replyToId: (data && data.replyToId) || null,
            replyToUsername: (data && data.replyToUsername) || null,
            replyToSnippet: (data && data.replyToSnippet) || null,
        };
        // Emit to both participants
        socket.emit('private-message', msg);
        if (targetSocketId) io.to(targetSocketId).emit('private-message', msg);
        appendDM(fromUser.username, toName, msg);
    });

    // Private messages: history
    socket.on('get-private-history', (data) => {
        const fromUser = users.get(socket.id);
        if (!fromUser) return;
        const other = String((data && (data.with || data.username)) || '').trim();
        if (!other) return;
        const hist = getDM(fromUser.username, other).slice(-100);
        for (const m of hist) {
            socket.emit('private-message', m);
        }
    });

    // Handle editing private messages
    socket.on('edit-private-message', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const { messageId, newMessage, otherUser } = data;
        if (!messageId || !newMessage || !otherUser) return;
        
        // Find and update message in DM messages
        const key = dmKey(user.username, otherUser);
        const messages = dmMessages[key] || [];
        const messageIndex = messages.findIndex(msg => msg.id == messageId && msg.username === user.username);
        
        if (messageIndex !== -1) {
            messages[messageIndex].message = newMessage;
            messages[messageIndex].edited = true;
            messages[messageIndex].editedAt = new Date();
            
            // Save to file
            saveMessagesToFile();
            
            // Find target user socket
            let targetSocketId = null;
            for (const [sid, u] of users.entries()) {
                if (u.username === otherUser) { targetSocketId = sid; break; }
            }
            
            // Broadcast updated message to both users
            const updateData = {
                messageId: messageId,
                newMessage: newMessage,
                edited: true,
                editedAt: messages[messageIndex].editedAt,
                otherUser: otherUser
            };
            
            socket.emit('private-message-edited', updateData);
            if (targetSocketId) {
                io.to(targetSocketId).emit('private-message-edited', updateData);
            }
        }
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
            // Send recent history to this user only
            try {
                const hist = getRoomMessages(roomId).slice(-100);
                for (const m of hist) {
                    socket.emit('new-message', m);
                }
            } catch {}
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
            role: getUserRole(data.username),
            timestamp: new Date(),
            roomId: data.roomId,
            replyToId: data.replyToId || null,
            replyToUsername: data.replyToUsername || null,
            replyToSnippet: data.replyToSnippet || null,
        };
        
        // Broadcast message to room
        io.to(data.roomId).emit('new-message', messageData);
        appendMessage(data.roomId, messageData);
    });

    // Handle editing messages
    socket.on('edit-message', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const { messageId, newMessage, roomId } = data;
        if (!messageId || !newMessage || !roomId) return;
        
        // Find and update message in room messages
        const messages = getRoomMessages(roomId);
        const messageIndex = messages.findIndex(msg => msg.id == messageId && msg.username === user.username);
        
        if (messageIndex !== -1) {
            messages[messageIndex].message = newMessage;
            messages[messageIndex].edited = true;
            messages[messageIndex].editedAt = new Date();
            
            // Save to file
            saveMessagesToFile();
            
            // Broadcast updated message to room
            io.to(roomId).emit('message-edited', {
                messageId: messageId,
                newMessage: newMessage,
                edited: true,
                editedAt: messages[messageIndex].editedAt
            });
        }
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

    // Handle admin notifications
    socket.on('admin-notification', (message) => {
        const user = users.get(socket.id);
        if (user && getUserRole(user.username) === 'admin') {
            io.emit('admin-notification', {
                message: message,
                from: user.username,
                timestamp: new Date().toISOString()
            });
        }
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
        
        // Mark user as offline instead of removing
        const user = users.get(socket.id);
        if (user) {
            user.online = false;
            user.lastSeen = new Date();
        }
        
        // Remove user from all rooms
        for (const [roomId, members] of rooms.entries()) {
            if (members.delete(socket.id) && members.size === 0) {
                rooms.delete(roomId);
            }
        }
        
        // Keep user in list but mark as offline
        setTimeout(() => {
            users.delete(socket.id);
            broadcastUsersList();
        }, 5000); // Remove after 5 seconds
        
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
            role: getUserRole(u.username),
            online: u.online || false,
            lastSeen: u.lastSeen || new Date()
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

const startServer = () => {
    try {
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ PivoGram server running on port ${PORT}`);
            console.log(`🌐 Health check: http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();