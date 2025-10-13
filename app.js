const ICON_SUN =
  '<svg viewBox="0 0 24 24" role="img" focusable="false"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"></circle><line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="4.22" y1="4.22" x2="6.34" y2="6.34" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="2" y1="12" x2="5" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="4.22" y1="19.78" x2="6.34" y2="17.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="17.66" y1="6.34" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

const MAX_POINTS = 512;
const SAMPLE_INTERVAL = 0.02;
const MAX_LOG_ITEMS = 200;
const MESSAGE_WINDOW_MS = 60_000;
const DEFAULT_STATUS_DETAIL = 'Awaiting broker configuration';

let timeCursor = 0;
let ecgChart;
let chartDataset;
let mqttClient = null;
let isConnected = false;
let isConnecting = false;
let currentTopic = '';

const messageTimestamps = [];

const buffers = {
  labels: [],
  values: [],
};

const metricElements = {
  heartRate: document.getElementById('metricHeartRate'),
  bloodPressure: document.getElementById('metricBloodPressure'),
  temperature: document.getElementById('metricTemperature'),
  prInterval: document.getElementById('metricPrInterval'),
  qtInterval: document.getElementById('metricQtInterval'),
  qrsDuration: document.getElementById('metricQrsDuration'),
};

const connectionStatusEl = document.getElementById('connectionStatus');
const statusDot = document.getElementById('statusDot');
const statusDetailEl = document.getElementById('statusDetail');
const lastMessageEl = document.getElementById('lastMessage');
const messageRateEl = document.getElementById('messageRate');
const sampleCountEl = document.getElementById('sampleCount');
const activeTopicEl = document.getElementById('activeTopic');
const logListEl = document.getElementById('logList');
const autoScrollCheckbox = document.getElementById('autoScroll');
const clearLogBtn = document.getElementById('clearLog');

const mqttForm = document.getElementById('mqttForm');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const subscribeBtn = document.getElementById('subscribeBtn');
const topicInput = document.getElementById('topic');

const themeToggleBtn = document.getElementById('themeToggle');
const exportBtn = document.getElementById('exportCsv');

const publishForm = document.getElementById('publishForm');
const publishTopicInput = document.getElementById('publishTopic');
const publishPayloadInput = document.getElementById('publishPayload');
const publishQosInput = document.getElementById('publishQos');
const publishRetainInput = document.getElementById('publishRetain');
const publishSendBtn = document.getElementById('publishSend');

currentTopic = topicInput?.value?.trim() || '';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initChart();
  seedDemoData();
  wireEvents();
  setActiveTopic(currentTopic);
  setPublishEnabled(false);
  setStatus('disconnected', DEFAULT_STATUS_DETAIL);
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

  mqttForm?.addEventListener('submit', handleConnect);
  disconnectBtn?.addEventListener('click', handleDisconnect);
  exportBtn?.addEventListener('click', exportCsv);
  subscribeBtn?.addEventListener('click', () => {
    subscribeToTopic(topicInput?.value);
  });
  topicInput?.addEventListener('change', () => {
    const trimmed = topicInput.value.trim();
    currentTopic = trimmed;
    setActiveTopic(trimmed);
  });
  clearLogBtn?.addEventListener('click', () => {
    clearLogEntries();
    logSystem('Log cleared');
  });
  publishForm?.addEventListener('submit', handlePublish);
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
  const ctx = document.getElementById('ecgChart');
  if (!ctx) return;
  const { lineColor, gridColor, textColor } = resolveChartColors();
  chartDataset = {
    label: 'ECG (mV)',
    data: [],
    cubicInterpolationMode: 'monotone',
    tension: 0.4,
    borderColor: lineColor,
    backgroundColor: 'rgba(29, 194, 237, 0.12)',
    fill: true,
    pointRadius: 0,
  };

  ecgChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [chartDataset],
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
            text: 'Voltage (mV)',
            color: textColor,
          },
          min: -1.5,
          max: 1.5,
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
}

function resolveChartColors() {
  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#ffffff';
  const gridBase = styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.15)';
  const lineColor = '#1dc2ed';
  return {
    textColor,
    lineColor,
    gridColor: gridBase,
  };
}

function refreshChartColors() {
  if (!ecgChart) return;
  const { textColor, gridColor, lineColor } = resolveChartColors();
  ecgChart.options.scales.x.ticks.color = textColor;
  ecgChart.options.scales.x.grid.color = gridColor;
  ecgChart.options.scales.x.title.color = textColor;
  ecgChart.options.scales.y.ticks.color = textColor;
  ecgChart.options.scales.y.grid.color = gridColor;
  ecgChart.options.scales.y.title.color = textColor;
  chartDataset.borderColor = lineColor;
  ecgChart.update('none');
}

function seedDemoData() {
  buffers.labels.length = 0;
  buffers.values.length = 0;
  timeCursor = 0;
  for (let i = 0; i < 180; i++) {
    const voltage = mockEcgWaveform(i);
    appendSample(voltage, i * SAMPLE_INTERVAL);
  }
  ecgChart?.update('none');
}

function mockEcgWaveform(index) {
  const phase = (index % 90) / 90;
  if (phase < 0.12) return 0.15 * Math.sin(phase * Math.PI * 3);
  if (phase < 0.2) return 0.05;
  if (phase < 0.28) return (phase - 0.2) * 7;
  if (phase < 0.32) return 1.2 - (phase - 0.28) * 12;
  if (phase < 0.36) return -1 + (phase - 0.32) * 8;
  if (phase < 0.45) return -0.2 + (phase - 0.36) * 1.5;
  return 0.02 * Math.sin(phase * Math.PI * 12);
}

function appendSample(voltage, explicitTime) {
  if (typeof explicitTime === 'number') {
    timeCursor = explicitTime;
  }

  buffers.labels.push(timeCursor.toFixed(2));
  buffers.values.push(voltage);

  if (buffers.labels.length > MAX_POINTS) {
    buffers.labels.shift();
    buffers.values.shift();
  }

  timeCursor += SAMPLE_INTERVAL;

  if (ecgChart) {
    ecgChart.data.labels = buffers.labels;
    chartDataset.data = buffers.values;
    ecgChart.update('none');
  }

  updateSampleCount();
}

function updateSampleCount() {
  if (sampleCountEl) {
    sampleCountEl.textContent = `${buffers.labels.length} samples`;
  }
}

function handleConnect(event) {
  event.preventDefault();
  if (isConnecting || isConnected) return;
  if (!mqttForm) return;

  const formData = new FormData(mqttForm);
  const url = formData.get('brokerUrl');
  const topic = (formData.get('topic') || '').trim();
  const clientId = (formData.get('clientId') || '').trim();
  const keepAlive = Number(formData.get('keepAlive'));
  const username = (formData.get('username') || '').trim();
  const password = formData.get('password') || undefined;
  const cleanSession = formData.get('cleanSession') === 'on';

  if (!url) {
    setStatus('error', 'Broker URL is required');
    logSystem('Broker URL is required');
    return;
  }

  currentTopic = topic;
  setActiveTopic(currentTopic);

  setStatus('connecting', `Connecting to ${url}`);
  setConnectionInputsDisabled(true);
  setPublishEnabled(false);
  if (connectBtn) connectBtn.disabled = true;
  if (disconnectBtn) disconnectBtn.disabled = true;
  isConnecting = true;
  isConnected = false;

  if (typeof mqtt === 'undefined') {
    setStatus('error', 'MQTT library not loaded');
    logSystem('MQTT client library is unavailable. Check network access or CDN restrictions.');
    setConnectionInputsDisabled(false);
    setPublishEnabled(false);
    if (connectBtn) connectBtn.disabled = false;
    isConnecting = false;
    return;
  }

  try {
    mqttClient = mqtt.connect(url, {
      clientId: clientId || `ecg-web-${Math.random().toString(16).slice(2, 10)}`,
      keepalive: Number.isFinite(keepAlive) && keepAlive > 0 ? keepAlive : undefined,
      username: username || undefined,
      password: password || undefined,
      clean: cleanSession,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
    });
  } catch (err) {
    console.error('Failed to create MQTT client', err);
    setStatus('error', err?.message || 'Failed to initiate connection');
    logSystem(`Connection error: ${err?.message || 'Unknown error'}`);
    setConnectionInputsDisabled(false);
    if (connectBtn) connectBtn.disabled = false;
    isConnecting = false;
    return;
  }

  attachClientListeners(url);
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
}

function attachClientListeners(url) {
  if (!mqttClient) return;

  mqttClient.on('connect', () => {
    isConnecting = false;
    isConnected = true;
    setStatus('connected', `Connected to ${url}`);
    logSystem(`Connected to ${url}`);
    if (connectBtn) connectBtn.disabled = true;
    if (disconnectBtn) disconnectBtn.disabled = false;
    setConnectionInputsDisabled(false);
    setPublishEnabled(true);
    subscribeToTopic(currentTopic, { silent: false });
  });

  mqttClient.on('message', (topic, payload) => {
    const payloadText = typeof payload?.toString === 'function' ? payload.toString() : '';
    recordIncomingMessage(topic, payloadText);
    try {
      const parsed = JSON.parse(payloadText);
      processPayload(parsed);
    } catch (err) {
      console.error('Failed to parse MQTT payload', err);
      logSystem('Received malformed JSON payload');
      const singleValue = Number(payloadText);
      if (!Number.isNaN(singleValue)) {
        processPayload({ voltage: singleValue });
      }
    }
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT error', err);
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
    if (connectBtn) connectBtn.disabled = false;
    if (disconnectBtn) disconnectBtn.disabled = true;
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
  if (connectBtn) connectBtn.disabled = false;
  if (disconnectBtn) disconnectBtn.disabled = true;
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

function setConnectionInputsDisabled(disabled) {
  if (!mqttForm) return;
  const elements = mqttForm.querySelectorAll('input, select, button');
  elements.forEach((element) => {
    if (element === disconnectBtn || element === subscribeBtn || element.id === 'topic') {
      return;
    }
    if (element.type === 'submit') {
      element.disabled = disabled;
    } else {
      element.disabled = disabled;
    }
  });
}

function setPublishEnabled(enabled) {
  if (publishSendBtn) {
    publishSendBtn.disabled = !enabled;
  }
}

function subscribeToTopic(topic, options = {}) {
  const trimmed = (topic || '').trim();
  if (!trimmed) return;
  const previousTopic = currentTopic;
  currentTopic = trimmed;
  setActiveTopic(trimmed);
  if (topicInput && topicInput.value !== trimmed) {
    topicInput.value = trimmed;
  }

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
  event.preventDefault();
  if (!mqttClient || !mqttClient.connected) {
    logSystem('Cannot publish while disconnected');
    return;
  }
  const topic = publishTopicInput?.value.trim();
  if (!topic) {
    logSystem('Publish topic is required');
    return;
  }
  const payload = publishPayloadInput?.value ?? '';
  const qos = Math.min(Math.max(parseInt(publishQosInput?.value, 10) || 0, 0), 2);
  const retain = !!publishRetainInput?.checked;
  mqttClient.publish(topic, payload, { qos, retain }, (err) => {
    if (err) {
      logSystem(`Failed to publish to ${topic}: ${err.message}`);
    } else {
      logSystem(`Published to ${topic} (QoS ${qos}${retain ? ', retain' : ''})`);
    }
  });
}

function setActiveTopic(topic) {
  if (activeTopicEl) {
    activeTopicEl.textContent = topic || 'None';
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
  if (messageRateEl) {
    messageRateEl.textContent = `${messageTimestamps.length} msg/min`;
  }
  if (lastMessageEl) {
    lastMessageEl.textContent = now.toLocaleTimeString();
  }
}

function resetMessageStats() {
  messageTimestamps.length = 0;
  if (messageRateEl) {
    messageRateEl.textContent = '0 msg/min';
  }
  if (lastMessageEl) {
    lastMessageEl.textContent = 'No data yet';
  }
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

function processPayload(data) {
  if (typeof data !== 'object' || data === null) return;

  if (typeof data.heartRate === 'number') {
    metricElements.heartRate.textContent = `${Math.round(data.heartRate)} bpm`;
  }

  if (data.bloodPressure) {
    metricElements.bloodPressure.textContent = String(data.bloodPressure);
  }

  if (typeof data.temperature === 'number') {
    metricElements.temperature.textContent = `${Number(data.temperature).toFixed(1)} \u00B0C`;
  }

  if (typeof data.prInterval === 'number') {
    metricElements.prInterval.textContent = `${Math.round(data.prInterval)} ms`;
  }

  if (typeof data.qtInterval === 'number') {
    metricElements.qtInterval.textContent = `${Math.round(data.qtInterval)} ms`;
  }

  if (typeof data.qrsDuration === 'number') {
    metricElements.qrsDuration.textContent = `${Math.round(data.qrsDuration)} ms`;
  }

  const voltage = coerceVoltageList(data);
  if (voltage.length) {
    for (let i = 0; i < voltage.length; i++) {
      appendSample(Number(voltage[i]));
    }
  }
}

function coerceVoltageList(payload) {
  if (Array.isArray(payload.voltage)) {
    return payload.voltage.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  }

  if (typeof payload.voltage === 'number') {
    return [payload.voltage];
  }

  if (typeof payload.value === 'number') {
    return [payload.value];
  }

  return [];
}

function exportCsv() {
  if (!buffers.labels.length) return;
  const header = 'time_s,voltage_mv\n';
  const body = buffers.labels
    .map((label, index) => `${label},${buffers.values[index]?.toFixed(4) ?? ''}`)
    .join('\n');
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
