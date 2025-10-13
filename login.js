const AUTH_STORAGE_KEY = 'ecg-mqtt-auth';

function saveCredentials(payload) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to persist MQTT credentials', err);
    throw err;
  }
}

function populateFromStorage(form) {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data?.broker) form.querySelector('#authBroker').value = data.broker;
    if (data?.clientId) form.querySelector('#authClientId').value = data.clientId;
    if (data?.username) form.querySelector('#authUsername').value = data.username;
    if (data?.remember && form.querySelector('#authRemember')) {
      form.querySelector('#authRemember').checked = true;
    }
  } catch (err) {
    console.error('Failed to restore MQTT credentials', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('authForm');
  const brokerInput = document.getElementById('authBroker');
  const clientIdInput = document.getElementById('authClientId');
  const usernameInput = document.getElementById('authUsername');
  const passwordInput = document.getElementById('authPassword');
  const rememberInput = document.getElementById('authRemember');
  const errorEl = document.getElementById('loginError');
  const submitBtn = form?.querySelector('[type="submit"]');
  let bypassClicks = 0;
  let bypassTimer = null;
  const BYPASS_WINDOW_MS = 600;

  if (!form || !brokerInput || !usernameInput || !passwordInput) return;

  populateFromStorage(form);

  submitBtn?.addEventListener('click', (event) => {
    const now = Date.now();
    if (!bypassTimer || now - bypassTimer > BYPASS_WINDOW_MS) {
      bypassClicks = 1;
      bypassTimer = now;
    } else {
      bypassClicks += 1;
    }

    if (bypassClicks >= 3) {
      event.preventDefault();
      event.stopPropagation();
      bypassClicks = 0;
      bypassTimer = null;
      window.location.href = 'main.html';
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const broker = brokerInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const clientId = clientIdInput?.value.trim() || '';
    const remember = !!rememberInput?.checked;

    if (!broker || !username || !password) {
      if (errorEl) {
        errorEl.textContent = 'Please complete broker URL, username, and password.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }

    try {
      saveCredentials({
        broker,
        username,
        password,
        clientId,
        remember,
        topic: 'ecg/live',
      });
      window.location.href = 'main.html';
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'Unable to store credentials. Please check browser storage settings.';
        errorEl.classList.remove('hidden');
      }
    }
  });
});
