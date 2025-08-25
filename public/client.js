// Discord-like App Client JavaScript
class DiscordApp {
    constructor() {
        this.socket = null;
        this.username = '';
        this.currentRoom = this.getInviteRoomFromUrl() || 'general';
        this.groups = [];
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isInCall = false;
        this.currentCallId = null;
        this.currentCallerId = null;
        // Chat state
        this.inDM = false;
        this.dmWith = null;
        this.dmPartners = new Set();
        this.replyContext = null; // { id, username, snippet }
        this.editContext = null; // { id, originalMessage }
        
        // WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        // I18n
        this.lang = localStorage.getItem('lang') || ((navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en');
        this.i18n = {
            en: {
                server_name: 'PivoGram',
                copy_invite_title: 'Copy invite link',
                logout_title: 'Logout',
                language_title: 'Language',
                groups_title: 'Groups',
                create_group_title: 'Create group',
                online_users: 'Online Users',
                menu_title: 'Menu',
                voice_call_title: 'Voice Call',
                video_call_title: 'Video Call',
                message_placeholder: 'Type a message...',
                send_button: 'Send',
                auth_username_placeholder: 'Username (3-20 chars)',
                auth_password_placeholder: 'Password (6-100 chars)',
                login: 'Login',
                register: 'Register',
                need_account_register: 'Need an account? Register',
                have_account_login: 'Have an account? Login',
                auth_username_requirements: 'Username must be 3-20 characters',
                auth_password_requirements: 'Password must be 6-100 characters',
                register_success: 'Registration successful. Please login.',
                already_in_call: 'You are already in a call',
                no_users_available: 'No users available to call',
                create_group_prompt: 'Create group name:',
                enter_username_call: 'Enter username to call:',
                is_calling_you: 'is calling you',
                incoming: 'Incoming',
                voice: 'voice',
                video: 'video',
                call: 'call',
                call_connecting: 'Connecting...',
                call_declined: 'Call declined',
                call_in_progress: 'Call in progress...',
                could_not_access_media: 'Could not access camera/microphone. Please check permissions.',
                calling_prefix: 'Calling',
                direct_messages_title: 'Direct Messages',
                reply: 'Reply',
                reply_to_label: 'Reply to',
                replying_to_label: 'Replying to',
                photo_label: 'Photo',
                edit: 'Edit',
                edited: 'edited',
                editing_message: 'Editing message',
                save_button: 'Save',
                cancel: 'Cancel'
            },
            ru: {
                server_name: 'PivoGram',
                copy_invite_title: 'Скопировать ссылку-приглашение',
                logout_title: 'Выйти',
                language_title: 'Язык',
                groups_title: 'Группы',
                create_group_title: 'Создать группу',
                online_users: 'Онлайн пользователи',
                menu_title: 'Меню',
                voice_call_title: 'Голосовой звонок',
                video_call_title: 'Видео звонок',
                message_placeholder: 'Введите сообщение...',
                send_button: 'Отправить',
                auth_username_placeholder: 'Имя пользователя (3-20 символов)',
                auth_password_placeholder: 'Пароль (6-100 символов)',
                login: 'Войти',
                register: 'Регистрация',
                need_account_register: 'Нет аккаунта? Зарегистрируйтесь',
                have_account_login: 'Уже есть аккаунт? Войти',
                auth_username_requirements: 'Имя пользователя должно быть от 3 до 20 символов',
                auth_password_requirements: 'Пароль должен быть от 6 до 100 символов',
                register_success: 'Регистрация успешна. Пожалуйста, войдите.',
                already_in_call: 'Вы уже в звонке',
                no_users_available: 'Нет доступных пользователей для звонка',
                create_group_prompt: 'Название группы:',
                enter_username_call: 'Введите имя пользователя для звонка:',
                is_calling_you: 'звонит вам',
                incoming: 'Входящий',
                voice: 'голосовой',
                video: 'видеозвонок',
                call: 'звонок',
                call_connecting: 'Соединение...',
                call_declined: 'Звонок отклонен',
                call_in_progress: 'Идет звонок...',
                could_not_access_media: 'Не удалось получить доступ к камере/микрофону. Проверьте разрешения.',
                calling_prefix: 'Звонок',
                direct_messages_title: 'Личные сообщения',
                reply: 'Ответить',
                reply_to_label: 'Ответ на',
                replying_to_label: 'Ответ пользователю',
                photo_label: 'Фото',
                edit: 'Редактировать',
                edited: 'изменено',
                editing_message: 'Редактирование сообщения',
                save_button: 'Сохранить',
                cancel: 'Отмена'
            }
        };
        
        this.init();
    }
    
    async init() {
        this.setupEventListeners();
        this.applyI18n();
        // Check existing session
        try {
            const res = await fetch('/api/me');
            const data = await res.json();
            if (res.ok && data.ok) {
                this.username = data.username;
                this.hideLoginModal();
                this.connectToServer();
                const inviteRoom = this.getInviteRoomFromUrl();
                if (inviteRoom) {
                    this.joinGroup(inviteRoom);
                }
                return;
            }
        } catch {}
        this.showLoginModal();
    }
    
    setupEventListeners() {
        // Message input events
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
        
        sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });
        
        // Reply and Edit actions (event delegation)
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.addEventListener('click', (e) => {
                const replyBtn = e.target.closest('.reply-btn');
                const editBtn = e.target.closest('.edit-btn');
                
                if (replyBtn) {
                    const id = replyBtn.dataset.id;
                    const username = replyBtn.dataset.username || '';
                    const snippet = replyBtn.dataset.snippet || '';
                    this.setReplyContext({ id, username, snippet });
                }
                
                if (editBtn) {
                    const id = editBtn.dataset.id;
                    const currentMessage = editBtn.dataset.message || '';
                    this.startEditMessage(id, currentMessage);
                }
            });
            
            // Долгое нажатие для мобильных
            let longPressTimer;
            messagesContainer.addEventListener('touchstart', (e) => {
                const messageEl = e.target.closest('.message');
                if (messageEl && messageEl.classList.contains('mine')) {
                    longPressTimer = setTimeout(() => {
                        const id = messageEl.dataset.messageId;
                        const contentEl = messageEl.querySelector('.message-content');
                        const message = contentEl ? contentEl.textContent.replace('(изменено)', '').trim() : '';
                        if (id && message) {
                            this.startEditMessage(id, message);
                        }
                    }, 500);
                }
            });
            
            messagesContainer.addEventListener('touchend', () => {
                clearTimeout(longPressTimer);
            });
            
            messagesContainer.addEventListener('touchmove', () => {
                clearTimeout(longPressTimer);
            });
        }
        const cancelReplyBtn = document.getElementById('cancelReplyBtn');
        if (cancelReplyBtn) {
            cancelReplyBtn.addEventListener('click', () => this.clearReplyContext());
        }
        
        const cancelEditBtn = document.getElementById('cancelEditBtn');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => this.cancelEditMessage());
        }
        
        const attachImageBtn = document.getElementById('attachImageBtn');
        const imageInput = document.getElementById('imageInput');
        if (attachImageBtn && imageInput) {
            attachImageBtn.addEventListener('click', () => imageInput.click());
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) this.sendPhoto(file);
                imageInput.value = '';
            });
        }
        
        // Call button events
        document.getElementById('voiceCallBtn').addEventListener('click', () => {
            this.initiateCall('voice');
        });
        
        document.getElementById('videoCallBtn').addEventListener('click', () => {
            this.initiateCall('video');
        });
        
        // Mobile sidebar toggle
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const closeSidebar = () => {
            sidebar?.classList.remove('open');
            overlay?.classList.remove('show');
        };
        const openSidebar = () => {
            sidebar?.classList.add('open');
            overlay?.classList.add('show');
        };
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                if (sidebar?.classList.contains('open')) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            });
        }
        if (overlay) {
            overlay.addEventListener('click', closeSidebar);
        }

        // Avatar upload
        const avatarBtn = document.getElementById('avatarBtn');
        const avatarInput = document.getElementById('avatarInput');
        if (avatarBtn && avatarInput) {
            avatarBtn.addEventListener('click', () => avatarInput.click());
            avatarInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const fd = new FormData();
                    fd.append('avatar', file);
                    const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
                    const data = await res.json();
                    if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed');
                    // Avatar updated on server; users-update will refresh via socket
                } catch (err) {
                    alert('Avatar upload failed: ' + err.message);
                } finally {
                    avatarInput.value = '';
                }
            });
        }

        // DMs list click
        const dmsList = document.getElementById('dmsList');
        if (dmsList) {
            dmsList.addEventListener('click', (e) => {
                const item = e.target.closest('.dm-item');
                if (item) this.openDM(item.dataset.username);
            });
        }

        // Invite link copy
        const inviteBtn = document.getElementById('inviteLinkBtn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', () => {
                const url = `${window.location.origin}/invite/${encodeURIComponent(this.currentRoom)}`;
                navigator.clipboard.writeText(url).then(() => {
                    inviteBtn.textContent = '✅';
                    setTimeout(() => (inviteBtn.textContent = '🔗'), 1200);
                }).catch(() => {
                    alert(`Invite link: ${url}`);
                });
            });
        }

        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
        
        // Call modal events
        document.getElementById('acceptCall').addEventListener('click', () => {
            this.acceptCall();
        });
        
        document.getElementById('declineCall').addEventListener('click', () => {
            this.declineCall();
        });
        
        document.getElementById('endCall').addEventListener('click', () => {
            this.endCall();
        });
        
        // Username input event
        document.getElementById('usernameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinApp();
            }
        });

        // Groups UI
        const addGroupBtn = document.getElementById('addGroupBtn');
        if (addGroupBtn) {
            addGroupBtn.addEventListener('click', () => {
                const name = prompt(this.t('create_group_prompt'));
                if (name && name.trim().length > 0) {
                    this.socket.emit('create-group', name.trim());
                }
            });
        }
    }
    
    showLoginModal() {
        document.getElementById('loginModal').style.display = 'flex';
        const authPrimaryBtn = document.getElementById('authPrimaryBtn');
        const authToggleBtn = document.getElementById('authToggleBtn');
        const usernameInput = document.getElementById('usernameInput');
        const passwordInput = document.getElementById('passwordInput');
        const authTitle = document.getElementById('authTitle');
        const authError = document.getElementById('authError');

        let mode = 'login'; // or 'register'

        const applyMode = () => {
            authTitle.textContent = mode === 'login' ? this.t('login') : this.t('register');
            authPrimaryBtn.textContent = mode === 'login' ? this.t('login') : this.t('register');
            authToggleBtn.textContent = mode === 'login' ? this.t('need_account_register') : this.t('have_account_login');
            authError.style.display = 'none';
            authError.textContent = '';
            usernameInput.value = '';
            passwordInput.value = '';
            usernameInput.focus();
        };

        const submit = async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            if (username.length < 3 || username.length > 20) {
                authError.style.display = 'block';
                authError.textContent = this.t('auth_username_requirements');
                return;
            }
            if (password.length < 6 || password.length > 100) {
                authError.style.display = 'block';
                authError.textContent = this.t('auth_password_requirements');
                return;
            }
            try {
                const res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (!res.ok || !data.ok) {
                    throw new Error(data.error || 'Request failed');
                }
                // For register, auto switch to login after success
                if (mode === 'register') {
                    mode = 'login';
                    applyMode();
                    authError.style.display = 'block';
                    authError.style.color = '#43b581';
                    authError.textContent = this.t('register_success');
                    return;
                }
                // Login success
                this.username = username;
                this.hideLoginModal();
                this.connectToServer();
                // If URL had invite link, ensure we join that room
                const inviteRoom = this.getInviteRoomFromUrl();
                if (inviteRoom) {
                    this.joinGroup(inviteRoom);
                }
            } catch (err) {
                authError.style.display = 'block';
                authError.style.color = '#ed4245';
                authError.textContent = err.message;
            }
        };

        authPrimaryBtn.onclick = submit;
        authToggleBtn.onclick = () => {
            mode = mode === 'login' ? 'register' : 'login';
            authError.style.color = '#ed4245';
            applyMode();
        };

        usernameInput.onkeypress = (e) => { if (e.key === 'Enter') submit(); };
        passwordInput.onkeypress = (e) => { if (e.key === 'Enter') submit(); };

        this._setAuthModeTexts = applyMode;
        applyMode();
    }
    
    hideLoginModal() {
        document.getElementById('loginModal').style.display = 'none';
    }
    
    showCallModal(message = '') {
        const callModal = document.getElementById('callModal');
        const callStatus = document.getElementById('callStatus');
        
        if (message) {
            callStatus.textContent = message;
        }
        
        callModal.style.display = 'flex';
    }
    
    hideCallModal() {
        document.getElementById('callModal').style.display = 'none';
    }
    
    joinApp() {
        // Deprecated by auth modal; kept for backward compatibility if needed
        const usernameInput = document.getElementById('usernameInput');
        const username = usernameInput ? usernameInput.value.trim() : '';
        if (!username) return;
        this.username = username;
        this.hideLoginModal();
        this.connectToServer();
    }
    
    connectToServer() {
        this.socket = io();
        
        // Connection events
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('user-join', { username: this.username });
            this.socket.emit('join-room', this.currentRoom);
            this.socket.emit('get-groups');
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
        
        // User management events
        this.socket.on('users-update', (users) => {
            this.updateUsersList(users);
        });
        
        this.socket.on('room-joined', (roomId) => {
            console.log('Joined room:', roomId);
            this.currentRoom = roomId;
            const channelName = document.getElementById('channelName');
            if (channelName) channelName.textContent = `# ${roomId}`;
            this.highlightActiveGroup();
            this.clearMessages();
        });

        // Groups events
        this.socket.on('groups-update', (groups) => {
            this.groups = groups;
            this.renderGroups();
        });
        
        // Message events
        this.socket.on('new-message', (messageData) => {
            // Only show room messages when not viewing a DM
            if (!this.inDM) {
                this.displayMessage(messageData);
                // Show notification if not own message and page not visible
                if (messageData.username !== this.username && document.hidden) {
                    this.showNotification(`${messageData.username} в #${this.currentRoom}`, messageData.message || 'Отправил изображение');
                }
            }
        });
        
        // Private message events
        this.socket.on('private-message', (messageData) => {
            this.handlePrivateMessage(messageData);
            // Show notification for private messages if not own message and page not visible
            if (messageData.username !== this.username && document.hidden) {
                this.showNotification(`${messageData.username} (личное)`, messageData.message || 'Отправил изображение');
            }
        });
        
        // Message editing events
        this.socket.on('message-edited', (data) => {
            this.handleMessageEdited(data);
        });
        
        this.socket.on('private-message-edited', (data) => {
            this.handlePrivateMessageEdited(data);
        });
        
        // Call events
        this.socket.on('incoming-call', (data) => {
            this.handleIncomingCall(data);
        });
        
        this.socket.on('call-started', (data) => {
            this.handleCallStarted(data);
        });
        
        this.socket.on('call-declined', () => {
            this.handleCallDeclined();
        });
        
        this.socket.on('call-ended', () => {
            this.handleCallEnded();
        });
        
        // WebRTC signaling events
        this.socket.on('webrtc-offer', (data) => {
            this.handleWebRTCOffer(data);
        });
        
        this.socket.on('webrtc-answer', (data) => {
            this.handleWebRTCAnswer(data);
        });
        
        this.socket.on('webrtc-ice-candidate', (data) => {
            this.handleWebRTCIceCandidate(data);
        });
    }
    
    renderGroups() {
        const list = document.getElementById('groupsList');
        if (!list) return;
        list.innerHTML = '';

        this.groups.forEach(g => {
            const item = document.createElement('div');
            item.className = 'group-item' + (g.id === this.currentRoom ? ' active' : '');
            item.innerHTML = `
                <span># ${this.escapeHtml(g.id)}</span>
                <span style="color:#8e9297;font-size:12px;">${g.memberCount}</span>
            `;
            item.addEventListener('click', () => {
                if (g.id !== this.currentRoom) {
                    this.joinGroup(g.id);
                }
                // Close mobile sidebar after selection
                const sidebar = document.querySelector('.sidebar');
                const overlay = document.getElementById('sidebarOverlay');
                sidebar?.classList.remove('open');
                overlay?.classList.remove('show');
            });
            list.appendChild(item);
        });
    }

    highlightActiveGroup() {
        const list = document.getElementById('groupsList');
        if (!list) return;
        list.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
        const items = Array.from(list.querySelectorAll('.group-item'));
        items.forEach(el => {
            if (el.textContent.trim().startsWith(`# ${this.currentRoom}`)) {
                el.classList.add('active');
            }
        });
    }

    joinGroup(id) {
        if (!this.socket) return;
        this.socket.emit('join-room', id);
    }

    clearMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) messagesContainer.innerHTML = '';
    }
    
    updateUsersList(users) {
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';
        
        users.forEach(user => {
            if (user.username !== this.username) {
                const userItem = document.createElement('div');
                userItem.className = 'user-item';
                const avatar = user.avatarUrl ? `<img class="avatar" src="${user.avatarUrl}" alt="">` : '';
                const usernameClass = user.role === 'admin' ? 'username admin' : 'username';
                userItem.innerHTML = `
                    <span style="display:flex;align-items:center;gap:8px;">${avatar}<span class="${usernameClass}">${user.username}</span></span>
                    <div class="status-indicator"></div>
                `;
                userItem.addEventListener('click', () => {
                    this.selectUser(user);
                });
                usersList.appendChild(userItem);
            }
        });
    }
    
    selectUser(user) {
        // Open a DM with this user
        if (!user || !user.username) return;
        this.openDM(user.username);
    }
    
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        
        if (!message) return;
        
        // Check if we're editing a message
        if (this.editContext) {
            this.saveEditedMessage(message);
            return;
        }
        
        if (this.inDM && this.dmWith) {
            const payload = {
                to: this.dmWith,
                message,
            };
            if (this.replyContext) {
                payload.replyToId = this.replyContext.id;
                payload.replyToUsername = this.replyContext.username;
                payload.replyToSnippet = this.replyContext.snippet;
            }
            this.socket.emit('send-private', payload);
            this.clearReplyContext();
        } else {
            const payload = {
                roomId: this.currentRoom,
                message: message,
                username: this.username,
            };
            if (this.replyContext) {
                payload.replyToId = this.replyContext.id;
                payload.replyToUsername = this.replyContext.username;
                payload.replyToSnippet = this.replyContext.snippet;
            }
            this.socket.emit('send-message', payload);
            this.clearReplyContext();
        }
        messageInput.value = '';
    }
    
    displayMessage(messageData) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageElement = document.createElement('div');
        
        // Check if this is the user's own message for phone mode
        const isOwnMessage = messageData.username === this.username;
        messageElement.className = `message ${isOwnMessage ? 'mine' : 'other'}`;
        
        const timestamp = new Date(messageData.timestamp).toLocaleTimeString();
        const textHtml = this.escapeHtml(messageData.message || '');
        const img = messageData.imageUrl ? `<div class="message-image"><a href="${messageData.imageUrl}" target="_blank" rel="noopener"><img src="${messageData.imageUrl}" alt="image" style="max-width:320px;border-radius:8px;display:block;margin-top:6px"></a></div>` : '';
        const replyPreview = (messageData.replyToUsername && messageData.replyToSnippet) ? `<div style="border-left:3px solid #5865f2;padding:6px 8px;margin-bottom:6px;background:#2f3136;border-radius:4px;">
            <span style="color:#8e9297;">${this.t('reply_to_label')} ${this.escapeHtml(messageData.replyToUsername)}:</span>
            <div style="color:#b9bbbe;">${this.escapeHtml(messageData.replyToSnippet)}</div>
        </div>` : '';
        
        const avatar = messageData.avatarUrl ? `<img class="avatar" src="${messageData.avatarUrl}" alt="">` : '';
        const usernameClass = messageData.role === 'admin' ? 'username admin' : 'username';
        const snippet = (messageData.message && messageData.message.trim()) ? messageData.message.trim() : (messageData.imageUrl ? this.t('photo_label', 'Photo') : '');
        const shortSnippet = (snippet || '').slice(0, 80);
        
        // Check if we're in phone mode
        const isPhoneMode = this.isPhoneMode();
        
        if (isPhoneMode && !isOwnMessage) {
            // Show header for other people's messages in phone mode
            messageElement.innerHTML = `
                <div class="message-header">
                    ${avatar}
                    <span class="${usernameClass}">${messageData.username}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="message-content" style="position:relative;">
                    ${replyPreview}${textHtml}${img}
                    <button class="reply-btn" title="${this.t('reply')}" data-id="${messageData.id}" data-username="${messageData.username}" data-snippet="${this.escapeHtml(shortSnippet)}" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);border:none;color:white;padding:4px 6px;border-radius:12px;font-size:12px;">↩</button>
                </div>
            `;
            
        } else if (isPhoneMode && isOwnMessage) {
            // Show edit button for own messages in phone mode
            messageElement.innerHTML = `
                <div class="message-content" style="position:relative;">
                    ${replyPreview}${textHtml}${img}
                    <button class="edit-btn" title="${this.t('edit', 'Редактировать')}" data-id="${messageData.id}" data-message="${this.escapeHtml(messageData.message || '')}" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);border:none;color:white;padding:4px 6px;border-radius:12px;font-size:12px;">✏️</button>
                </div>
            `;
        } else {
            // Desktop mode - show full header with reply and edit buttons
            const isOwnMsg = messageData.username === this.username;
            const editBtn = isOwnMsg ? `<button class="edit-btn" title="${this.t('edit', 'Редактировать')}" data-id="${messageData.id}" data-message="${this.escapeHtml(messageData.message || '')}" style="background:none;border:none;color:#b9bbbe;cursor:pointer;margin-right:4px;">✏️</button>` : '';
            messageElement.innerHTML = `
                <div class="message-header">
                    ${avatar}
                    <span class="${usernameClass}">${messageData.username}</span>
                    <span class="timestamp">${timestamp}</span>
                    <div style="margin-left:auto;">
                        ${editBtn}
                        <button class="reply-btn" title="${this.t('reply')}" data-id="${messageData.id}" data-username="${messageData.username}" data-snippet="${this.escapeHtml(shortSnippet)}" style="background:none;border:none;color:#b9bbbe;cursor:pointer;">↩</button>
                    </div>
                </div>
                <div class="message-content">${replyPreview}${textHtml}${(messageData.edited ? ` <span style="color:#72767d;font-size:12px;">(${this.t('edited', 'изменено')})</span>` : '')}${img}</div>
            `;
        }
        
        messageElement.dataset.messageId = messageData.id;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    t(key, fallback = '') {
        const dict = this.i18n[this.lang] || {};
        return (key in dict) ? dict[key] : (fallback || key);
    }

    applyI18n() {
        try {
            // Server name
            const serverName = document.querySelector('.server-info span');
            if (serverName) serverName.textContent = this.t('server_name', serverName.textContent);

            const setTitle = (id, key) => { const el = document.getElementById(id); if (el) el.title = this.t(key, el.title); };
            const setText = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = this.t(key, el.textContent); };
            const setPlaceholder = (id, key) => { const el = document.getElementById(id); if (el) el.placeholder = this.t(key, el.placeholder); };

            // Buttons and titles
            setTitle('inviteLinkBtn', 'copy_invite_title');
            setTitle('logoutBtn', 'logout_title');
            setTitle('mobileMenuBtn', 'menu_title');
            setTitle('voiceCallBtn', 'voice_call_title');
            setTitle('videoCallBtn', 'video_call_title');

            // Add language toggle button dynamically
            const logoutBtn = document.getElementById('logoutBtn');
            const btnBar = logoutBtn ? logoutBtn.parentElement : null;
            if (btnBar && !document.getElementById('langToggleBtn')) {
                const btn = document.createElement('button');
                btn.id = 'langToggleBtn';
                btn.className = 'add-group-btn';
                btn.title = this.t('language_title');
                btn.textContent = '🌐';
                btn.addEventListener('click', () => {
                    this.lang = this.lang === 'en' ? 'ru' : 'en';
                    localStorage.setItem('lang', this.lang);
                    this.applyI18n();
                    if (this._setAuthModeTexts) { try { this._setAuthModeTexts(); } catch {} }
                });
                btnBar.appendChild(btn);
            } else {
                const langBtn = document.getElementById('langToggleBtn');
                if (langBtn) langBtn.title = this.t('language_title');
            }

            // Section titles
            const groupsTitle = document.querySelector('.groups-title span');
            if (groupsTitle) groupsTitle.textContent = this.t('groups_title', groupsTitle.textContent);
            const userTitles = document.querySelectorAll('.users-section .users-title');
            if (userTitles[0]) userTitles[0].textContent = this.t('online_users', userTitles[0].textContent);
            if (userTitles[1]) userTitles[1].textContent = this.t('direct_messages_title', userTitles[1].textContent);

            // Chat input
            setPlaceholder('messageInput', 'message_placeholder');
            setText('sendBtn', 'send_button');

            // Auth placeholders (buttons handled by applyMode)
            setPlaceholder('usernameInput', 'auth_username_placeholder');
            setPlaceholder('passwordInput', 'auth_password_placeholder');

            // Call modal defaults
            setText('acceptCall', 'call_accept');
            setText('declineCall', 'call_decline');
            setText('endCall', 'call_end');
            const callStatus = document.getElementById('callStatus');
            if (callStatus) callStatus.textContent = this.t('call_connecting', callStatus.textContent);
        } catch {}
    }
    
    // Call functionality
    initiateCall(callType) {
        if (this.isInCall) {
            alert(this.t('already_in_call'));
            return;
        }
        
        // For simplicity, we'll call the first available user
        const usersList = document.getElementById('usersList');
        const firstUser = usersList.querySelector('.user-item');
        
        if (!firstUser) {
            alert(this.t('no_users_available'));
            return;
        }
        
        // In a real app, you'd have a way to select which user to call
        // For now, we'll just use a prompt
        const targetUsername = prompt(this.t('enter_username_call'));
        if (!targetUsername) return;
        
        this.socket.emit('initiate-call', {
            targetUserId: targetUsername,
            callType: callType
        });
        
        this.showCallModal(`${this.t('calling_prefix')} ${targetUsername}...`);
        this.updateCallModalButtons('calling');
        this.ensureAudio();
        this.startOutgoingRing();
    }
    
    handleIncomingCall(data) {
        const { callerName, callType, callId } = data;
        this.currentCallerId = data.callerId;
        this.currentCallId = callId;
        
        const callTypeText = callType === 'video' ? this.t('video') : this.t('voice');
        document.getElementById('callerName').textContent = `${callerName} ${this.t('is_calling_you')}`;
        document.getElementById('callStatus').textContent = `${this.t('incoming')} ${callTypeText} ${this.t('call')}`;
        this.showCallModal();
        this.updateCallModalButtons('incoming');
        this.startIncomingRingtone();
    }
    
    acceptCall() {
        if (this.currentCallId) {
            this.socket.emit('call-response', {
                callId: this.currentCallId,
                accepted: true
            });
            
            document.getElementById('callStatus').textContent = this.t('call_connecting');
            this.updateCallModalButtons('connecting');
            this.stopRing();
        }
    }
    
    declineCall() {
        if (this.currentCallId) {
            this.socket.emit('call-response', {
                callId: this.currentCallId,
                accepted: false
            });
            
            this.stopRing();
            this.hideCallModal();
            this.currentCallId = null;
            this.currentCallerId = null;
        }
    }
    
    endCall() {
        if (this.currentCallId) {
            this.socket.emit('end-call', this.currentCallId);
        }
        
        this.handleCallEnded();
    }
    
    handleCallStarted(data) {
        this.isInCall = true;
        this.currentCallId = data.callId;
        
        document.getElementById('callStatus').textContent = this.t('call_in_progress');
        this.updateCallModalButtons('active');
        this.stopRing();
        
        // Initialize WebRTC
        this.initializeWebRTC();
    }
    
    handleCallDeclined() {
        this.stopRing();
        document.getElementById('callStatus').textContent = this.t('call_declined');
        setTimeout(() => {
            this.hideCallModal();
        }, 2000);
        
        this.currentCallId = null;
        this.currentCallerId = null;
    }
    
    handleCallEnded() {
        this.stopRing();
        this.isInCall = false;
        this.currentCallId = null;
        this.currentCallerId = null;
        
        this.hideCallModal();
        this.cleanupWebRTC();
        
        // Hide video container
        document.getElementById('videoContainer').style.display = 'none';
    }
    
    updateCallModalButtons(state) {
        const acceptBtn = document.getElementById('acceptCall');
        const declineBtn = document.getElementById('declineCall');
        const endBtn = document.getElementById('endCall');
        
        // Hide all buttons first
        acceptBtn.style.display = 'none';
        declineBtn.style.display = 'none';
        endBtn.style.display = 'none';
        
        switch (state) {
            case 'incoming':
                acceptBtn.style.display = 'inline-block';
                declineBtn.style.display = 'inline-block';
                break;
            case 'calling':
            case 'connecting':
            case 'active':
                endBtn.style.display = 'inline-block';
                break;
        }
    }
    
    // WebRTC functionality
    async initializeWebRTC() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // Display local video
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
            
            // Show video container
            document.getElementById('videoContainer').style.display = 'block';
            
            // Create peer connection
            this.peerConnection = new RTCPeerConnection(this.rtcConfig);
            
            // Add local stream to peer connection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                const remoteVideo = document.getElementById('remoteVideo');
                remoteVideo.srcObject = event.streams[0];
            };
            
            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('webrtc-ice-candidate', {
                        candidate: event.candidate,
                        targetId: this.currentCallerId || this.getTargetId()
                    });
                }
            };
            
            // Create and send offer if we're the caller
            if (!this.currentCallerId) {
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                this.socket.emit('webrtc-offer', {
                    offer: offer,
                    targetId: this.getTargetId()
                });
            }
            
        } catch (error) {
            console.error('Error initializing WebRTC:', error);
            alert(this.t('could_not_access_media'));
        }
    }
    
    async handleWebRTCOffer(data) {
        try {
            if (!this.peerConnection) {
                await this.initializeWebRTC();
            }
            
            await this.peerConnection.setRemoteDescription(data.offer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                answer: answer,
                targetId: data.senderId
            });
            
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
        }
    }
    
    async handleWebRTCAnswer(data) {
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
        } catch (error) {
            console.error('Error handling WebRTC answer:', error);
        }
    }
    
    async handleWebRTCIceCandidate(data) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(data.candidate);
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }
    
    getTargetId() {
        // In a real app, you'd properly track the target user ID
        // For now, we'll use a simple approach
        const usersList = document.getElementById('usersList');
        const firstUser = usersList.querySelector('.user-item');
        return firstUser ? firstUser.dataset.userId : null;
    }

    // Parse invite room from URL: /invite/:room
    getInviteRoomFromUrl() {
        const path = window.location.pathname || '';
        const m = path.match(/^\/invite\/([^\/]+)$/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async logout() {
        // End call if any
        if (this.isInCall && this.currentCallId) {
            try { this.socket?.emit('end-call', this.currentCallId); } catch {}
        }
        this.cleanupWebRTC();

        // Server-side logout to clear cookie
        try { await fetch('/api/logout', { method: 'POST' }); } catch {}
        // Disconnect socket
        try { this.socket?.disconnect(); } catch {}
        this.socket = null;

        // Reset state
        this.username = '';
        this.currentRoom = this.getInviteRoomFromUrl() || 'general';
        this.groups = [];
        this.isInCall = false;
        this.currentCallId = null;
        this.currentCallerId = null;
        this.clearMessages();
        const usersListEl = document.getElementById('usersList');
        if (usersListEl) usersListEl.innerHTML = '';
        const groupsListEl = document.getElementById('groupsList');
        if (groupsListEl) groupsListEl.innerHTML = '';
        const channelName = document.getElementById('channelName');
        if (channelName) channelName.textContent = `# ${this.currentRoom}`;

        // Show login modal
        const authError = document.getElementById('authError');
        if (authError) { authError.style.display = 'none'; authError.textContent = ''; }
        document.getElementById('loginModal').style.display = 'flex';
    }
    
    cleanupWebRTC() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Clear video elements
        const localVideo = document.getElementById('localVideo');
        const remoteVideo = document.getElementById('remoteVideo');
        
        if (localVideo.srcObject) {
            localVideo.srcObject = null;
        }
        
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject = null;
        }
    }

    async sendPhoto(file) {
        try {
            if (this.inDM) {
                alert('Image upload in Direct Messages is not available yet.');
                return;
            }
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('roomId', this.currentRoom);
            if (this.replyContext) {
                fd.append('replyToId', this.replyContext.id || '');
                fd.append('replyToUsername', this.replyContext.username || '');
                fd.append('replyToSnippet', this.replyContext.snippet || '');
            }
            const res = await fetch('/api/upload/photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Upload failed');
            }
            this.clearReplyContext();
            // server will broadcast the message to the room
        } catch (e) {
            alert('Image upload failed: ' + e.message);
        }
    }

    // --- DM helpers ---
    openDM(username) {
        if (!username || username === this.username) return;
        this.inDM = true;
        this.dmWith = username;
        const channelName = document.getElementById('channelName');
        if (channelName) channelName.textContent = `@ ${username}`;
        this.clearMessages();
        this.dmPartners.add(username);
        this.updateDMsList();
        if (this.socket) {
            this.socket.emit('get-private-history', { with: username });
        }
    }

    handlePrivateMessage(messageData) {
        const other = messageData.username === this.username ? messageData.to : messageData.username;
        if (other) {
            this.dmPartners.add(other);
            this.updateDMsList();
        }
        if (this.inDM && this.dmWith && (messageData.username === this.dmWith || messageData.to === this.dmWith || messageData.username === this.username)) {
            this.displayPrivateMessage(messageData);
        }
    }

    updateDMsList() {
        const dmsList = document.getElementById('dmsList');
        if (!dmsList) return;
        const arr = Array.from(this.dmPartners.values()).sort((a,b)=> a.localeCompare(b));
        dmsList.innerHTML = '';
        for (const u of arr) {
            const div = document.createElement('div');
            div.className = 'user-item dm-item';
            div.dataset.username = u;
            div.innerHTML = `<span>@ ${this.escapeHtml(u)}</span>`;
            dmsList.appendChild(div);
        }
    }

    displayPrivateMessage(messageData) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        const timestamp = new Date(messageData.timestamp).toLocaleTimeString();
        const textHtml = this.escapeHtml(messageData.message || '');
        const replyPreview = (messageData.replyToUsername && messageData.replyToSnippet) ? `<div style="border-left:3px solid #5865f2;padding:6px 8px;margin-bottom:6px;background:#2f3136;border-radius:4px;">
            <span style=\"color:#8e9297;\">${this.t('reply_to_label')} ${this.escapeHtml(messageData.replyToUsername)}:</span>
            <div style=\"color:#b9bbbe;\">${this.escapeHtml(messageData.replyToSnippet)}</div>
        </div>` : '';
        const avatar = messageData.avatarUrl ? `<img class=\"avatar\" src=\"${messageData.avatarUrl}\" alt=\"\">` : '';
        const usernameClass = messageData.role === 'admin' ? 'username admin' : 'username';
        const snippet = (messageData.message && messageData.message.trim()) ? messageData.message.trim() : '';
        const shortSnippet = (snippet || '').slice(0, 80);
        const isOwnMsg = messageData.username === this.username;
        const editBtn = isOwnMsg ? `<button class=\"edit-btn\" title=\"${this.t('edit', 'Редактировать')}\" data-id=\"${messageData.id}\" data-message=\"${this.escapeHtml(messageData.message || '')}\" style=\"background:none;border:none;color:#b9bbbe;cursor:pointer;margin-right:4px;\">✏️</button>` : '';
        messageElement.innerHTML = `
            <div class=\"message-header\">
                ${avatar}
                <span class=\"${usernameClass}\">${messageData.username}</span>
                <span class=\"timestamp\">${timestamp}</span>
                <div style=\"margin-left:auto;\">
                    ${editBtn}
                    <button class=\"reply-btn\" title=\"${this.t('reply')}\" data-id=\"${messageData.id}\" data-username=\"${messageData.username}\" data-snippet=\"${this.escapeHtml(shortSnippet)}\" style=\"background:none;border:none;color:#b9bbbe;cursor:pointer;\">↩</button>
                </div>
            </div>
            <div class=\"message-content\">${replyPreview}${textHtml}${(messageData.edited ? ` <span style=\"color:#72767d;font-size:12px;\">(${this.t('edited', 'изменено')})</span>` : '')}</div>
        `;
        messageElement.dataset.messageId = messageData.id;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    setReplyContext({ id, username, snippet }) {
        this.replyContext = { id, username, snippet };
        const replyBar = document.getElementById('replyBar');
        const replyText = document.getElementById('replyText');
        if (replyBar && replyText) {
            replyText.textContent = `${this.t('replying_to_label')} ${username}: ${snippet}`;
            replyBar.style.display = 'block';
        }
    }

    clearReplyContext() {
        this.replyContext = null;
        const replyBar = document.getElementById('replyBar');
        const replyText = document.getElementById('replyText');
        if (replyBar && replyText) {
            replyText.textContent = '';
            replyBar.style.display = 'none';
        }
    }
    
    startEditMessage(messageId, currentMessage) {
        this.editContext = { id: messageId, originalMessage: currentMessage };
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const editBar = document.getElementById('editBar');
        const editText = document.getElementById('editText');
        
        if (messageInput) messageInput.value = currentMessage;
        if (sendBtn) sendBtn.textContent = this.t('save_button', 'Сохранить');
        if (editBar && editText) {
            editText.textContent = this.t('editing_message', 'Редактирование сообщения');
            editBar.style.display = 'block';
        }
        
        // Простой скролл на мобильных
        if (messageInput) {
            messageInput.focus();
            setTimeout(() => {
                window.scrollTo(0, document.body.scrollHeight);
            }, 200);
        }
    }
    
    cancelEditMessage() {
        this.editContext = null;
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const editBar = document.getElementById('editBar');
        
        if (messageInput) messageInput.value = '';
        if (sendBtn) sendBtn.textContent = this.t('send_button');
        if (editBar) editBar.style.display = 'none';
    }
    
    saveEditedMessage(newMessage) {
        if (!this.editContext || !newMessage.trim()) return;
        
        if (this.inDM && this.dmWith) {
            this.socket.emit('edit-private-message', {
                messageId: this.editContext.id,
                newMessage: newMessage,
                otherUser: this.dmWith
            });
        } else {
            this.socket.emit('edit-message', {
                messageId: this.editContext.id,
                newMessage: newMessage,
                roomId: this.currentRoom
            });
        }
        
        this.cancelEditMessage();
    }
    
    handleMessageEdited(data) {
        const messageElements = document.querySelectorAll('.message');
        messageElements.forEach(el => {
            const messageId = el.dataset.messageId;
            if (messageId == data.messageId) {
                const contentEl = el.querySelector('.message-content');
                if (contentEl) {
                    const textPart = contentEl.innerHTML.replace(/<div class="message-image">.*?<\/div>/s, '');
                    const imagePart = contentEl.innerHTML.match(/<div class="message-image">.*?<\/div>/s)?.[0] || '';
                    const replyPart = textPart.match(/^<div style="border-left:3px solid #5865f2;.*?<\/div>/s)?.[0] || '';
                    const cleanText = textPart.replace(/^<div style="border-left:3px solid #5865f2;.*?<\/div>/s, '');
                    
                    contentEl.innerHTML = replyPart + this.escapeHtml(data.newMessage) + 
                        (data.edited ? ` <span style="color:#72767d;font-size:12px;">(${this.t('edited', 'изменено')})</span>` : '') + 
                        imagePart;
                }
            }
        });
    }
    
    handlePrivateMessageEdited(data) {
        if (this.inDM && this.dmWith && (this.dmWith === data.otherUser || this.username === data.otherUser)) {
            this.handleMessageEdited(data);
        }
    }

    // --- Audio / Ringtone helpers ---
    ensureAudio() {
        if (!this._audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return; // unsupported
            this._audioCtx = new Ctx();
            this._ringGain = this._audioCtx.createGain();
            this._ringGain.gain.value = 0.0;
            this._ringGain.connect(this._audioCtx.destination);
            this._osc = this._audioCtx.createOscillator();
            this._osc.type = 'sine';
            this._osc.frequency.value = 440; // A4
            this._osc.connect(this._ringGain);
            try { this._osc.start(); } catch {}
        }
        // Try resume if suspended
        if (this._audioCtx && this._audioCtx.state === 'suspended') {
            try { this._audioCtx.resume(); } catch {}
        }
    }

    startOutgoingRing() {
        this.stopRing();
        if (!this._audioCtx) this.ensureAudio();
        if (!this._audioCtx) return;
        // Double-beep pattern: 200ms on, 200ms off, 200ms on, 1600ms off (2.2s)
        this._ringMode = 'outgoing';
        this._ringStep = 0; // 100ms ticks
        this._ringInterval = setInterval(() => {
            this._ringStep = (this._ringStep + 1) % 22;
            const s = this._ringStep;
            const on = (s < 2) || (s >= 4 && s < 6);
            this._ringGain.gain.value = on ? 0.15 : 0.0;
        }, 100);
    }
    
    startIncomingRing() {
    this.stopRing();
    if (!this._audioCtx) this.ensureAudio();
    if (!this._audioCtx) return;
    // Ring pattern: 800ms on, 1200ms off (2s cycle)
    this._ringMode = 'incoming';
    this._ringStep = 0; // 100ms ticks
    this._ringInterval = setInterval(() => {
    this._ringStep = (this._ringStep + 1) % 20;
    const on = this._ringStep < 8;
    this._ringGain.gain.value = on ? 0.15 : 0.0;
    }, 100);
    }
    
    startIncomingRingtone() {
    // Try to play ringtone.mp3 loop; fallback to oscillator ring if blocked
    try {
    if (!this._ringAudio) {
    this._ringAudio = new Audio('/ringtone.mp3');
    this._ringAudio.loop = true;
    this._ringAudio.preload = 'auto';
    this._ringAudio.volume = 0.5; // adjust as needed
    }
    this.stopRing();
    const p = this._ringAudio.play();
    if (p && typeof p.then === 'function') {
    p.catch(() => {
    // Autoplay blocked; fallback
    this.ensureAudio();
    this.startIncomingRing();
    });
    }
    } catch (e) {
    // Fallback to oscillator ring
    this.ensureAudio();
    this.startIncomingRing();
    }
    }
    
    stopRing() {
        if (this._ringInterval) {
            clearInterval(this._ringInterval);
            this._ringInterval = null;
        }
        if (this._ringAudio) {
            try { this._ringAudio.pause(); this._ringAudio.currentTime = 0; } catch {}
        }
        if (this._ringGain) this._ringGain.gain.value = 0.0;
        this._ringMode = null;
    }

    // Phone mode detection
    isPhoneMode() {
        // Check if we're on a touch device with small screen
        return window.innerWidth <= 768 && 
               ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               !window.matchMedia('(hover: hover)').matches;
    }
    
    // Show notification
    showNotification(title, body) {
        // Android WebView
        if (typeof AndroidNotification !== 'undefined') {
            AndroidNotification.showNotification(title, body);
        }
        // Browser
        else if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: '/favicon.ico',
                tag: 'message',
                requireInteraction: false
            });
        }
    }
}