/* ==========================================================================
   IlmCore AI — dashboard.js
   Chat interface logic: session/auth bootstrap, sidebar behavior, real
   fetch() calls to the Flask backend for chat + session history, markdown
   rendering with syntax-highlighted code blocks, a simulated token-stream
   reveal for assistant replies, and all message-level interactions.
   ========================================================================== */

/* ------------------------------------------------------------------ *
 *  AUTH GUARD — bounce back to login if no session token is stored.
 *  (Comment this block out during local frontend-only testing if you
 *   want to explore the dashboard without a running backend.)
 * ------------------------------------------------------------------ */
(function authGuard() {
  const token = localStorage.getItem('ilmcore_token');
  if (!token) {
    window.location.href = 'login.html';
  }
})();

/* ------------------------------------------------------------------ *
 *  STATE
 * ------------------------------------------------------------------ */
const state = {
  sessionId: localStorage.getItem('ilmcore_session_id') || null,
  sessions: [],
  isSending: false,
};

const el = {
  appShell: document.getElementById('app-shell'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  mobileSidebarBtn: document.getElementById('mobile-sidebar-btn'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  newChatBtn: document.getElementById('new-chat-btn'),
  searchChats: document.getElementById('search-chats'),
  sidebarHistory: document.getElementById('sidebar-history'),
  logoutBtn: document.getElementById('logout-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  profileAvatar: document.getElementById('profile-avatar'),
  profileName: document.getElementById('profile-name'),
  profileEmail: document.getElementById('profile-email'),
  chatScroll: document.getElementById('chat-scroll'),
  chatInner: document.getElementById('chat-inner'),
  welcomeScreen: document.getElementById('welcome-screen'),
  currentChatTitle: document.getElementById('current-chat-title'),
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  voiceBtn: document.getElementById('voice-btn'),
  attachBtn: document.getElementById('attach-btn'),
};

/* ------------------------------------------------------------------ *
 *  USER PROFILE (rendered from what was stored at login/register/google)
 * ------------------------------------------------------------------ */
function renderProfile() {
  let user = null;
  try { user = JSON.parse(localStorage.getItem('ilmcore_user') || 'null'); } catch (_) {}
  if (user) {
    el.profileName.textContent = user.name || 'Signed in';
    el.profileEmail.textContent = user.email || '';
    if (user.picture) el.profileAvatar.src = user.picture;
  }
}
renderProfile();

/* ------------------------------------------------------------------ *
 *  SIDEBAR: collapse / expand + mobile overlay behavior
 * ------------------------------------------------------------------ */
function isMobile() { return window.innerWidth <= 900; }

function setSidebarCollapsed(collapsed) {
  el.appShell.classList.toggle('collapsed', collapsed);
  localStorage.setItem('ilmcore_sidebar_collapsed', collapsed ? '1' : '0');
}

(function initSidebarState() {
  if (isMobile()) {
    setSidebarCollapsed(true); // hidden by default on mobile
    el.mobileSidebarBtn.style.display = 'flex';
  } else {
    setSidebarCollapsed(localStorage.getItem('ilmcore_sidebar_collapsed') === '1');
  }
})();

el.sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!el.appShell.classList.contains('collapsed'));
});
el.mobileSidebarBtn.addEventListener('click', () => setSidebarCollapsed(false));
el.sidebarBackdrop.addEventListener('click', () => setSidebarCollapsed(true));

window.addEventListener('resize', () => {
  el.mobileSidebarBtn.style.display = isMobile() ? 'flex' : 'none';
});

/* ------------------------------------------------------------------ *
 *  BACKEND HEALTH CHECK
 * ------------------------------------------------------------------ */
async function checkHealth() {
  try {
    await IlmAPI.health();
    el.statusPill.classList.remove('offline');
    el.statusText.textContent = 'Online';
  } catch (_) {
    el.statusPill.classList.add('offline');
    el.statusText.textContent = 'Backend offline';
  }
}
checkHealth();
setInterval(checkHealth, 30000);

/* ------------------------------------------------------------------ *
 *  SESSIONS (chat history list)
 * ------------------------------------------------------------------ */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderSessions(filter = '') {
  const list = state.sessions.filter(s =>
    !filter || (s.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  if (list.length === 0) {
    el.sidebarHistory.innerHTML = `<div class="sidebar-empty">${filter ? 'No matching chats' : 'No conversations yet'}</div>`;
    return;
  }

  el.sidebarHistory.innerHTML = '';
  list.forEach(s => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (s.id === state.sessionId ? ' active' : '');
    item.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="chat-title label-fade">${escapeHtml(s.title || 'Untitled chat')}</span>
      <button class="chat-delete label-fade" title="Delete chat" data-id="${s.id}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-delete')) return;
      loadSession(s.id);
    });
    item.querySelector('.chat-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSessionById(s.id);
    });
    el.sidebarHistory.appendChild(item);
  });
}

async function loadSessionsList() {
  try {
    const data = await IlmAPI.getSessions();
    state.sessions = (data && (data.sessions || data)) || [];
    renderSessions(el.searchChats.value.trim());
  } catch (err) {
    // Backend may not be reachable yet — fail quietly, sidebar shows empty state.
  }
}
loadSessionsList();

el.searchChats.addEventListener('input', () => renderSessions(el.searchChats.value.trim()));

async function deleteSessionById(id) {
  try {
    await IlmAPI.deleteSession(id);
    state.sessions = state.sessions.filter(s => s.id !== id);
    renderSessions(el.searchChats.value.trim());
    if (state.sessionId === id) startNewChat();
    showToast('Chat deleted', 'success', 1800);
  } catch (err) {
    showToast(err.message || 'Could not delete chat', 'error');
  }
}

async function loadSession(id) {
  state.sessionId = id;
  localStorage.setItem('ilmcore_session_id', id);
  renderSessions(el.searchChats.value.trim());
  clearChat(false);

  try {
    const data = await IlmAPI.getMessages(id);
    const messages = (data && (data.messages || data)) || [];
    if (messages.length === 0) {
      showWelcome();
      return;
    }
    hideWelcome();
    messages.forEach(m => {
      const role = m.role || (m.is_user ? 'user' : 'assistant');
      appendMessage(role, m.content || m.message || m.reply || '', m.created_at || m.timestamp, false);
    });
    scrollToBottom();
    const active = state.sessions.find(s => s.id === id);
    el.currentChatTitle.textContent = (active && active.title) || 'Conversation';
  } catch (err) {
    showToast(err.message || 'Could not load conversation', 'error');
  }
}

/* ------------------------------------------------------------------ *
 *  NEW CHAT
 * ------------------------------------------------------------------ */
function startNewChat() {
  state.sessionId = null;
  localStorage.removeItem('ilmcore_session_id');
  el.currentChatTitle.textContent = 'New conversation';
  clearChat(true);
  renderSessions(el.searchChats.value.trim());
  if (isMobile()) setSidebarCollapsed(true);
}
el.newChatBtn.addEventListener('click', startNewChat);

function clearChat(showWelcomeScreen) {
  el.chatInner.querySelectorAll('.msg-row').forEach(n => n.remove());
  if (showWelcomeScreen) showWelcome(); else hideWelcome();
}
function showWelcome() { el.welcomeScreen.style.display = 'flex'; }
function hideWelcome() { el.welcomeScreen.style.display = 'none'; }

document.querySelectorAll('.suggested-prompt').forEach(btn => {
  btn.addEventListener('click', () => {
    el.chatInput.value = btn.dataset.prompt;
    autoresizeInput();
    sendMessage();
  });
});

/* ------------------------------------------------------------------ *
 *  MARKDOWN + SYNTAX HIGHLIGHTING (lightweight, dependency-free)
 * ------------------------------------------------------------------ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function highlightCode(code) {
  let escaped = escapeHtml(code);
  // strings
  escaped = escaped.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)/g, '<span class="tok-str">$1</span>');
  // comments (// ... and # ...)
  escaped = escaped.replace(/(^|\n)(\s*)(\/\/.*|#(?!include|define).*)/g, '$1$2<span class="tok-com">$3</span>');
  // numbers
  escaped = escaped.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  // keywords
  const kw = /\b(function|const|let|var|return|if|else|for|while|import|from|export|class|def|elif|try|except|catch|finally|new|async|await|public|static|void|int|float|double|string|bool|true|false|null|None|True|False|self|this|print|console|switch|case|break|continue|struct|interface|implements|extends)\b/g;
  escaped = escaped.replace(kw, '<span class="tok-kw">$1</span>');
  // function calls
  escaped = escaped.replace(/\b([a-zA-Z_]\w*)(?=\()/g, '<span class="tok-fn">$1</span>');
  return escaped;
}

function renderMarkdown(text) {
  if (!text) return '';
  // Extract fenced code blocks first so they aren't mangled by other rules
  const blocks = [];
  let src = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang: (lang || 'text').trim(), code: code.replace(/\n$/, '') });
    return `\u0000CODEBLOCK${blocks.length - 1}\u0000`;
  });

  src = escapeHtml(src);

  // headers
  src = src.replace(/^### (.*)$/gm, '<h4>$1</h4>');
  src = src.replace(/^## (.*)$/gm, '<h3>$1</h3>');
  src = src.replace(/^# (.*)$/gm, '<h2>$1</h2>');
  // bold / italic
  src = src.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  src = src.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');
  // inline code
  src = src.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // links
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // blockquote
  src = src.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  // unordered lists
  src = src.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m) => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('');
    return `\n<ul>${items}</ul>\n`;
  });
  // ordered lists
  src = src.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (m) => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`).join('');
    return `\n<ol>${items}</ol>\n`;
  });
  // paragraphs (double newline separated), skip lines already turned into block tags
  src = src.split(/\n{2,}/).map(chunk => {
    if (/^<(h2|h3|h4|ul|ol|blockquote)/.test(chunk.trim())) return chunk;
    if (/\u0000CODEBLOCK\d+\u0000/.test(chunk.trim())) return chunk;
    const withBreaks = chunk.trim().replace(/\n/g, '<br>');
    return withBreaks ? `<p>${withBreaks}</p>` : '';
  }).join('\n');

  // re-insert code blocks
  src = src.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, i) => {
    const b = blocks[Number(i)];
    const highlighted = highlightCode(b.code);
    return `<div class="code-block">
      <div class="code-block-header">
        <span>${escapeHtml(b.lang)}</span>
        <button class="code-copy-btn" data-code="${encodeURIComponent(b.code)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy
        </button>
      </div>
      <pre>${highlighted}</pre>
    </div>`;
  });

  return src;
}

/* ------------------------------------------------------------------ *
 *  MESSAGE RENDERING
 * ------------------------------------------------------------------ */
function formatTimestamp(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(smooth = true) {
  el.chatScroll.scrollTo({ top: el.chatScroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function appendMessage(role, content, timestamp, animate = true) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const avatarSrc = role === 'user' ? 'assets/user.png' : 'assets/ai.png';
  row.innerHTML = `
    <img class="msg-avatar" src="${avatarSrc}" alt="${role}" />
    <div class="msg-body">
      <div class="msg-bubble">${renderMarkdown(content)}</div>
      <div class="msg-meta">
        <span>${formatTimestamp(timestamp)}</span>
        ${role === 'assistant' ? `
        <div class="msg-actions">
          <button class="msg-action-btn action-copy" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="msg-action-btn action-regenerate" title="Regenerate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="msg-action-btn action-like" title="Good response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>
          </button>
          <button class="msg-action-btn action-dislike" title="Bad response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg>
          </button>
        </div>` : ''}
      </div>
    </div>
  `;
  el.chatInner.appendChild(row);
  wireMessageActions(row, content);
  scrollToBottom();
  return row;
}

function wireMessageActions(row, rawContent) {
  const copyBtn = row.querySelector('.action-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(rawContent).then(() => showToast('Copied to clipboard', 'success', 1500));
    });
  }
  const regenBtn = row.querySelector('.action-regenerate');
  if (regenBtn) regenBtn.addEventListener('click', () => regenerateFrom(row));

  const likeBtn = row.querySelector('.action-like');
  const dislikeBtn = row.querySelector('.action-dislike');
  if (likeBtn) likeBtn.addEventListener('click', () => {
    likeBtn.classList.toggle('liked');
    dislikeBtn.classList.remove('disliked');
  });
  if (dislikeBtn) dislikeBtn.addEventListener('click', () => {
    dislikeBtn.classList.toggle('disliked');
    likeBtn.classList.remove('liked');
  });

  row.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = decodeURIComponent(btn.dataset.code);
      navigator.clipboard.writeText(code).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = 'Copied!';
        setTimeout(() => { btn.innerHTML = original; }, 1400);
      });
    });
  });
}

function appendTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.id = 'typing-row';
  row.innerHTML = `
    <img class="msg-avatar" src="assets/ai.png" alt="assistant" />
    <div class="msg-body">
      <div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>
    </div>
  `;
  el.chatInner.appendChild(row);
  scrollToBottom();
  return row;
}

/* Simulated streaming reveal: the backend returns the full reply, so we
   progressively render it word-by-word for a premium "typing" feel. */
function streamReplyInto(bubbleEl, fullText, onDone) {
  const words = fullText.split(' ');
  let i = 0;
  bubbleEl.innerHTML = '<span class="streaming-cursor"></span>';
  const interval = setInterval(() => {
    i++;
    const partial = words.slice(0, i).join(' ');
    bubbleEl.innerHTML = renderMarkdown(partial) + '<span class="streaming-cursor"></span>';
    scrollToBottom(false);
    if (i >= words.length) {
      clearInterval(interval);
      bubbleEl.innerHTML = renderMarkdown(fullText);
      if (onDone) onDone();
    }
  }, 28);
}

/* ------------------------------------------------------------------ *
 *  SEND MESSAGE
 * ------------------------------------------------------------------ */
function autoresizeInput() {
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 200) + 'px';
  el.sendBtn.disabled = el.chatInput.value.trim().length === 0 || state.isSending;
}
el.chatInput.addEventListener('input', autoresizeInput);

el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el.sendBtn.addEventListener('click', sendMessage);

let lastUserMessage = '';

async function sendMessage() {
  const text = el.chatInput.value.trim();
  if (!text || state.isSending) return;

  lastUserMessage = text;
  hideWelcome();
  appendMessage('user', text, new Date());
  el.chatInput.value = '';
  autoresizeInput();

  await requestAssistantReply(text);
}

async function requestAssistantReply(text) {
  state.isSending = true;
  el.sendBtn.disabled = true;
  const typingRow = appendTypingIndicator();

  try {
    const data = await IlmAPI.chat(text, state.sessionId);
    const reply = (data && (data.reply || data.message)) || '...';
    if (data && data.session_id) {
      const isNewSession = state.sessionId !== data.session_id;
      state.sessionId = data.session_id;
      localStorage.setItem('ilmcore_session_id', state.sessionId);
      if (isNewSession) {
        el.currentChatTitle.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
        loadSessionsList();
      }
    }

    typingRow.remove();
    const row = appendMessage('assistant', '', new Date());
    const bubble = row.querySelector('.msg-bubble');
    streamReplyInto(bubble, reply, () => {
      state.isSending = false;
      autoresizeInput();
    });
  } catch (err) {
    typingRow.remove();
    appendMessage('assistant', `I couldn't reach the backend: **${escapeHtml(err.message || 'unknown error')}**. Make sure your Flask server is running at \`${IlmAPI.BASE_URL}\`.`, new Date());
    state.isSending = false;
    autoresizeInput();
    showToast('Message failed to send', 'error');
  }
}

function regenerateFrom(row) {
  if (state.isSending || !lastUserMessage) return;
  row.remove();
  requestAssistantReply(lastUserMessage);
}

/* ------------------------------------------------------------------ *
 *  LOGOUT / SETTINGS
 * ------------------------------------------------------------------ */
el.logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('ilmcore_token');
  localStorage.removeItem('ilmcore_user');
  localStorage.removeItem('ilmcore_session_id');
  showToast('Logged out', 'success', 1200);
  setTimeout(() => { window.location.href = 'login.html'; }, 400);
});

el.settingsBtn.addEventListener('click', () => {
  showToast('Settings panel coming soon.', 'success', 2000);
});
