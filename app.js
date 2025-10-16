const ICON_SUN =
  '<svg viewBox="0 0 24 24" role="img" focusable="false"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"></circle><line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="4.22" y1="4.22" x2="6.34" y2="6.34" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="2" y1="12" x2="5" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="4.22" y1="19.78" x2="6.34" y2="17.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="17.66" y1="6.34" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

const VISIBLE_POINT_COUNT = 100;
const CSV_RETENTION_COUNT = 1000;
const SAMPLE_INTERVAL = 0.02;
const MAX_LOG_ITEMS = 200;
const MESSAGE_WINDOW_MS = 60_000;
const DEFAULT_STATUS_DETAIL = 'Awaiting broker login (visit index.html)';
const DEFAULT_TOPIC = 'sensor/data';
const WEBSOCKET_TLS_PORT = '8084';
const LEGACY_TLS_PORT = '8884';
const AUTH_STORAGE_KEY = 'ecg-mqtt-auth';
const DEFAULT_CHANNEL_ID = 'A';
const CHANNEL_LINE_COLORS = {
  A: '#1dc2ed',
  B: '#34d399',
};
const CHANNEL_FILL_COLORS = {
  A: 'rgba(29, 194, 237, 0.12)',
  B: 'rgba(52, 211, 153, 0.15)',
};
const CHANNEL_DATA_KEYS = {
  A: {
    samples: [
      'ecgA',
      'ecg_a',
      'ecg-a',
      'leadA',
      'lead_a',
      'lead-a',
      'signalA',
      'signal_a',
      'signal-a',
      'valueA',
      'value_a',
      'value-a',
      'samplesA',
      'samples_a',
      'samples-a',
      'channelA',
      'channel_a',
      'channel-a',
    ],
    heartRate: ['hrA', 'hr_a', 'hr-a', 'heartRateA', 'heart_rate_a', 'heart-rate-a'],
    rrInterval: ['rrA', 'rr_a', 'rr-a', 'rrIntervalA', 'rr_interval_a', 'rr-interval-a'],
  },
  B: {
    samples: [
      'ecgB',
      'ecg_b',
      'ecg-b',
      'leadB',
      'lead_b',
      'lead-b',
      'signalB',
      'signal_b',
      'signal-b',
      'valueB',
      'value_b',
      'value-b',
      'samplesB',
      'samples_b',
      'samples-b',
      'channelB',
      'channel_b',
      'channel-b',
    ],
    heartRate: ['hrB', 'hr_b', 'hr-b', 'heartRateB', 'heart_rate_b', 'heart-rate-b'],
    rrInterval: ['rrB', 'rr_b', 'rr-b', 'rrIntervalB', 'rr_interval_b', 'rr-interval-b'],
  },
};

let mqttClient = null;
let isConnected = false;
let isConnecting = false;
let currentTopic = DEFAULT_TOPIC;
let pendingAuthMeta = null;

const messageTimestamps = [];
const channelStates = new Map();
let allCharts = [];

const connectionStatusEl = document.getElementById('connectionStatus');
const statusDot = document.getElementById('statusDot');
const statusDetailEl = document.getElementById('statusDetail');
const lastMessageEl = document.getElementById('lastMessage');
const messageRateEl = document.getElementById('messageRate');
const activeTopicEl = document.getElementById('activeTopic');
const logListEl = document.getElementById('logList');
const autoScrollCheckbox = document.getElementById('autoScroll');
const clearLogBtn = document.getElementById('clearLog');

const brokerInput = null;
const clientIdInput = null;
const usernameInput = null;
const passwordInput = null;
const rememberInput = null;
const logoutBtn = document.getElementById('logoutBtn');

const themeToggleBtn = document.getElementById('themeToggle');
const exportBtn = document.getElementById('exportCsv');

const publishForm = null;
const publishTopicInput = null;
const publishPayloadInput = null;
const publishQosInput = null;
const publishRetainInput = null;
const publishSendBtn = null;

currentTopic = DEFAULT_TOPIC;

function createChannelState(id) {
  return {
    id,
    timeCursor: 0,
    labels: [],
    values: [],
    history: [],
    canvases: [],
    charts: [],
    sampleCountEls: [],
    metrics: new Map(),
  };
}

function ensureChannelState(id = DEFAULT_CHANNEL_ID) {
  const channelId = (id || DEFAULT_CHANNEL_ID).toString().toUpperCase();
  if (!channelStates.has(channelId)) {
    channelStates.set(channelId, createChannelState(channelId));
  }
  return channelStates.get(channelId);
}

function registerChannelElements() {
  ['A', 'B'].forEach((id) => ensureChannelState(id));

  channelStates.forEach((state) => {
    state.canvases.length = 0;
    state.sampleCountEls.length = 0;
    state.charts.length = 0;
    state.metrics.forEach((list) => list.length = 0);
  });

  document.querySelectorAll('[data-ecg-chart]').forEach((canvas) => {
    const channelId = (canvas.dataset.ecgChart || DEFAULT_CHANNEL_ID).toUpperCase();
    const state = ensureChannelState(channelId);
    state.canvases.push(canvas);
  });

  document.querySelectorAll('[data-sample-count]').forEach((element) => {
    const channelId = (element.dataset.sampleCount || DEFAULT_CHANNEL_ID).toUpperCase();
    const state = ensureChannelState(channelId);
    state.sampleCountEls.push(element);
  });

  document.querySelectorAll('[data-metric][data-channel]').forEach((element) => {
    const metric = element.dataset.metric;
    const channelId = (element.dataset.channel || DEFAULT_CHANNEL_ID).toUpperCase();
    if (!metric) return;
    const state = ensureChannelState(channelId);
    if (!state.metrics.has(metric)) {
      state.metrics.set(metric, []);
    }
    state.metrics.get(metric).push(element);
  });
}

function getChannelColor(channelId) {
  return CHANNEL_LINE_COLORS[channelId] || CHANNEL_LINE_COLORS[DEFAULT_CHANNEL_ID];
}

function getChannelFillColor(channelId) {
  return CHANNEL_FILL_COLORS[channelId] || CHANNEL_FILL_COLORS[DEFAULT_CHANNEL_ID];
}

function normalizeBrokerUrl(rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'wss:' && parsed.port === LEGACY_TLS_PORT) {
      parsed.port = WEBSOCKET_TLS_PORT;
      return parsed.toString();
    }
    return parsed.toString();
  } catch (err) {
    if (trimmed.startsWith('wss://') && trimmed.includes(`:${LEGACY_TLS_PORT}/`)) {
      return trimmed.replace(`:${LEGACY_TLS_PORT}/`, `:${WEBSOCKET_TLS_PORT}/`);
    }
    return trimmed;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  registerChannelElements();
  initChart();
  wireEvents();
  autoConnectFromStoredCredentials();
});

function initTheme() {
  const savedTheme = localStorage.getItem('ecg-theme');
  const theme = savedTheme === 'light' ? 'light' : 'dark';
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(`theme-${theme}`);
  updateThemeToggleLabel(theme);
}

function wireEvents() {
  themeToggleBtn?.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark', !isLight);
    const theme = isLight ? 'light' : 'dark';
    localStorage.setItem('ecg-theme', theme);
    updateThemeToggleLabel(theme);
    refreshChartColors();
  });

  exportBtn?.addEventListener('click', exportCsv);
  clearLogBtn?.addEventListener('click', () => {
    clearLogEntries();
    logSystem('Log cleared');
  });
  logoutBtn?.addEventListener('click', handleLogout);
}

function autoConnectFromStoredCredentials() {
  const stored = getStoredAuth();
  if (!stored) {
    if (logoutBtn) logoutBtn.disabled = true;
    setStatus('disconnected', 'Broker login required. Visit index.html');
    logSystem('No stored MQTT credentials found. Authenticate via the login page.');
    return;
  }
  connectWithCredentials(stored);
}

function connectWithCredentials(auth) {
  if (isConnecting || isConnected) return;
  if (!auth?.url || !auth?.username || !auth?.password) {
    setStatus('error', 'Incomplete credentials. Please login again.');
    logSystem('Missing broker credentials. Re-authenticate via login page.');
    return;
  }

  const brokerUrl = normalizeBrokerUrl(auth.url);
  if (!brokerUrl) {
    setStatus('error', 'Invalid broker URL.');
    logSystem('Invalid broker URL provided.');
    return;
  }

  if (brokerUrl !== auth.url) {
    logSystem(`Adjusted broker URL to ${brokerUrl}`);
  }

  currentTopic = auth.topic || currentTopic || DEFAULT_TOPIC;
  setActiveTopic(currentTopic);
  setStatus('connecting', `Connecting to ${brokerUrl}`);
  setPublishEnabled(false);
  isConnecting = true;
  isConnected = false;
  logoutBtn?.setAttribute('disabled', 'disabled');

  if (typeof mqtt === 'undefined') {
    setStatus('error', 'MQTT library not loaded');
    logSystem('MQTT client library is unavailable. Check network access or CDN restrictions.');
    isConnecting = false;
    return;
  }

  pendingAuthMeta = {
    url: brokerUrl,
    clientId: auth.clientId || '',
    username: auth.username,
    password: auth.password,
    remember: !!auth.remember,
    topic: currentTopic,
  };

  try {
    mqttClient = mqtt.connect(brokerUrl, {
      clientId: auth.clientId || `ecg-web-${Math.random().toString(16).slice(2, 10)}`,
      keepalive: 60,
      username: auth.username,
      password: auth.password,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
    });
    if (mqttClient) {
      attachClientListeners(auth.url, pendingAuthMeta);
    }
  } catch (err) {
    console.error('Failed to create MQTT client', err);
    setStatus('error', err?.message || 'Failed to initiate connection');
    logSystem(`Connection error: ${err?.message || 'Unknown error'}`);
    isConnecting = false;
    pendingAuthMeta = null;
    return;
  }
}

function updateThemeToggleLabel(theme) {
  if (!themeToggleBtn) return;
  const icon = themeToggleBtn.querySelector('.toggle-icon');
  const label = themeToggleBtn.querySelector('.toggle-text');
  if (theme === 'light') {
    if (icon) icon.innerHTML = ICON_SUN;
    if (label) label.textContent = 'Light';
  } else {
    if (icon) icon.innerHTML = ICON_MOON;
    if (label) label.textContent = 'Dark';
  }
}

function initChart() {
  const { gridColor, textColor } = resolveChartColors();
  allCharts = [];

  channelStates.forEach((state) => {
    state.charts = state.canvases.map((canvas) => {
      const dataset = {
        label: `Lead ${state.id}`,
        data: [],
        cubicInterpolationMode: 'monotone',
        tension: 0.4,
        borderColor: getChannelColor(state.id),
        backgroundColor: getChannelFillColor(state.id),
        fill: true,
        pointRadius: 0,
      };

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [dataset],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: {
              title: {
                display: true,
                text: 'Time (seconds)',
                color: textColor,
              },
              ticks: {
                color: textColor,
              },
              grid: {
                color: gridColor,
              },
            },
            y: {
              title: {
                display: true,
                text: 'Voltage',
                color: textColor,
              },
              ticks: {
                color: textColor,
              },
              grid: {
                color: gridColor,
              },
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
      });

      allCharts.push(chart);
      return chart;
    });
  });
}

function resolveChartColors() {
  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#ffffff';
  const gridBase = styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.15)';
  return {
    textColor,
    gridColor: gridBase,
  };
}

function refreshChartColors() {
  if (!allCharts.length) return;
  const { textColor, gridColor } = resolveChartColors();
  channelStates.forEach((state) => {
    state.charts.forEach((chart) => {
      chart.options.scales.x.ticks.color = textColor;
      chart.options.scales.x.grid.color = gridColor;
      chart.options.scales.x.title.color = textColor;
      chart.options.scales.y.ticks.color = textColor;
      chart.options.scales.y.grid.color = gridColor;
      chart.options.scales.y.title.color = textColor;
      if (chart.data.datasets[0]) {
        chart.data.datasets[0].borderColor = getChannelColor(state.id);
        chart.data.datasets[0].backgroundColor = getChannelFillColor(state.id);
      }
      chart.update('none');
    });
  });
}

function appendSample(channelId, voltage, explicitTime) {
  if (!Number.isFinite(voltage)) return;
  const state = ensureChannelState(channelId);

  const hasExplicitTime = typeof explicitTime === 'number' && Number.isFinite(explicitTime);
  const effectiveTime = hasExplicitTime ? explicitTime : state.timeCursor;

  state.labels.push(effectiveTime.toFixed(2));
  state.values.push(voltage);
  state.history.push({
    time: effectiveTime,
    value: voltage,
  });

  if (state.labels.length > VISIBLE_POINT_COUNT) {
    state.labels.shift();
    state.values.shift();
  }

  if (state.history.length > CSV_RETENTION_COUNT) {
    state.history.shift();
  }

  state.timeCursor = effectiveTime + SAMPLE_INTERVAL;

  state.charts.forEach((chart) => {
    chart.data.labels = state.labels;
    if (chart.data.datasets[0]) {
      chart.data.datasets[0].data = state.values;
    }
    chart.update('none');
  });

  updateSampleCount(state.id);
  setMetricValue(state.id, 'latestSample', formatVoltage(voltage));
}

function updateSampleCount(channelId) {
  const state = ensureChannelState(channelId);
  const text = `${state.history.length} samples saved`;
  state.sampleCountEls.forEach((el) => {
    el.textContent = text;
  });
}

function defaultMetricPlaceholder(metric) {
  switch (metric) {
    case 'heartRate':
      return '-- bpm';
    case 'rrInterval':
      return '-- ms';
    case 'latestSample':
      return '--';
    default:
      return '--';
  }
}

function setMetricValue(channelId, metric, value) {
  const state = ensureChannelState(channelId);
  const targets = state.metrics.get(metric);
  if (!targets || !targets.length) return;
  const text = value == null || value === '' ? defaultMetricPlaceholder(metric) : value;
  targets.forEach((element) => {
    element.textContent = text;
  });
}

function formatHeartRate(value) {
  if (!Number.isFinite(value)) {
    return defaultMetricPlaceholder('heartRate');
  }
  return `${Math.round(value)} bpm`;
}

function formatInterval(value) {
  if (!Number.isFinite(value)) {
    return defaultMetricPlaceholder('rrInterval');
  }
  return `${Math.round(value)} ms`;
}

function formatVoltage(value) {
  if (!Number.isFinite(value)) {
    return defaultMetricPlaceholder('latestSample');
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) {
    return value.toFixed(0);
  }
  if (magnitude >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function matchPayloadValue(payload, candidates) {
  if (!payload || typeof payload !== 'object') return null;
  const lookup = new Map();
  Object.keys(payload).forEach((key) => {
    lookup.set(key.toLowerCase(), key);
  });
  for (const candidate of candidates || []) {
    const actualKey = lookup.get(candidate.toLowerCase());
    if (actualKey && payload[actualKey] !== undefined && payload[actualKey] !== null) {
      return {
        key: actualKey,
        value: payload[actualKey],
      };
    }
  }
  return null;
}

function applyChannelData(channelId, payload) {
  const descriptor = CHANNEL_DATA_KEYS[channelId];
  if (!descriptor) return { handled: false, samples: false };
  let handled = false;
  let samplesHandled = false;

  const hrMatch = matchPayloadValue(payload, descriptor.heartRate);
  if (hrMatch && typeof hrMatch.value === 'number') {
    setMetricValue(channelId, 'heartRate', formatHeartRate(hrMatch.value));
    handled = true;
  }

  const rrMatch = matchPayloadValue(payload, descriptor.rrInterval);
  if (rrMatch && typeof rrMatch.value === 'number') {
    setMetricValue(channelId, 'rrInterval', formatInterval(rrMatch.value));
    handled = true;
  }

  const sampleMatch = matchPayloadValue(payload, descriptor.samples);
  if (sampleMatch) {
    const samples = coerceVoltageList(sampleMatch.value);
    if (samples.length) {
      samples.forEach((value) => appendSample(channelId, value));
      handled = true;
      samplesHandled = true;
    }
  }

  return { handled, samples: samplesHandled };
}

function handleConnect(event) {
  event?.preventDefault?.();
  const form = event?.currentTarget;
  if (!form) return;
  const formData = new FormData(form);
  const auth = {
    url: (formData.get('authBroker') || formData.get('brokerUrl') || '').toString().trim(),
    username: (formData.get('authUsername') || formData.get('username') || '').toString().trim(),
    password: (formData.get('authPassword') || formData.get('password') || '').toString(),
    clientId: (formData.get('authClientId') || formData.get('clientId') || '').toString().trim(),
    remember:
      formData.get('authRemember') === 'on' ||
      formData.get('remember-me') === 'on' ||
      formData.get('remember') === 'on',
    topic: currentTopic,
  };
  connectWithCredentials(auth);
}

function handleDisconnect(detail) {
  if (!mqttClient) {
    resetAfterDisconnect(detail || 'Disconnected');
    return;
  }
  try {
    mqttClient.end(true);
  } catch (err) {
    console.error('Error closing MQTT client', err);
  }
  mqttClient = null;
  resetAfterDisconnect(detail || 'Disconnected');
  pendingAuthMeta = null;
}

function handleLogout() {
  clearStoredAuth();
  handleDisconnect('Signed out');
  setStatus('disconnected', 'Signed out. Visit index.html to reconnect.');
  logSystem('Signed out. Stored credentials cleared.');
}



function attachClientListeners(url, authMeta) {
  if (!mqttClient) return;

  mqttClient.on('connect', () => {
    isConnecting = false;
    isConnected = true;
    setStatus('connected', `Connected to ${url}`);
    logSystem(`Authenticated with ${url}`);
    setConnectionInputsDisabled(true);
    setPublishEnabled(true);
    if (authMeta?.remember) {
      persistAuth(authMeta);
    } else {
      clearStoredAuth();
    }
    pendingAuthMeta = null;
    subscribeToTopic(currentTopic, { silent: false });
  });

  mqttClient.on('message', (topic, payload) => {
    const payloadText = typeof payload?.toString === 'function' ? payload.toString() : '';
    recordIncomingMessage(topic, payloadText);
    try {
      const parsed = JSON.parse(payloadText);
      processPayload(parsed);
    } catch (err) {
      const numericSeries = parseNumericSeries(payloadText);
      if (numericSeries.length === 1) {
        processPayload({ voltage: numericSeries[0] });
      } else if (numericSeries.length > 1) {
        processPayload({ voltage: numericSeries });
      } else {
        logSystem('Received malformed payload');
      }
    }
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT error', err);
    isConnecting = false;
    if (isConnected) {
      isConnected = false;
      setPublishEnabled(false);
    }
    setConnectionInputsDisabled(false);
    setStatus('error', err?.message || 'MQTT error');
    logSystem(`Error: ${err?.message || 'Unknown MQTT error'}`);
  });

  mqttClient.on('close', () => {
    const wasConnected = isConnected;
    mqttClient?.removeAllListeners();
    mqttClient = null;
    isConnecting = false;
    isConnected = false;
    setPublishEnabled(false);
    setConnectionInputsDisabled(false);
    resetMessageStats();
    if (wasConnected) {
      setStatus('disconnected', 'Connection closed');
      logSystem('Connection closed');
    } else {
      setStatus('error', 'Unable to establish connection');
      logSystem('Unable to establish connection. Check broker configuration and network access.');
    }
  });
}

function resetAfterDisconnect(detail) {
  isConnected = false;
  isConnecting = false;
  setPublishEnabled(false);
  setConnectionInputsDisabled(false);
  setStatus('disconnected', detail || DEFAULT_STATUS_DETAIL);
  logSystem(detail || 'Disconnected');
  resetMessageStats();
}

function setStatus(state, detail) {
  if (connectionStatusEl) {
    if (state === 'connected') connectionStatusEl.textContent = 'Connected';
    else if (state === 'connecting') connectionStatusEl.textContent = 'Connecting';
    else if (state === 'error') connectionStatusEl.textContent = 'Error';
    else connectionStatusEl.textContent = 'Disconnected';
  }
  if (statusDetailEl) {
    statusDetailEl.textContent = detail || DEFAULT_STATUS_DETAIL;
  }
  if (statusDot) {
    statusDot.classList.remove('is-connected', 'is-connecting', 'is-error');
    if (state === 'connected') statusDot.classList.add('is-connected');
    else if (state === 'connecting') statusDot.classList.add('is-connecting');
    else if (state === 'error') statusDot.classList.add('is-error');
  }
}

function setConnectionInputsDisabled() {}

function resetMessageStats() {
  messageTimestamps.length = 0;
  if (messageRateEl) {
    messageRateEl.textContent = '0 msg/min';
  }
  channelStates.forEach((state) => {
    state.labels.length = 0;
    state.values.length = 0;
    state.history.length = 0;
    state.timeCursor = 0;
    state.charts.forEach((chart) => {
      chart.data.labels = [];
      if (chart.data.datasets[0]) {
        chart.data.datasets[0].data = [];
      }
      chart.update('none');
    });
    updateSampleCount(state.id);
    setMetricValue(state.id, 'heartRate', defaultMetricPlaceholder('heartRate'));
    setMetricValue(state.id, 'rrInterval', defaultMetricPlaceholder('rrInterval'));
    setMetricValue(state.id, 'latestSample', defaultMetricPlaceholder('latestSample'));
  });
  if (lastMessageEl) {
    lastMessageEl.textContent = '--';
  }
}

function setPublishEnabled(enabled) {
  if (logoutBtn) {
    logoutBtn.disabled = !enabled;
  }
}

function persistAuth(meta) {
  if (!meta?.remember) return;
  try {
    const payload = {
      broker: meta.url,
      username: meta.username,
      password: meta.password,
      clientId: meta.clientId,
      topic: meta.topic || currentTopic,
      remember: true,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to persist MQTT credentials', err);
  }
}

function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear stored MQTT credentials', err);
  }
}

function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.broker || !data?.username || !data?.password) return null;
    const normalizedBroker = normalizeBrokerUrl(data.broker);
    if (normalizedBroker !== data.broker) {
      data.broker = normalizedBroker;
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
      } catch (err) {
        console.error('Failed to update stored MQTT broker URL', err);
      }
      logSystem('Updated stored broker URL to WebSocket port 8084.');
    }
    return {
      url: normalizedBroker,
      username: data.username,
      password: data.password,
      clientId: data.clientId || '',
      topic: data.topic || DEFAULT_TOPIC,
      remember: !!data.remember,
    };
  } catch (err) {
    console.error('Failed to read stored MQTT credentials', err);
    return null;
  }
}

function subscribeToTopic(topic, options = {}) {
  const trimmed = (topic || '').trim();
  if (!trimmed) return;
  const previousTopic = currentTopic;
  currentTopic = trimmed;
  setActiveTopic(trimmed);

  if (!mqttClient || !mqttClient.connected) {
    if (!options.silent) {
      logSystem(`Subscription ready for ${trimmed}. Connect to activate.`);
    }
    return;
  }

  if (previousTopic && previousTopic !== trimmed) {
    mqttClient.unsubscribe(previousTopic, (err) => {
      if (err) {
        logSystem(`Failed to unsubscribe from ${previousTopic}: ${err.message}`);
      }
    });
  }

  mqttClient.subscribe(trimmed, { qos: 0 }, (err) => {
    if (err) {
      logSystem(`Failed to subscribe to ${trimmed}: ${err.message}`);
    } else if (!options.silent) {
      logSystem(`Subscribed to ${trimmed}`);
    }
  });
}

function handlePublish(event) {
  event?.preventDefault?.();
}

function setActiveTopic(topic) {
  if (activeTopicEl) {
    activeTopicEl.textContent = topic || DEFAULT_TOPIC;
  }
}

function recordIncomingMessage(topic, payloadText) {
  const now = new Date();
  const trimmedPayload = truncatePayload(payloadText);
  addLogEntry({
    type: 'message',
    topic: topic || '(unknown)',
    payload: trimmedPayload,
    timestamp: now,
  });
  messageTimestamps.push(now.getTime());
  const cutoff = now.getTime() - MESSAGE_WINDOW_MS;
  while (messageTimestamps.length && messageTimestamps[0] < cutoff) {
    messageTimestamps.shift();
  }
  updateMessageStats();
}

function updateMessageStats() {
  if (!messageRateEl) return;
  messageRateEl.textContent = `${messageTimestamps.length} msg/min`;
}

function truncatePayload(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '(empty)';
  if (trimmed.length > 160) {
    return `${trimmed.slice(0, 157)}...`;
  }
  return trimmed;
}

function clearLogEntries() {
  if (!logListEl) return;
  logListEl.innerHTML = '';
  const placeholder = document.createElement('li');
  placeholder.className = 'log-placeholder';
  placeholder.textContent = 'Log cleared. New messages will appear here.';
  logListEl.appendChild(placeholder);
}

function addLogEntry(entry) {
  if (!logListEl) return;
  const placeholder = logListEl.querySelector('.log-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  const li = document.createElement('li');
  if (entry.type === 'system') {
    li.classList.add('log-item-system');
  }

  const header = document.createElement('div');
  header.className = 'log-item-header';
  const topicSpan = document.createElement('span');
  topicSpan.textContent = entry.type === 'system' ? 'system' : entry.topic;
  const timeSpan = document.createElement('span');
  timeSpan.textContent = entry.timestamp
    ? entry.timestamp.toLocaleTimeString()
    : new Date().toLocaleTimeString();
  header.append(topicSpan, timeSpan);

  const payload = document.createElement('p');
  payload.className = 'log-item-payload';
  payload.textContent = entry.payload || '(empty)';
  if (entry.type === 'system') {
    payload.classList.add('log-item-system');
  }

  li.append(header, payload);
  logListEl.appendChild(li);

  while (logListEl.children.length > MAX_LOG_ITEMS) {
    logListEl.removeChild(logListEl.firstChild);
  }

  if (autoScrollCheckbox?.checked) {
    logListEl.scrollTop = logListEl.scrollHeight;
  }
}

function logSystem(message) {
  addLogEntry({
    type: 'system',
    topic: 'system',
    payload: message,
    timestamp: new Date(),
  });
}

function parseNumericSeries(source) {
  if (Array.isArray(source)) {
    const flattened = [];
    source.forEach((item) => {
      const values = parseNumericSeries(item);
      if (values.length) {
        flattened.push(...values);
      }
    });
    return flattened;
  }

  if (typeof source === 'number') {
    return Number.isFinite(source) ? [source] : [];
  }

  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== source) {
        const parsedResult = parseNumericSeries(parsed);
        if (parsedResult.length) {
          return parsedResult;
        }
      }
    } catch (err) {
      // ignore JSON parse errors and fall back to delimiter parsing
    }
    const parts = trimmed.split(/[\s,;|]+/);
    const values = [];
    for (const part of parts) {
      if (!part) continue;
      const value = Number(part);
      if (Number.isFinite(value)) {
        values.push(value);
      }
    }
    return values;
  }

  return [];
}

function processPayload(data) {
  if (data == null) return;

  if (typeof data === 'number') {
    appendSample(DEFAULT_CHANNEL_ID, data);
    return;
  }

  if (typeof data === 'string') {
    const series = parseNumericSeries(data);
    if (series.length) {
      series.forEach((value) => appendSample(DEFAULT_CHANNEL_ID, value));
    }
    return;
  }

  if (Array.isArray(data)) {
    const series = coerceVoltageList(data);
    if (series.length) {
      series.forEach((value) => appendSample(DEFAULT_CHANNEL_ID, value));
    }
    return;
  }

  if (typeof data !== 'object') return;

  const leadA = applyChannelData('A', data);
  const leadB = applyChannelData('B', data);

  if (typeof data.heartRate === 'number') {
    setMetricValue(DEFAULT_CHANNEL_ID, 'heartRate', formatHeartRate(data.heartRate));
  }

  if (typeof data.rrInterval === 'number') {
    setMetricValue(DEFAULT_CHANNEL_ID, 'rrInterval', formatInterval(data.rrInterval));
  }

  if (!leadA.samples && !leadB.samples) {
    const sampleMatch = matchPayloadValue(data, ['voltage', 'value', 'latestSample', 'sample']);
    if (sampleMatch && typeof sampleMatch.value === 'number') {
      appendSample(DEFAULT_CHANNEL_ID, sampleMatch.value);
      return;
    }
  }

  if (!leadA.samples && !leadB.samples) {
    const extraSeries = coerceVoltageList(data);
    if (extraSeries.length) {
      let targetChannel = DEFAULT_CHANNEL_ID;
      if (leadA.handled && !leadB.handled) {
        targetChannel = 'A';
      } else if (leadB.handled && !leadA.handled) {
        targetChannel = 'B';
      }
      extraSeries.forEach((value) => appendSample(targetChannel, value));
    }
  }
}

function coerceVoltageList(payload) {
  if (payload == null) return [];

  if (Array.isArray(payload)) {
    const collected = [];
    payload.forEach((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const nested = coerceVoltageList(entry);
        if (nested.length) {
          collected.push(...nested);
        }
      } else {
        const normalized = parseNumericSeries(entry);
        if (normalized.length) {
          collected.push(...normalized);
        }
      }
    });
    return collected;
  }

  if (typeof payload === 'number' || typeof payload === 'string') {
    return parseNumericSeries(payload);
  }

  if (typeof payload !== 'object') {
    return [];
  }

  const prioritizedKeys = [
    'voltage',
    'voltages',
    'values',
    'samples',
    'data',
    'signal',
    'signals',
    'waveform',
    'waveforms',
    'ecg',
    'ecgValues',
    'ecgData',
    'points',
    'series',
  ];

  for (const key of prioritizedKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const normalized = parseNumericSeries(payload[key]);
      if (normalized.length) {
        return normalized;
      }
    }
  }

  const scalarKeys = [
    'voltage',
    'value',
    'sample',
    'reading',
    'signal',
    'ecg',
    'ecgValue',
    'amplitude',
    'y',
  ];

  for (const key of scalarKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const normalized = parseNumericSeries(payload[key]);
      if (normalized.length === 1) {
        return normalized;
      }
    }
  }

  const nestedKeys = ['payload', 'body', 'message', 'data'];
  for (const key of nestedKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (value && typeof value === 'object') {
      const nested = coerceVoltageList(value);
      if (nested.length) {
        return nested;
      }
    } else {
      const normalized = parseNumericSeries(value);
      if (normalized.length) {
        return normalized;
      }
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) || typeof value === 'string') {
      const normalized = parseNumericSeries(value);
      if (normalized.length > 1) {
        return normalized;
      }
    } else if (value && typeof value === 'object') {
      const nested = coerceVoltageList(value);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function exportCsv() {
  const rows = [];
  channelStates.forEach((state) => {
    state.history.forEach((entry) => {
      const timeValue = Number.isFinite(entry.time) ? entry.time.toFixed(4) : '';
      const voltage = Number.isFinite(entry.value) ? entry.value : '';
      rows.push(`${timeValue},${voltage},${state.id}`);
    });
  });

  if (!rows.length) return;

  const header = 'time_s,voltage_raw,channel\n';
  const body = rows.join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.download = `ecg-signal-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
