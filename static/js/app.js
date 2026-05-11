document.addEventListener('DOMContentLoaded', () => {
    // Initialize the application
    initApp();
    
    // Set up polling for camera status updates
    setInterval(updateCameraStatus, 5000);
    
    // Initialize session control form
    initSessionForm();

    // Initialize end session modal
    initEndSessionModal();

    // Initialize error modal
    initErrorModal();

    // Initialize disk management controls
    initDiskManagement();
});

// Global state to track camera status
let cameraStatus = [];

// Session information
let sessionInfo = {
    clientId: '',
    psychologistId: '',
    sessionNumber: ''
};

async function initApp() {
    try {
        // Get initial camera status
        await updateCameraStatus();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to connect to the server. Please check your connection and try again.');
    }
}

async function updateCameraStatus() {
    console.log('Updating camera status...');
    try {
        const response = await fetch('/api/cameras');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        cameraStatus = data;
        
        // Update the UI with the new camera status
        renderCameraControls();
        
        // Update session buttons state based on camera status
        updateSessionButtonsState();

        // Update format button state based on camera status
        updateFormatButtonState();
    } catch (error) {
        console.error('Failed to update camera status:', error);
    }
}
async function updateSessionStatus() {
    try {
        const response = await fetch('/api/session');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Session status:', data);
        // Update sessionInfo or UI based on session status if needed
    } catch (error) {
        console.error('Failed to update session status:', error);
    }
}
// Update the state of session control buttons based on camera status
function updateSessionButtonsState() {
    const startSessionBtn = document.getElementById('start-session');
    const endSessionBtn = document.getElementById('end-session');
    
    if (!startSessionBtn || !endSessionBtn) return;
    
    // Check if any cameras are recording
    const anyRecording = cameraStatus.some(camera => camera.recording);
    
    // Enable end session button if any camera is recording
    endSessionBtn.disabled = !anyRecording;
    
    if (anyRecording) {
        // Lock start button while recording
        startSessionBtn.disabled = true;
        startSessionBtn.textContent = 'Recording in progress';
    } else if (startSessionBtn.textContent === 'Recording in progress') {
        // Cameras have stopped — reset to idle so the user can start a new session
        startSessionBtn.textContent = 'Start Session Recording';
        validateSessionForm();
    }
}

function initSessionForm() {
    // Get form elements
    const sessionForm = document.getElementById('session-form');
    const clientIdInput = document.getElementById('client-id');
    const psychologistIdInput = document.getElementById('psychologist-id');
    const sessionNumberInput = document.getElementById('session-number');
    const startSessionBtn = document.getElementById('start-session');
    const endSessionBtn = document.getElementById('end-session');
    
    if (!sessionForm || !startSessionBtn || !endSessionBtn) return;
    
    // Add input event listeners to update session info.
    // Strip non-digits and cap length as the user types.
    clientIdInput.addEventListener('input', () => {
        clientIdInput.value = clientIdInput.value.replace(/\D/g, '').slice(0, 4);
        sessionInfo.clientId = clientIdInput.value;
        validateSessionForm();
    });

    psychologistIdInput.addEventListener('input', () => {
        psychologistIdInput.value = psychologistIdInput.value.replace(/\D/g, '').slice(0, 4);
        sessionInfo.psychologistId = psychologistIdInput.value;
        validateSessionForm();
    });

    sessionNumberInput.addEventListener('input', () => {
        sessionNumberInput.value = sessionNumberInput.value.replace(/\D/g, '').slice(0, 2);
        sessionInfo.sessionNumber = sessionNumberInput.value;
        validateSessionForm();
    });

    // Auto-pad session number to 2 digits on blur (e.g. "7" → "07")
    sessionNumberInput.addEventListener('blur', () => {
        const n = parseInt(sessionNumberInput.value, 10);
        if (!isNaN(n) && n >= 1 && n <= 99) {
            sessionNumberInput.value = String(n).padStart(2, '0');
            sessionInfo.sessionNumber = sessionNumberInput.value;
            validateSessionForm();
        }
    });
    
    // Add session button click handlers
    startSessionBtn.addEventListener('click', handleStartSession);
    endSessionBtn.addEventListener('click', () => {
        document.getElementById('end-session-modal').classList.add('visible');
    });
    
    // Initial validation
    validateSessionForm();
    updateSessionButtonsState();
}

function validateSessionForm() {
    const startSessionBtn = document.getElementById('start-session');
    const validationMessages = document.getElementById('validation-messages');
    if (!startSessionBtn || !validationMessages) return;

    // Clear previous validation messages
    validationMessages.innerHTML = '';

    // Helper to set/clear a per-field inline error span
    const setFieldError = (id, msg) => {
        const el = document.getElementById(id + '-error');
        if (el) el.textContent = msg;
    };

    // Clear all field errors first
    setFieldError('psychologist-id', '');
    setFieldError('client-id', '');
    setFieldError('session-number', '');

    // Validate fields and show errors inline next to their inputs
    let isValid = true;

    if (!/^\d{4}$/.test(sessionInfo.psychologistId)) {
        setFieldError('psychologist-id', 'Psykolog ID skal være et 4-cifret tal');
        isValid = false;
    }

    if (!/^\d{4}$/.test(sessionInfo.clientId)) {
        setFieldError('client-id', 'Klient ID skal være et 4-cifret tal');
        isValid = false;
    }

    const sn = parseInt(sessionInfo.sessionNumber, 10);
    if (!sessionInfo.sessionNumber || isNaN(sn) || sn < 1 || sn > 99) {
        setFieldError('session-number', 'Sessions nummer skal være et tal mellem 1 og 99');
        isValid = false;
    }

    // Check camera conditions — not field-specific, stay in validation-messages
    const cameraIssues = [];

    if (cameraStatus.length === 0) {
        cameraIssues.push('Ingen kameraer fundet');

    } else {
        cameraStatus.forEach(camera => {
            if (!camera.reachable) {
                cameraIssues.push(`${camera.name} er ikke tilgængelig`);
            } else if (camera.usbStatus !== 'Connected') {
                cameraIssues.push(`${camera.name} har ingen USB-disk tilsluttet`);
            } else if (camera.remainingRecordHours < 0.5) {
                cameraIssues.push(`${camera.name} har mindre end 30 minutter optagetid tilbage`);
            }
        });
    }

    cameraIssues.forEach(issue => {
        const messageElement = document.createElement('p');
        messageElement.textContent = issue;
        validationMessages.appendChild(messageElement);
    });

    // Enable or disable button based on validation
    // startSessionBtn.disabled = !isValid || !hasAvailableCameras;

    //temporarily allow starting session even if cameras have issues
    startSessionBtn.disabled = !isValid;
    // update the button text
    if (startSessionBtn.disabled) {
        startSessionBtn.textContent = 'Start Session Recording';
    }
}

async function handleStartSession() {
    const startSessionBtn = document.getElementById('start-session');
    const endSessionBtn = document.getElementById('end-session');
    const validationMessages = document.getElementById('validation-messages');
    
    // Disable the button to prevent multiple clicks
    if (startSessionBtn) {
        startSessionBtn.disabled = true;
        startSessionBtn.textContent = 'Starting session...';
    }
    
    try {
        const response = await fetch('/api/session/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sessionInfo)
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Show pre-roll countdown
            const preRollSeconds = data.preRollSeconds || 5;
            showPrerollCountdown(preRollSeconds);
            
            // Schedule status update after pre-roll
            setTimeout(async () => {
                await updateCameraStatus();

                // Confirm cameras actually started recording
                const recording = cameraStatus.filter(c => c.recording);
                if (recording.length === 0) {
                    showError(
                        'Recording did not start — a clip with this name already exists. ' +
                        'You may have two active sessions, or a previous session was interrupted. ' +
                        'Please increase the session number manually.'
                    );
                    if (startSessionBtn) {
                        startSessionBtn.textContent = 'Start Session Recording';
                        startSessionBtn.disabled = false;
                    }
                    validateSessionForm();
                    return;
                }

                if (startSessionBtn) startSessionBtn.textContent = 'Recording in progress';
                if (endSessionBtn)   endSessionBtn.disabled = false;

            }, (preRollSeconds + 1) * 1000);
        } else {
            // Show error message if any
            if (data.message) {
                showError(data.message);
            }
            if (data.invalidCameras && data.invalidCameras.length > 0) {
                const errorMsg = document.createElement('div');
                errorMsg.innerHTML = '<p>Invalid cameras:</p><ul>' + 
                    data.invalidCameras.map(cam => `<li>${cam}</li>`).join('') + 
                    '</ul>';
                validationMessages.appendChild(errorMsg);
            }
            validateSessionForm();
        }
    } catch (error) {
        console.error('Failed to start session:', error);
        showError('Failed to start recording session. Please try again.');
        validateSessionForm();
    }
}

// Show pre-roll countdown on the start session button
function showPrerollCountdown(seconds) {
    const startSessionBtn = document.getElementById('start-session');
    if (!startSessionBtn) return;

    let timeLeft = seconds;
    startSessionBtn.textContent = `Recording starts in ${timeLeft}s...`;

    const interval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            startSessionBtn.textContent = `Recording starts in ${timeLeft}s...`;
        } else {
            clearInterval(interval);
        }
    }, 1000);
}

// Handle end session button click
async function handleEndSession() {
    // Close the modal if open
    const modal = document.getElementById('end-session-modal');
    if (modal) modal.classList.remove('visible');
    
    const endSessionBtn = document.getElementById('end-session');
    const startSessionBtn = document.getElementById('start-session');
    const validationMessages = document.getElementById('validation-messages');
    
    // Disable the button to prevent multiple clicks
    if (endSessionBtn) {
        endSessionBtn.disabled = true;
        endSessionBtn.textContent = 'Ending session...';
    }
    
    try {
        const response = await fetch('/api/session/end', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sessionInfo)
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Clear any recording messages
            if (validationMessages) {
                validationMessages.innerHTML = '<div class="success-message">Session ended successfully</div>';
            }
            
            // Reset button states
            if (startSessionBtn) {
                startSessionBtn.textContent = 'Start Session Recording';
            }
            
            if (endSessionBtn) {
                endSessionBtn.textContent = 'End Session Recording';
            }
            
            // Update camera status then re-enable start button based on form validity
            await updateCameraStatus();
            validateSessionForm();
        } else {
            // Show error message
            showError(data.message || 'Failed to end session');
        }
    } catch (error) {
        console.error('Failed to end session:', error);
        showError('Failed to end recording session. Please try again.');
        
        // Reset button text
        if (endSessionBtn) {
            endSessionBtn.textContent = 'End Session Recording';
        }
    } finally {
        // Update button states
        updateSessionButtonsState();
    }
}

function renderCameraControls() {
    const container = document.getElementById('camera-controls');
    if (!container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    // Render each camera
    cameraStatus.forEach(camera => {
        const cameraCard = document.createElement('div');
        cameraCard.className = 'camera-card';
        
        // Determine display values based on reachability
        const recordingStatus = !camera.reachable ? 'Unknown' : camera.recording ? 'Recording' : 'Standby';
        const recordingClass = !camera.reachable ? 'unknown' : camera.recording ? 'recording' : 'not-recording';
        const usbStatusText = !camera.reachable ? 'Unknown' : camera.usbStatus;
        const usbStatusClass = !camera.reachable ? 'unknown' : 
                              (camera.usbStatus === 'Connected' ? 'usb-connected' : 'usb-disconnected');
        
        cameraCard.innerHTML = `
            <!-- Line 1: Camera Name -->
            <div class="camera-header">
                <h2>${camera.name}</h2>
            </div>
            
            <!-- Line 2: Control Buttons -->
            <div class="camera-controls">
                <button class="${camera.recording ? 'stop' : 'record'}" 
                        data-hostname="${camera.hostname}" 
                        data-action="${camera.recording ? 'stop' : 'record'}"
                        ${!camera.reachable ? 'disabled' : ''}>
                    ${camera.recording ? 'Stop Recording' : 'Start Recording'}
                </button>
                <button class="refresh-usb" data-hostname="${camera.hostname}"
                        ${!camera.reachable ? 'disabled' : ''}>
                    Refresh USB Status
                </button>
            </div>
            
            <!-- Line 3: Status Indicators -->
            <div class="camera-status">
                <div class="status-indicator">
                    <div class="status-dot ${recordingClass}"></div>
                    <span>${recordingStatus}</span>
                </div>
                <div class="status-indicator">
                    <div class="status-dot ${usbStatusClass}"></div>
                    <span>USB: ${usbStatusText}</span>
                </div>
                ${camera.reachable && camera.usbStatus === 'Connected' ? `
                <div class="status-indicator">
                    <span>Remaining: ${camera.remainingRecordHours.toFixed(1)} hours</span>
                </div>
                ` : ''}
            </div>
        `;
        
        container.appendChild(cameraCard);
    });
    
    // Add event listeners to the buttons
    document.querySelectorAll('[data-action="record"], [data-action="stop"]').forEach(button => {
        button.addEventListener('click', handleRecordToggle);
    });
    
    document.querySelectorAll('.refresh-usb').forEach(button => {
        button.addEventListener('click', handleRefreshUSB);
    });
    
    // Re-validate session form whenever camera status changes
    validateSessionForm();
}

async function handleRecordToggle(event) {
    const button = event.currentTarget;
    const hostname = button.dataset.hostname;
    const action = button.dataset.action;
    
    // Disable the button to prevent multiple clicks
    button.disabled = true;
    
    try {
        const response = await fetch('/api/camera/record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                hostname: hostname,
                record: action === 'record'
            })
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        // Update the camera status immediately
        await updateCameraStatus();
    } catch (error) {
        console.error('Failed to toggle recording:', error);
        showError(`Failed to ${action} recording. Please try again.`);
    } finally {
        // Re-enable the button
        button.disabled = false;
    }
}

async function handleRefreshUSB(event) {
    const button = event.currentTarget;
    const hostname = button.dataset.hostname;
    
    // Disable the button to prevent multiple clicks
    button.disabled = true;
    
    try {
        const response = await fetch(`/api/camera/usb-status?hostname=${encodeURIComponent(hostname)}`);
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        // Update the camera status immediately
        await updateCameraStatus();
    } catch (error) {
        console.error('Failed to refresh USB status:', error);
        showError('Failed to refresh USB status. Please try again.');
    } finally {
        // Re-enable the button
        button.disabled = false;
    }
}

// Settings are now managed through config.yaml file only

// Update the state of the format disks button based on camera status.
// Disabled only while any camera is actively recording — the backend
// validates disk presence before executing the format.
function updateFormatButtonState() {
    const formatBtn = document.getElementById('format-disks');
    if (!formatBtn) return;

    const anyRecording = cameraStatus.length > 0 &&
        cameraStatus.some(c => c.recording);
    formatBtn.disabled = anyRecording;
}

// Initialize end session modal wiring.
function initEndSessionModal() {
    const modal      = document.getElementById('end-session-modal');
    const overlay    = document.getElementById('end-session-modal-overlay');
    const confirmBtn = document.getElementById('end-session-confirm');
    const cancelBtn  = document.getElementById('end-session-cancel');

    if (!modal || !confirmBtn || !cancelBtn) return;

    cancelBtn.addEventListener('click', () => modal.classList.remove('visible'));
    overlay.addEventListener('click',   () => modal.classList.remove('visible'));
    confirmBtn.addEventListener('click', handleEndSession);
}

// Initialize disk management button and modal wiring.
function initDiskManagement() {    const formatBtn     = document.getElementById('format-disks');
    const modal         = document.getElementById('format-modal');
    const overlay       = document.getElementById('format-modal-overlay');
    const confirmBtn    = document.getElementById('format-confirm');
    const cancelBtn     = document.getElementById('format-cancel');

    if (!formatBtn || !modal || !confirmBtn || !cancelBtn) return;

    // Open modal on button click
    formatBtn.addEventListener('click', () => {
        modal.classList.add('visible');
    });

    // Close modal on cancel or overlay click
    cancelBtn.addEventListener('click', closeFormatModal);
    overlay.addEventListener('click', closeFormatModal);

    // Execute format on confirm
    confirmBtn.addEventListener('click', handleFormatDisks);
}

function closeFormatModal() {
    const modal = document.getElementById('format-modal');
    if (modal) modal.classList.remove('visible');
}

async function handleFormatDisks() {
    closeFormatModal();

    const formatBtn   = document.getElementById('format-disks');
    const statusDiv   = document.getElementById('format-status');

    if (formatBtn) {
        formatBtn.disabled = true;
        formatBtn.textContent = 'Formatting…';
    }
    if (statusDiv) {
        statusDiv.innerHTML = '<p class="format-progress">Formatting disks — this may take several minutes…</p>';
    }

    try {
        const response = await fetch('/api/disks/format', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<p class="format-success">Both disks formatted successfully.</p>';
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<p class="format-error">${data.message}</p>`;
            }
        }
    } catch (error) {
        console.error('Format request failed:', error);
        if (statusDiv) {
            statusDiv.innerHTML = '<p class="format-error">Format request failed. Check server connection.</p>';
        }
    } finally {
        if (formatBtn) formatBtn.textContent = 'Format Both Disks';
        await updateCameraStatus();
    }
}

function initErrorModal() {
    const modal   = document.getElementById('error-modal');
    const overlay = document.getElementById('error-modal-overlay');
    const okBtn   = document.getElementById('error-modal-ok');
    if (!modal || !okBtn) return;
    okBtn.addEventListener('click',   () => modal.classList.remove('visible'));
    overlay.addEventListener('click', () => modal.classList.remove('visible'));
}

function showError(message) {
    document.getElementById('error-modal-message').textContent = message;
    document.getElementById('error-modal').classList.add('visible');
}