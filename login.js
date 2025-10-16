const AUTH_STORAGE_KEY = 'ecg-mqtt-auth';
const DEFAULT_MQTT_SETTINGS = {
  broker: 'wss://y8ef161e.ala.asia-southeast1.emqxsl.com:8084/mqtt',
  username: 'PDX',
  password: 'pdx',
  topic: 'sensor/data',
};

function saveCredentials(payload) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to persist MQTT credentials', err);
    throw err;
  }
}

function populateFromStorage(form) {
  const brokerInput = form.querySelector('#authBroker');
  const clientIdInput = form.querySelector('#authClientId');
  const usernameInput = form.querySelector('#authUsername');
  const passwordInput = form.querySelector('#authPassword');
  const rememberInput = form.querySelector('#authRemember');

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      if (brokerInput && !brokerInput.value) {
        brokerInput.value = DEFAULT_MQTT_SETTINGS.broker;
      }
      if (usernameInput && !usernameInput.value) {
        usernameInput.value = DEFAULT_MQTT_SETTINGS.username;
      }
      if (passwordInput && !passwordInput.value) {
        passwordInput.value = DEFAULT_MQTT_SETTINGS.password;
      }
      if (rememberInput) {
        rememberInput.checked = true;
      }
      return;
    }

    const data = JSON.parse(raw);
    if (data?.broker && brokerInput) brokerInput.value = data.broker;
    if (data?.clientId && clientIdInput) clientIdInput.value = data.clientId;
    if (data?.username && usernameInput) usernameInput.value = data.username;
    if (data?.password && passwordInput) passwordInput.value = data.password;
    if (rememberInput) rememberInput.checked = !!data?.remember;
  } catch (err) {
    console.error('Failed to restore MQTT credentials', err);
    if (brokerInput && !brokerInput.value) {
      brokerInput.value = DEFAULT_MQTT_SETTINGS.broker;
    }
    if (usernameInput && !usernameInput.value) {
      usernameInput.value = DEFAULT_MQTT_SETTINGS.username;
    }
    if (passwordInput && !passwordInput.value) {
      passwordInput.value = DEFAULT_MQTT_SETTINGS.password;
    }
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
        topic: DEFAULT_MQTT_SETTINGS.topic,
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
