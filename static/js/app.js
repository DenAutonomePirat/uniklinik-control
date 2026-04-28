document.addEventListener('DOMContentLoaded', () => {
    // Initialize the application
    initApp();
    
    // Set up polling for camera status updates
    setInterval(updateCameraStatus, 5000);
    
    // Initialize session control form
    initSessionForm();
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
    
    // If we're in a recording session, disable the start button
    if (anyRecording && startSessionBtn.textContent !== 'Recording in progress') {
        startSessionBtn.textContent = 'Recording in progress';
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
    
    // Add input event listeners to update session info
    clientIdInput.addEventListener('input', () => {
        sessionInfo.clientId = clientIdInput.value.trim();
        validateSessionForm();
    });
    
    psychologistIdInput.addEventListener('input', () => {
        sessionInfo.psychologistId = psychologistIdInput.value.trim();
        validateSessionForm();
    });
    
    sessionNumberInput.addEventListener('input', () => {
        sessionInfo.sessionNumber = sessionNumberInput.value.trim();
        validateSessionForm();
    });
    
    // Add session button click handlers
    startSessionBtn.addEventListener('click', handleStartSession);
    endSessionBtn.addEventListener('click', handleEndSession);
    
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
    
    // Collect all validation issues
    const issues = [];
    
    // Check if all fields are filled
    if (sessionInfo.clientId === '') {
        issues.push('Klient ID er påkrævet');
    }
    
    if (sessionInfo.psychologistId === '') {
        issues.push('Psykolog ID er påkrævet');
    }
    
    if (sessionInfo.sessionNumber === '') {
        issues.push('Sessions nummer er påkrævet');
    }
    
    const isValid = issues.length === 0;
    
    // Check camera conditions
    const cameraIssues = [];
    
    // Check if there are any cameras
    if (cameraStatus.length === 0) {
        cameraIssues.push('Ingen kameraer fundet');
    
    } else {
        // Check each camera's conditions
        cameraStatus.forEach(camera => {
            if (!camera.reachable) {
                cameraIssues.push(`${camera.name} er ikke tilgængelig`);
            } else if (camera.recording) {
                cameraIssues.push(`${camera.name} optager allerede`);
            } else if (camera.usbStatus !== 'Connected') {
                cameraIssues.push(`${camera.name} har ingen USB-disk tilsluttet`);
            } else if (camera.remainingRecordHours < 1.0) {
                cameraIssues.push(`${camera.name} har mindre end 1 times optagetid tilbage`);
            }
        });
    }
    
    const hasAvailableCameras = cameraIssues.length === 0;
    
    // Add all issues to the validation messages
    [...issues, ...cameraIssues].forEach(issue => {
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
                if (startSessionBtn) {
                    startSessionBtn.textContent = 'Recording in progress';
                }
                // Enable end session button after pre-roll
                if (endSessionBtn) {
                    endSessionBtn.disabled = false;
                }
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

// Show pre-roll countdown
function showPrerollCountdown(seconds) {
    const validationMessages = document.getElementById('validation-messages');
    if (!validationMessages) return;
    
    // Clear previous messages
    validationMessages.innerHTML = '';
    
    // Create countdown element
    const countdownElement = document.createElement('div');
    countdownElement.className = 'preroll-countdown';
    countdownElement.innerHTML = `<p>Preparing timecode. Recording starts in <span id="countdown">${seconds}</span> seconds...</p>`;
    validationMessages.appendChild(countdownElement);
    
    // Start countdown
    const countdownSpan = document.getElementById('countdown');
    let timeLeft = seconds;
    
    const interval = setInterval(() => {
        timeLeft--;
        if (countdownSpan) {
            countdownSpan.textContent = timeLeft;
        }
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            if (countdownElement) {
                countdownElement.innerHTML = '<p>Recording in progress with synchronized timecode...</p>';
            }
            
            // Enable the end session button
            const endSessionBtn = document.getElementById('end-session');
            if (endSessionBtn) {
                endSessionBtn.disabled = false;
            }
        }
    }, 1000);
}

// Handle end session button click
async function handleEndSession() {
    // Show confirmation dialog
    if (!confirm('Are you sure you want to end the recording session? This will stop recording on all cameras and stop the timecode.')) {
        return; // User cancelled
    }
    
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
            
            // Update camera status
            await updateCameraStatus();
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

function showError(message) {
    // Simple error display - in a real app, you might use a toast or modal
    alert(message);
}