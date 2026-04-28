document.addEventListener('DOMContentLoaded', () => {
    // Initialize the application
    initApp();
    
    // Set up polling for only processing status
    setInterval(updateProcessingStatus, 1000);
    
    // Set up event listeners
    document.getElementById('start-button').addEventListener('click', startProcessing);
    
    // Add refresh button for manual disk updates
    addDiskRefreshButton();
    
    // Add button to find matches
    addFindMatchesButton();
});

// Global state
let disks = [];
let tasks = [];
let processingStatus = {
    inProgress: false,
    message: 'Ready',
    progress: 0,
    error: ''
};

// keep previous processing state so we can detect transitions
let prevProcessingInProgress = false;
let matchingFiles = {};

// Function to update all button states based on current app state
function updateAllButtonStates() {
    updateStartButtonState();
    updateRefreshButtonState();
    updateFindMatchesButtonState();
}

// Function to update button state based on current selections
function updateStartButtonState() {
    const startButton = document.getElementById('start-button');
    const selectedTasks = document.querySelectorAll('.task-item.selected');
    const hasDisks = disks.length > 0;
    const isProcessing = processingStatus.inProgress;

    // Enable only if disks are present, at least one task is selected, and not currently processing
    const shouldEnable = hasDisks && selectedTasks.length > 0 && !isProcessing;
    
    startButton.disabled = !shouldEnable;
    startButton.textContent = isProcessing ? 'Processing...' : 'Start Processing';
    
    console.log(`Start button state updated: enabled=${shouldEnable}, disks=${hasDisks}, tasks=${selectedTasks.length}, processing=${isProcessing}`);
}

// Function to update refresh button state
function updateRefreshButtonState() {
    const refreshButton = document.getElementById('refresh-disks-button');
    if (!refreshButton) return;
    
    // Refresh button is always enabled unless currently scanning
    const isScanning = refreshButton.textContent === 'Scanning...';
    refreshButton.disabled = isScanning;
}

// Function to update find matches button state
function updateFindMatchesButtonState() {
    const findMatchesButton = document.getElementById('find-matches-button');
    if (!findMatchesButton) return;
    
    // Find matches button is enabled if disks are selected and not currently searching
    const selectedDisks = document.querySelectorAll('.disk-select:checked');
    const isSearching = findMatchesButton.textContent === 'Searching...';
    const shouldEnable = selectedDisks.length > 0 && !isSearching;
    
    findMatchesButton.disabled = !shouldEnable;
}

// Initialize the application
async function initApp() {
    try {
        // Get initial data
        await Promise.all([
            updateDiskStatus(),
            updateTasksList(),
            updateProcessingStatus(),
            updateMatchingFiles()
        ]);
        
        console.log('Application initialized');
        updateAllButtonStates();  // Update all button states after initialization
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to connect to the server. Please check your connection and try again.');
    }
}

// Update disk status
async function updateDiskStatus() {
    try {
        // Show loading indicator on the button
        const refreshButton = document.getElementById('refresh-disks-button');
        if (refreshButton) {
            refreshButton.textContent = 'Scanning...';
            refreshButton.disabled = true;
        }
        
        const response = await fetch('/api/disks');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        disks = await response.json();
        renderDisks();
        updateAllButtonStates();  // Update all button states after loading disks
        
        // Update connection status
        document.getElementById('connection-status').className = 'connected';
        document.getElementById('connection-status').textContent = 'Connected';
        
        // Reset refresh button state
        if (refreshButton) {
            refreshButton.textContent = 'Scan for Disks';
        }
        updateRefreshButtonState();
    } catch (error) {
        console.error('Failed to update disk status:', error);
        document.getElementById('connection-status').className = 'disconnected';
        document.getElementById('connection-status').textContent = 'Disconnected';
        
        // Reset refresh button state with error
        const refreshButton = document.getElementById('refresh-disks-button');
        if (refreshButton) {
            refreshButton.textContent = 'Scan Failed - Try Again';
        }
        updateRefreshButtonState();
    }
}

// Update tasks list
async function updateTasksList() {
    try {
        const response = await fetch('/api/tasks');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        tasks = await response.json();
        renderTasks();
        updateAllButtonStates();  // Update all button states after loading tasks
    } catch (error) {
        console.error('Failed to update tasks list:', error);
    }
}

// Update processing status
async function updateProcessingStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        processingStatus = await response.json();
        renderProcessingStatus();
        
        // if we just finished (was true, now false) clear tasks
        if (prevProcessingInProgress && !processingStatus.inProgress) {
            document.querySelectorAll('.task-checkbox:checked').forEach(cb => {
                cb.checked = false;
                cb.closest('.task-item').classList.remove('selected');
            });
            console.log('Processing complete – cleared task selections');
        }
        prevProcessingInProgress = processingStatus.inProgress;
        
        // Update all button states based on processing status
        updateAllButtonStates();
    } catch (error) {
        console.error('Failed to update processing status:', error);
    }
}

// Update matching files
async function updateMatchingFiles() {
    try {
        const response = await fetch('/api/matching-files');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        matchingFiles = await response.json();
        renderMatchingFiles();
    } catch (error) {
        console.error('Failed to update matching files:', error);
    }
}

// Render disks
function renderDisks() {
    const container = document.getElementById('disks-container');
    
    if (disks.length === 0) {
        container.innerHTML = '<p class="no-matches">No SSDs detected. Please insert SSDs to begin.</p>';
        return;
    }
    
    let html = '';
    
    disks.forEach(disk => {
        // Ensure brawFiles is not null or undefined
        const brawFiles = disk.brawFiles || [];
        
        html += `
            <div class="disk-card ${disk.selected ? 'selected' : ''}" data-id="${disk.identifier}">
                <div class="disk-header">
                    <div class="disk-name">${disk.name || 'Unnamed Disk'}</div>
                    <input type="checkbox" class="disk-select" ${disk.selected ? 'checked' : ''}>
                </div>
                <div class="disk-info">
                    <p><strong>Identifier:</strong> ${disk.identifier}</p>
                    <p><strong>Size:</strong> ${disk.size}</p>
                    <p><strong>Mount Point:</strong> ${disk.mountPoint}</p>
                    <p><strong>BRAW Files:</strong> ${brawFiles.length}</p>
                </div>
                ${brawFiles.length > 0 ? `
                    <div class="disk-files">
                        <ul>
                            ${brawFiles.map(file => `<li>${file.split('/').pop()}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to disk cards
    document.querySelectorAll('.disk-card').forEach(card => {
        card.addEventListener('click', function(e) {
            // Don't toggle if clicking on the checkbox directly
            if (e.target.classList.contains('disk-select')) return;
            
            const checkbox = this.querySelector('.disk-select');
            checkbox.checked = !checkbox.checked;
            
            // Toggle selected class
            this.classList.toggle('selected', checkbox.checked);
            
            // Update matching files and button states when selection changes
            setTimeout(updateMatchingFiles, 100);
            updateAllButtonStates();
        });
        
        checkbox.addEventListener('change', function() {
            card.classList.toggle('selected', this.checked);
            
            // Update matching files and button states when selection changes
            setTimeout(updateMatchingFiles, 100);
            updateAllButtonStates();
        });
    });
}

// Render tasks
function renderTasks() {
    const container = document.getElementById('tasks-container');
    
    if (tasks.length === 0) {
        container.innerHTML = '<p class="loading">No tasks available.</p>';
        return;
    }
    
    let html = '';
    
    tasks.forEach(task => {
        html += `
            <div class="task-item ${task.selected ? 'selected' : ''}" data-id="${task.id}">
                <input type="checkbox" class="task-checkbox" ${task.selected ? 'checked' : ''}>
                <div class="task-info">
                    <div class="task-name">${task.name}</div>
                    <div class="task-description">${task.description}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to task items
    document.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('click', function(e) {
            // Don't toggle if clicking on the checkbox directly
            if (e.target.classList.contains('task-checkbox')) return;
            
            const checkbox = this.querySelector('.task-checkbox');
            checkbox.checked = !checkbox.checked;
            
            // Trigger change event to handle mutual exclusivity
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        
        // Add event listener to checkbox for mutual exclusivity
        const checkbox = item.querySelector('.task-checkbox');
        checkbox.addEventListener('change', function() {
            const taskId = item.dataset.id;
            const taskGroup = tasks.find(t => t.id === taskId)?.group;
            
            if (this.checked) {
                // If checking a task, uncheck all other tasks in the same group
                if (taskGroup) {
                    document.querySelectorAll('.task-checkbox').forEach(otherCheckbox => {
                        const otherItem = otherCheckbox.closest('.task-item');
                        const otherTaskId = otherItem.dataset.id;
                        const otherTask = tasks.find(t => t.id === otherTaskId);
                        if (otherCheckbox !== this && otherTask && otherTask.group === taskGroup) {
                            otherCheckbox.checked = false;
                            otherItem.classList.remove('selected');
                        }
                    });
                }
                // Mark this item as selected
                item.classList.add('selected');
            } else {
                // Allow unchecking
                item.classList.remove('selected');
            }
        });
    });
    
    updateAllButtonStates();  // Update all button states after setting up task event listeners
}

// Render processing status
function renderProcessingStatus() {
    const container = document.getElementById('status-container');
    const statusMessage = container.querySelector('.status-message');
    const progressBar = document.getElementById('progress-bar');
    const errorMessage = document.getElementById('error-message');
    
    statusMessage.textContent = processingStatus.message;
    progressBar.style.width = `${processingStatus.progress}%`;
    progressBar.textContent = `${processingStatus.progress}%`;
    
    if (processingStatus.error) {
        errorMessage.textContent = processingStatus.error;
        errorMessage.style.display = 'block';
    } else {
        errorMessage.style.display = 'none';
    }
}

// Render matching files
function renderMatchingFiles() {
    const container = document.getElementById('matching-files-container');
    
    if (Object.keys(matchingFiles).length === 0) {
        container.innerHTML = '<p class="no-matches">No matching recordings found yet. Select disks to find matches.</p>';
        return;
    }
    
    let html = '';
    
    for (const [base, files] of Object.entries(matchingFiles)) {
        html += `
            <div class="matching-group">
                <div class="matching-group-title">Recording: ${base}</div>
                <ul class="matching-files-list">
                    ${files.map(file => `<li>${file}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

// Start processing
async function startProcessing() {
    // Get selected disks
    const selectedDisks = Array.from(document.querySelectorAll('.disk-select:checked'))
        .map(checkbox => checkbox.closest('.disk-card').dataset.id);
    
    // Get selected tasks
    const selectedTasks = Array.from(document.querySelectorAll('.task-checkbox:checked'))
        .map(checkbox => checkbox.closest('.task-item').dataset.id);
    
    // Check if at least one disk and one task is selected
    if (selectedDisks.length === 0) {
        showError('Please select at least one disk to process.');
        return;
    }
    
    if (selectedTasks.length === 0) {
        showError('Please select at least one task to perform.');
        return;
    }
    
    try {
        const response = await fetch('/api/start-processing', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                selectedDisks,
                selectedTasks
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        }
        
        // Update status immediately
        updateProcessingStatus();
        updateAllButtonStates();  // Update all button states after starting processing
    } catch (error) {
        console.error('Failed to start processing:', error);
        showError(`Failed to start processing: ${error.message}`);
    }
}

// Find matches manually
async function findMatchesNow() {
    // Get selected disks
    const selectedDisks = Array.from(document.querySelectorAll('.disk-select:checked'))
        .map(checkbox => checkbox.closest('.disk-card').dataset.id);
    
    // Check if at least one disk is selected
    if (selectedDisks.length === 0) {
        showError('Please select at least one disk to find matches.');
        return;
    }
    
    try {
        // Update button state
        const findMatchesButton = document.getElementById('find-matches-button');
        if (findMatchesButton) {
            findMatchesButton.textContent = 'Searching...';
            findMatchesButton.disabled = true;
        }
        
        // Show searching message
        document.getElementById('matching-files-container').innerHTML = 
            '<p class="loading">Searching for matching recordings...</p>';
        
        const response = await fetch('/api/find-matches', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                selectedDisks
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        }
        
        // Update matching files with the response
        matchingFiles = await response.json();
        renderMatchingFiles();
        
        // Reset button state
        if (findMatchesButton) {
            findMatchesButton.textContent = 'Find Matches';
        }
        updateFindMatchesButtonState();
    } catch (error) {
        console.error('Failed to find matches:', error);
        showError(`Failed to find matches: ${error.message}`);
        
        // Reset button state with error
        const findMatchesButton = document.getElementById('find-matches-button');
        if (findMatchesButton) {
            findMatchesButton.textContent = 'Find Matches';
        }
        updateFindMatchesButtonState();
    }
}

// Show error message
function showError(message) {
    const errorMessage = document.getElementById('error-message');
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

// Add disk refresh button
function addDiskRefreshButton() {
    const container = document.querySelector('.disks-section h2') || 
                       document.getElementById('disks-container').previousElementSibling;
    
    if (container) {
        // Create refresh button if it doesn't exist
        if (!document.getElementById('refresh-disks-button')) {
            const refreshButton = document.createElement('button');
            refreshButton.id = 'refresh-disks-button';
            refreshButton.className = 'refresh-button';
            refreshButton.textContent = 'Scan for Disks';
            refreshButton.addEventListener('click', updateDiskStatus);
            
            // Insert after the heading
            container.parentNode.insertBefore(refreshButton, container.nextSibling);
        }
    }
}

// Add find matches button
function addFindMatchesButton() {
    const container = document.querySelector('.matching-files-section h2') || 
                       document.getElementById('matching-files-container').previousElementSibling;
    
    if (container) {
        // Create button if it doesn't exist
        if (!document.getElementById('find-matches-button')) {
            const findMatchesButton = document.createElement('button');
            findMatchesButton.id = 'find-matches-button';
            findMatchesButton.className = 'refresh-button';
            findMatchesButton.textContent = 'Find Matches';
            findMatchesButton.addEventListener('click', findMatchesNow);
            
            // Insert after the heading
            container.parentNode.insertBefore(findMatchesButton, container.nextSibling);
        }
    }
}