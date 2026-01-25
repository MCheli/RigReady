// State
let currentSection = 'devices';
let devices = [];
let gamepadPollingId = null;
let selectedGamepadIndex = null;
let identifyMode = false;
let identifyPollingId = null;
let lastButtonStates = {};
let deviceNames = {}; // Custom names keyed by VID:PID

// Load saved device names from localStorage
try {
  const saved = localStorage.getItem('deviceNames');
  if (saved) {
    deviceNames = JSON.parse(saved);
  }
} catch (e) {
  console.error('Failed to load device names:', e);
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');
  const deviceList = document.getElementById('device-list');
  const deviceSummary = document.getElementById('device-summary');
  const refreshBtn = document.getElementById('refresh-devices');
  const saveExpectedBtn = document.getElementById('save-expected');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');
  const gamepadSelect = document.getElementById('gamepad-select');
  const axesDisplay = document.getElementById('axes-display');
  const buttonsDisplay = document.getElementById('buttons-display');
  const expectedCount = document.getElementById('expected-count');

  // Navigation
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (section) {
        switchSection(section);
      }
    });
  });

  function switchSection(sectionId) {
    currentSection = sectionId;

    navItems.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-section') === sectionId);
    });

    sections.forEach((section) => {
      section.classList.toggle('active', section.id === sectionId);
    });

    // Start/stop gamepad polling based on section
    if (sectionId === 'input-test') {
      startGamepadPolling();
    } else {
      stopGamepadPolling();
    }
  }

  // Device Management
  async function loadDevices() {
    updateStatus('scanning');

    try {
      const status = await window.simManager.devices.checkStatus();
      devices = status.connected;

      renderDeviceSummary(status);
      renderDeviceList(status);

      const expected = await window.simManager.devices.getExpected();
      expectedCount.textContent = expected.length.toString();

      updateStatus(status.allExpectedConnected || expected.length === 0 ? 'ready' : 'warning');
    } catch (error) {
      console.error('Failed to load devices:', error);
      updateStatus('error');
    }
  }

  function renderDeviceSummary(status) {
    deviceSummary.innerHTML = `
      <div class="status-card success">
        <h3>Connected</h3>
        <div class="count">${status.connected.length}</div>
      </div>
      <div class="status-card ${status.missing.length > 0 ? 'danger' : 'success'}">
        <h3>Missing</h3>
        <div class="count">${status.missing.length}</div>
      </div>
      <div class="status-card ${status.unexpected.length > 0 ? 'warning' : 'success'}">
        <h3>New</h3>
        <div class="count">${status.unexpected.length}</div>
      </div>
    `;
  }

  function renderDeviceList(status) {
    const allDevices = [
      ...status.connected,
      ...status.missing.map((d) => ({ ...d, status: 'disconnected' })),
    ];

    if (allDevices.length === 0) {
      deviceList.innerHTML = '<p class="placeholder">No devices detected. Click Refresh to scan.</p>';
      return;
    }

    deviceList.innerHTML = allDevices
      .map((device) => `
        <div class="device-card ${device.status === 'disconnected' ? 'disconnected' : ''}">
          <div class="device-header">
            <div>
              <div class="device-name">${device.productName}</div>
              <div class="device-vendor">${device.vendorName}</div>
            </div>
            <span class="device-status-badge ${device.status}">
              ${device.status === 'connected' ? '● Connected' : '○ Missing'}
            </span>
          </div>
          <div class="device-info">
            VID:PID <code>${device.vendorId}:${device.productId}</code>
            · Type: <code>${device.type}</code>
          </div>
        </div>
      `)
      .join('');
  }

  function updateStatus(state) {
    statusDot.classList.remove('ready', 'error');

    switch (state) {
      case 'scanning':
        statusText.textContent = 'Scanning...';
        break;
      case 'ready':
        statusDot.classList.add('ready');
        statusText.textContent = 'All systems ready';
        break;
      case 'warning':
        statusText.textContent = 'Missing devices';
        break;
      case 'error':
        statusDot.classList.add('error');
        statusText.textContent = 'Error';
        break;
    }
  }

  // Gamepad Input Testing
  function startGamepadPolling() {
    if (gamepadPollingId !== null) return;

    updateGamepadList();

    gamepadPollingId = window.setInterval(() => {
      updateGamepadList();
      if (selectedGamepadIndex !== null) {
        renderGamepadState();
      }
    }, 16); // ~60fps
  }

  function stopGamepadPolling() {
    if (gamepadPollingId !== null) {
      clearInterval(gamepadPollingId);
      gamepadPollingId = null;
    }
  }

  function updateGamepadList() {
    const gamepads = navigator.getGamepads();
    const currentValue = gamepadSelect.value;

    // Build new options
    let newOptions = '<option value="">Select a controller...</option>';
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        newOptions += `<option value="${i}">${gp.id}</option>`;
      }
    }

    // Only update if changed
    if (gamepadSelect.innerHTML !== newOptions) {
      gamepadSelect.innerHTML = newOptions;
      gamepadSelect.value = currentValue;
    }
  }

  function renderGamepadState() {
    const gamepads = navigator.getGamepads();
    if (selectedGamepadIndex === null) return;

    const gamepad = gamepads[selectedGamepadIndex];
    if (!gamepad) {
      axesDisplay.innerHTML = '<p class="placeholder">Controller disconnected</p>';
      buttonsDisplay.innerHTML = '';
      return;
    }

    // Render axes
    axesDisplay.innerHTML = gamepad.axes
      .map((value, i) => {
        const percentage = Math.abs(value) * 50;
        const isNegative = value < 0;
        return `
          <div class="axis-item">
            <span class="axis-label">Axis ${i}</span>
            <div class="axis-bar-container">
              <div class="axis-center"></div>
              <div class="axis-bar ${isNegative ? 'negative' : 'positive'}"
                   style="width: ${percentage}%"></div>
            </div>
            <span class="axis-value">${value.toFixed(3)}</span>
          </div>
        `;
      })
      .join('');

    // Render buttons
    buttonsDisplay.innerHTML = gamepad.buttons
      .map((button, i) => `
        <div class="button-indicator ${button.pressed ? 'pressed' : ''}">
          ${i}
        </div>
      `)
      .join('');
  }

  // Event Listeners
  refreshBtn.addEventListener('click', loadDevices);

  saveExpectedBtn.addEventListener('click', async () => {
    const success = await window.simManager.devices.saveExpected();
    if (success) {
      await loadDevices();
      alert('Current devices saved as expected configuration!');
    } else {
      alert('Failed to save device configuration.');
    }
  });

  gamepadSelect.addEventListener('change', () => {
    const value = gamepadSelect.value;
    selectedGamepadIndex = value ? parseInt(value, 10) : null;

    if (selectedGamepadIndex === null) {
      axesDisplay.innerHTML = '<p class="placeholder">Select a controller to test</p>';
      buttonsDisplay.innerHTML = '';
    }
  });

  // Gamepad connect/disconnect events
  window.addEventListener('gamepadconnected', (e) => {
    console.log('Gamepad connected:', e.gamepad.id);
    updateGamepadList();
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    console.log('Gamepad disconnected:', e.gamepad.id);
    updateGamepadList();
    if (selectedGamepadIndex === e.gamepad.index) {
      selectedGamepadIndex = null;
    }
  });

  // Initialize
  axesDisplay.innerHTML = '<p class="placeholder">Select a controller to test</p>';
  loadDevices();

  // ============ Device Identification ============
  const identifyBtn = document.getElementById('identify-devices');
  const identifyModal = document.getElementById('identify-modal');
  const closeModalBtn = document.getElementById('close-identify-modal');
  const identifyInstructions = document.getElementById('identify-instructions');
  const identifyResult = document.getElementById('identify-result');
  const detectedDeviceName = document.getElementById('detected-device-name');
  const detectedDeviceId = document.getElementById('detected-device-id');
  const deviceCustomNameInput = document.getElementById('device-custom-name');
  const saveDeviceNameBtn = document.getElementById('save-device-name');
  const identifyAnotherBtn = document.getElementById('identify-another');
  const namedDevicesList = document.getElementById('named-devices-list');

  let currentDetectedGamepad = null;

  function openIdentifyModal() {
    identifyModal.classList.remove('hidden');
    resetIdentifyState();
    startIdentifyPolling();
    renderNamedDevices();
  }

  function closeIdentifyModal() {
    identifyModal.classList.add('hidden');
    stopIdentifyPolling();
    identifyMode = false;
  }

  function resetIdentifyState() {
    identifyInstructions.classList.remove('hidden');
    identifyResult.classList.add('hidden');
    deviceCustomNameInput.value = '';
    currentDetectedGamepad = null;
    lastButtonStates = {};

    // Capture initial button states
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        lastButtonStates[i] = gp.buttons.map(b => b.pressed);
      }
    }
  }

  function startIdentifyPolling() {
    identifyMode = true;

    // Small delay to let user release any buttons they're holding
    setTimeout(() => {
      // Recapture button states after delay
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp) {
          lastButtonStates[i] = gp.buttons.map(b => b.pressed);
        }
      }

      identifyPollingId = setInterval(checkForButtonPress, 50);
    }, 500);
  }

  function stopIdentifyPolling() {
    if (identifyPollingId) {
      clearInterval(identifyPollingId);
      identifyPollingId = null;
    }
  }

  function checkForButtonPress() {
    const gamepads = navigator.getGamepads();

    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp) continue;

      const prevStates = lastButtonStates[i] || [];

      for (let j = 0; j < gp.buttons.length; j++) {
        const wasPressed = prevStates[j] || false;
        const isPressed = gp.buttons[j].pressed;

        // Detect new button press (wasn't pressed, now is)
        if (isPressed && !wasPressed) {
          stopIdentifyPolling();
          showDetectedDevice(gp, i);
          return;
        }
      }

      // Update states
      lastButtonStates[i] = gp.buttons.map(b => b.pressed);
    }
  }

  function showDetectedDevice(gamepad, index) {
    currentDetectedGamepad = { gamepad, index };

    // Parse VID:PID from gamepad id
    const vidMatch = gamepad.id.match(/Vendor:\s*([0-9a-fA-F]+)/i);
    const pidMatch = gamepad.id.match(/Product:\s*([0-9a-fA-F]+)/i);
    const vid = vidMatch ? vidMatch[1].toUpperCase() : 'Unknown';
    const pid = pidMatch ? pidMatch[1].toUpperCase() : 'Unknown';

    detectedDeviceName.textContent = gamepad.id.split('(')[0].trim();
    detectedDeviceId.textContent = `VID:PID ${vid}:${pid}`;

    // Pre-fill with existing name if any
    const key = `${vid}:${pid}`;
    if (deviceNames[key]) {
      deviceCustomNameInput.value = deviceNames[key];
    } else {
      deviceCustomNameInput.value = '';
    }

    identifyInstructions.classList.add('hidden');
    identifyResult.classList.remove('hidden');
    deviceCustomNameInput.focus();
  }

  function saveDeviceName() {
    if (!currentDetectedGamepad) return;

    const customName = deviceCustomNameInput.value.trim();
    if (!customName) {
      alert('Please enter a name for the device');
      return;
    }

    // Parse VID:PID
    const vidMatch = currentDetectedGamepad.gamepad.id.match(/Vendor:\s*([0-9a-fA-F]+)/i);
    const pidMatch = currentDetectedGamepad.gamepad.id.match(/Product:\s*([0-9a-fA-F]+)/i);
    const vid = vidMatch ? vidMatch[1].toUpperCase() : 'Unknown';
    const pid = pidMatch ? pidMatch[1].toUpperCase() : 'Unknown';
    const key = `${vid}:${pid}`;

    deviceNames[key] = customName;

    // Save to localStorage
    try {
      localStorage.setItem('deviceNames', JSON.stringify(deviceNames));
    } catch (e) {
      console.error('Failed to save device names:', e);
    }

    // Also send to main process to update device manager
    if (window.simManager && window.simManager.devices.setDeviceName) {
      window.simManager.devices.setDeviceName(vid, pid, customName);
    }

    renderNamedDevices();
    resetIdentifyState();
    startIdentifyPolling();
  }

  function renderNamedDevices() {
    const entries = Object.entries(deviceNames);

    if (entries.length === 0) {
      namedDevicesList.innerHTML = '<p class="placeholder" style="padding: 10px; text-align: center; font-size: 0.85rem;">No devices named yet</p>';
      return;
    }

    namedDevicesList.innerHTML = entries.map(([vidPid, name]) => `
      <div class="named-device-item">
        <div>
          <span class="device-custom-name">${name}</span>
          <span class="device-vid-pid">${vidPid}</span>
        </div>
        <button class="btn-remove" data-vidpid="${vidPid}">🗑️</button>
      </div>
    `).join('');

    // Add remove handlers
    namedDevicesList.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const vidPid = btn.getAttribute('data-vidpid');
        delete deviceNames[vidPid];
        localStorage.setItem('deviceNames', JSON.stringify(deviceNames));
        renderNamedDevices();
        loadDevices(); // Refresh device list
      });
    });
  }

  // Event listeners for identify modal
  identifyBtn.addEventListener('click', openIdentifyModal);
  closeModalBtn.addEventListener('click', closeIdentifyModal);
  saveDeviceNameBtn.addEventListener('click', saveDeviceName);
  identifyAnotherBtn.addEventListener('click', () => {
    resetIdentifyState();
    startIdentifyPolling();
  });

  // Close modal on backdrop click
  identifyModal.addEventListener('click', (e) => {
    if (e.target === identifyModal) {
      closeIdentifyModal();
    }
  });

  // Save on Enter key
  deviceCustomNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveDeviceName();
    }
  });

  // Update device list rendering to use custom names
  const originalRenderDeviceList = renderDeviceList;
  renderDeviceList = function(status) {
    const allDevices = [
      ...status.connected,
      ...status.missing.map((d) => ({ ...d, status: 'disconnected' })),
    ];

    if (allDevices.length === 0) {
      deviceList.innerHTML = '<p class="placeholder">No devices detected. Click Refresh to scan.</p>';
      return;
    }

    deviceList.innerHTML = allDevices
      .map((device) => {
        const key = `${device.vendorId}:${device.productId}`;
        const customName = deviceNames[key];
        const displayName = customName || device.productName;

        return `
          <div class="device-card ${device.status === 'disconnected' ? 'disconnected' : ''}">
            <div class="device-header">
              <div>
                <div class="device-name">${displayName}</div>
                <div class="device-vendor">${device.vendorName}${customName ? ' · ' + device.productName : ''}</div>
              </div>
              <span class="device-status-badge ${device.status}">
                ${device.status === 'connected' ? '● Connected' : '○ Missing'}
              </span>
            </div>
            <div class="device-info">
              VID:PID <code>${device.vendorId}:${device.productId}</code>
              · Type: <code>${device.type}</code>
            </div>
          </div>
        `;
      })
      .join('');
  };
});
