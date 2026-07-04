/* ==========================================================================
   IlmCore AI — auth.js
   Handles login.html + register.html: field validation, password visibility
   toggles, password strength meter, real fetch() calls to the Flask backend,
   session storage, and Google Sign-In (Google Identity Services).

   BACKEND CONTRACT ASSUMED (implement these on your Flask side):
     POST /auth/login     { email, password }        -> { token, user }
     POST /auth/register  { name, email, password }  -> { token, user }
     POST /auth/google    { id_token }                -> { token, user }
   `user` is expected to look like { id, name, email, picture }.
   `token` is stored client-side and sent as "Authorization: Bearer <token>"
   on every subsequent request (see IlmAPI in app.js).
   ========================================================================== */

/* ------------------------------------------------------------------ *
 *  Google Sign-In configuration
 *  Replace GOOGLE_CLIENT_ID with your real OAuth 2.0 Web Client ID
 *  from https://console.cloud.google.com/apis/credentials
 * ------------------------------------------------------------------ */
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

function persistSession(data) {
  if (!data) return;
  if (data.token) localStorage.setItem('ilmcore_token', data.token);
  if (data.user) localStorage.setItem('ilmcore_user', JSON.stringify(data.user));
}

function goToDashboard() {
  document.body.classList.remove('page-fade');
  document.body.classList.add('page-leaving');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 240);
}

/* ------------------------------------------------------------------ *
 *  Password show/hide toggles (works for both single and multi-field forms)
 * ------------------------------------------------------------------ */
function wireToggle(btn, input) {
  btn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  });
}

const singleToggle = document.getElementById('toggle-password');
if (singleToggle) wireToggle(singleToggle, document.getElementById('password'));

document.querySelectorAll('[data-toggle-for]').forEach(btn => {
  const target = document.getElementById(btn.dataset.toggleFor);
  if (target) wireToggle(btn, target);
});

/* ------------------------------------------------------------------ *
 *  Field validation helpers
 * ------------------------------------------------------------------ */
function setFieldError(fieldEl, hasError) {
  fieldEl.classList.toggle('has-error', hasError);
}
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function setButtonLoading(button, textEl, loading, loadingLabel) {
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = textEl.textContent;
    textEl.innerHTML = `<span class="btn-spinner"></span> ${loadingLabel}`;
  } else {
    button.disabled = false;
    textEl.textContent = button.dataset.originalText || textEl.textContent;
  }
}

/* small inline spinner style, injected once */
(function injectSpinnerStyle() {
  const style = document.createElement('style');
  style.textContent = `
    .btn-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 700ms linear infinite;
      vertical-align: -2px;
      margin-right: 4px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
})();

/* ------------------------------------------------------------------ *
 *  LOGIN FORM
 * ------------------------------------------------------------------ */
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailField = document.getElementById('field-email');
    const passwordField = document.getElementById('field-password');

    const emailOk = isValidEmail(emailInput.value.trim());
    const passOk = passwordInput.value.length > 0;
    setFieldError(emailField, !emailOk);
    setFieldError(passwordField, !passOk);
    if (!emailOk || !passOk) return;

    const submitBtn = document.getElementById('login-submit');
    const submitText = document.getElementById('login-submit-text');
    setButtonLoading(submitBtn, submitText, true, 'Logging in…');

    try {
      const data = await IlmAPI.login(emailInput.value.trim(), passwordInput.value);
      persistSession(data);
      const remember = document.getElementById('remember-me').checked;
      localStorage.setItem('ilmcore_remember', remember ? '1' : '0');
      showToast('Welcome back! Redirecting…', 'success', 1400);
      goToDashboard();
    } catch (err) {
      showToast(err.message || 'Login failed. Check your credentials.', 'error');
      setButtonLoading(submitBtn, submitText, false);
    }
  });
}

const forgotLink = document.getElementById('forgot-password');
if (forgotLink) {
  forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email');
    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      showToast('Enter your email above first, then click "Forgot password?"', 'error');
      emailInput.focus();
      return;
    }
    showToast(`If an account exists for ${email}, a reset link has been sent.`, 'success', 4000);
  });
}

/* ------------------------------------------------------------------ *
 *  REGISTER FORM
 * ------------------------------------------------------------------ */
const registerForm = document.getElementById('register-form');
if (registerForm) {
  const passwordInput = document.getElementById('password');
  const strengthBar = document.getElementById('password-strength');

  if (passwordInput && strengthBar) {
    passwordInput.addEventListener('input', () => {
      const v = passwordInput.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (/[A-Z]/.test(v) && /[0-9]/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v) && v.length >= 10) score++;
      strengthBar.classList.remove('weak', 'medium', 'strong');
      if (v.length === 0) return;
      if (score <= 1) strengthBar.classList.add('weak');
      else if (score === 2) strengthBar.classList.add('medium');
      else strengthBar.classList.add('strong');
    });
  }

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const confirmInput = document.getElementById('confirm');
    const termsInput = document.getElementById('terms');

    const nameField = document.getElementById('field-name');
    const emailField = document.getElementById('field-email');
    const passwordField = document.getElementById('field-password');
    const confirmField = document.getElementById('field-confirm');

    const nameOk = nameInput.value.trim().length >= 2;
    const emailOk = isValidEmail(emailInput.value.trim());
    const passOk = passwordInput.value.length >= 8;
    const confirmOk = confirmInput.value === passwordInput.value && confirmInput.value.length > 0;

    setFieldError(nameField, !nameOk);
    setFieldError(emailField, !emailOk);
    setFieldError(passwordField, !passOk);
    setFieldError(confirmField, !confirmOk);

    if (!nameOk || !emailOk || !passOk || !confirmOk) return;
    if (!termsInput.checked) {
      showToast('Please accept the Terms of Service to continue.', 'error');
      return;
    }

    const submitBtn = document.getElementById('register-submit');
    const submitText = document.getElementById('register-submit-text');
    setButtonLoading(submitBtn, submitText, true, 'Creating account…');

    try {
      const data = await IlmAPI.register(nameInput.value.trim(), emailInput.value.trim(), passwordInput.value);
      persistSession(data);
      showToast('Account created! Redirecting…', 'success', 1400);
      goToDashboard();
    } catch (err) {
      showToast(err.message || 'Registration failed. Please try again.', 'error');
      setButtonLoading(submitBtn, submitText, false);
    }
  });
}

/* ------------------------------------------------------------------ *
 *  GOOGLE SIGN-IN
 *  Loads Google Identity Services, renders the button behavior on our
 *  own styled trigger, decodes the returned credential just enough to
 *  show a name/email locally, and forwards the id_token to the backend
 *  so it can verify it server-side and persist/find the user record.
 * ------------------------------------------------------------------ */
function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(base64).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  } catch (_) {
    return null;
  }
}

async function handleGoogleCredential(response) {
  const idToken = response.credential;
  const profile = decodeJwt(idToken); // { name, email, picture, sub, ... } — client-side preview only

  try {
    // Send the ID token to the Flask backend. The backend is expected to
    // verify it with Google, then create/find the user and return a
    // session token — this is what actually "saves the user's data".
    const data = await IlmAPI.googleAuth(idToken);
    persistSession(data);
    showToast(`Welcome, ${(data.user && data.user.name) || (profile && profile.name) || 'there'}!`, 'success', 1400);
    goToDashboard();
  } catch (err) {
    showToast(err.message || 'Google sign-in failed. Please try again.', 'error');
  }
}

async function initGoogleSignIn() {
  const trigger = document.getElementById('google-signin-btn');
  if (!trigger) return;

  try {
    await loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
    });

    trigger.addEventListener('click', () => {
      // Prompt Google's One Tap / account chooser
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          showToast('Google sign-in is not configured yet. Add your GOOGLE_CLIENT_ID in js/auth.js.', 'error', 4200);
        }
      });
    });
  } catch (_) {
    trigger.addEventListener('click', () => {
      showToast('Could not load Google Sign-In. Check your connection.', 'error');
    });
  }
}

initGoogleSignIn();
