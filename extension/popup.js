// Socio.io Extension Popup Script
document.addEventListener('DOMContentLoaded', function() {
    console.log("Popup loaded");
    
    // Helper function to safely get elements
    function safeGetElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`Element with ID '${id}' not found in the DOM`);
        }
        return element;
    }
    
    // Helper function to safely add/remove classes
    function safeAddClass(element, className) {
        if (element && element.classList) {
            element.classList.add(className);
            return true;
        }
        return false;
    }
    
    function safeRemoveClass(element, className) {
        if (element && element.classList) {
            element.classList.remove(className);
            return true;
        }
        return false;
    }
    
    // Initialize protection toggle
    function initProtectionToggle() {
        const protectionToggle = safeGetElement('protectionToggle');
        const toggleStatus = safeGetElement('toggleStatus');
        
        if (!protectionToggle || !toggleStatus) return;
        
        // Get current state from storage
        chrome.storage.local.get(['enabled'], function(result) {
            const isEnabled = result.enabled !== undefined ? result.enabled : true;
            
            // Set initial toggle state
            protectionToggle.checked = isEnabled;
            toggleStatus.textContent = isEnabled ? 'ON' : 'OFF';
            toggleStatus.className = isEnabled ? 'toggle-status on' : 'toggle-status off';
            
            // Notify all tabs about the current state
            updateAllTabs(isEnabled);
        });
        
        // Add event listener for toggle changes
        protectionToggle.addEventListener('change', function() {
            const isEnabled = protectionToggle.checked;
            
            // Update UI
            toggleStatus.textContent = isEnabled ? 'ON' : 'OFF';
            toggleStatus.className = isEnabled ? 'toggle-status on' : 'toggle-status off';
            
            // Save to storage
            chrome.storage.local.set({ enabled: isEnabled });
            
            // Notify background script
            chrome.runtime.sendMessage({
                action: 'setEnabled',
                enabled: isEnabled
            });
            
            // Notify all tabs about the state change
            updateAllTabs(isEnabled);
        });
    }
    
    // Update all tabs with the current protection state
    function updateAllTabs(isEnabled) {
        console.log("Updating all tabs with protection state:", isEnabled);
        
        // First update the background script
        chrome.runtime.sendMessage({
            action: 'setEnabled',
            enabled: isEnabled
        }, function(response) {
            console.log("Background script response:", response);
        });
        
        // Then update all tabs
        chrome.tabs.query({}, function(tabs) {
            console.log(`Sending protection state to ${tabs.length} tabs`);
            
            for (let tab of tabs) {
                try {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'setEnabled',
                        enabled: isEnabled
                    }, function(response) {
                        // Ignore errors when content script isn't loaded
                        if (chrome.runtime.lastError) {
                            console.log(`Could not send message to tab ${tab.id}: ${chrome.runtime.lastError.message}`);
                        } else if (response) {
                            console.log(`Tab ${tab.id} response:`, response);
                        }
                    });
                } catch (e) {
                    console.error(`Error sending message to tab ${tab.id}:`, e);
                }
            }
        });
    }
    
    // Get references to UI elements using the safe method
    const statsContainer = safeGetElement('statsContainer');
    const historyContainer = safeGetElement('historyContainer');
    const recoveryContainer = safeGetElement('recoveryContainer');
    
    const statsBtn = safeGetElement('statsBtn');
    const historyBtn = safeGetElement('historyBtn');
    const recoveryBtn = safeGetElement('recoveryBtn');
    
    const textFilteredValue = safeGetElement('textFilteredValue');
    const imagesFilteredValue = safeGetElement('imagesFilteredValue');
    const totalFilteredValue = safeGetElement('totalFilteredValue');
    
    const historyList = safeGetElement('historyList');
    const encryptionFiles = safeGetElement('encryptionFiles');
    const recoveryResult = safeGetElement('recoveryResult');
    const recoveredText = safeGetElement('recoveredText');
    
    const startRecoveryBtn = safeGetElement('startRecoveryBtn');
    const copyRecoveryBtn = safeGetElement('copyRecoveryBtn');
    const resetStatsBtn = safeGetElement('resetStatsBtn');
    const setupBtn = safeGetElement('setupBtn');
    const backendStatus = safeGetElement('backendStatus');
    
    // Check if critical elements exist
    if (!statsContainer || !historyContainer || !recoveryContainer || 
        !statsBtn || !historyBtn || !recoveryBtn) {
        console.error("Critical UI elements missing in popup.html");
        document.body.innerHTML = '<div class="error-message">Extension UI error: Missing critical elements. Please check popup.html and reinstall the extension.</div>';
        return;
    }
    
    // Initialize the popup
    initializePopup();
    
    // Set up tab switching
    setupTabSwitching();
    
    // Load stats, history, and recovery data
    loadStats();
    loadHistory();
    loadRecoveryOptions();
    
    // Set up button event listeners
    setupButtonListeners();
    
    // Function to initialize the popup
    function initializePopup() {
        console.log("Initializing popup");
        
        // Show stats tab by default
        showTab('stats');
        
        // Check backend status
        checkBackendStatus();
    }
    
    // Function to set up tab switching
    function setupTabSwitching() {
        if (statsBtn) {
            statsBtn.addEventListener('click', function() {
                showTab('stats');
                loadStats(); // Refresh stats when tab is clicked
            });
        }
        
        if (historyBtn) {
            historyBtn.addEventListener('click', function() {
                showTab('history');
                loadHistory(); // Refresh history when tab is clicked
            });
        }
        
        if (recoveryBtn) {
            recoveryBtn.addEventListener('click', function() {
                showTab('recovery');
                loadRecoveryOptions(); // Refresh recovery options when tab is clicked
            });
        }
    }
    
    // Function to show a specific tab
    function showTab(tabName) {
        // Hide all containers
        safeAddClass(statsContainer, 'hidden');
        safeAddClass(historyContainer, 'hidden');
        safeAddClass(recoveryContainer, 'hidden');
        
        // Remove active class from all buttons
        safeRemoveClass(statsBtn, 'active');
        safeRemoveClass(historyBtn, 'active');
        safeRemoveClass(recoveryBtn, 'active');
        
        // Show the selected container and mark button as active
        if (tabName === 'stats') {
            safeRemoveClass(statsContainer, 'hidden');
            safeAddClass(statsBtn, 'active');
        } else if (tabName === 'history') {
            safeRemoveClass(historyContainer, 'hidden');
            safeAddClass(historyBtn, 'active');
        } else if (tabName === 'recovery') {
            safeRemoveClass(recoveryContainer, 'hidden');
            safeAddClass(recoveryBtn, 'active');
        }
    }
    
    // Function to load stats
    function loadStats() {
        console.log("Loading stats");
        
        if (!textFilteredValue || !imagesFilteredValue || !totalFilteredValue) {
            console.error("Stats elements missing");
            return;
        }
        
        chrome.storage.local.get(['textFiltered', 'imagesFiltered'], function(result) {
            const textCount = parseInt(result.textFiltered) || 0;
            const imagesCount = parseInt(result.imagesFiltered) || 0;
            const totalCount = textCount + imagesCount;
            
            console.log("Stats loaded:", textCount, imagesCount, totalCount);
            
            // Update the UI
            textFilteredValue.textContent = textCount;
            imagesFilteredValue.textContent = imagesCount;
            totalFilteredValue.textContent = totalCount;
        });
    }
    
    // Function to load history
    function loadHistory() {
        console.log("Loading history");
        
        if (!historyList) {
            console.error("History list element missing");
            return;
        }
        
        // Clear the loading message
        historyList.innerHTML = '';
        
        // Get history from storage
        chrome.storage.local.get(['filterHistory'], function(result) {
            const history = result.filterHistory || [];
            
            if (history.length === 0) {
                historyList.innerHTML = '<div class="empty-message">No filtering history yet.</div>';
                return;
            }
            
            // Group history by domain
            const historyByDomain = {};
            
            history.forEach(item => {
                const domain = item.domain || 'Unknown';
                if (!historyByDomain[domain]) {
                    historyByDomain[domain] = [];
                }
                historyByDomain[domain].push(item);
            });
            
            // Display history grouped by domain
            for (const domain in historyByDomain) {
                const domainGroup = document.createElement('div');
                domainGroup.className = 'domain-group';
                
                const domainTitle = document.createElement('div');
                domainTitle.className = 'domain-title';
                domainTitle.textContent = domain;
                domainGroup.appendChild(domainTitle);
                
                historyByDomain[domain].forEach(item => {
                    const historyItem = document.createElement('div');
                    historyItem.className = 'content-item';
                    
                    const timestamp = new Date(item.timestamp).toLocaleString();
                    const contentType = item.type === 'text' ? 'Text' : 'Image';
                    const preview = item.content.substring(0, 50) + (item.content.length > 50 ? '...' : '');
                    
                    historyItem.innerHTML = `
                        <div class="content-preview">${contentType}: ${preview}</div>
                        <div class="content-timestamp">${timestamp}</div>
                    `;
                    
                    domainGroup.appendChild(historyItem);
                });
                
                historyList.appendChild(domainGroup);
            }
        });
    }
    
    // Function to load recovery options
    function loadRecoveryOptions() {
        console.log("Loading recovery options");
        
        if (!encryptionFiles || !recoveryResult || !recoveredText || 
            !startRecoveryBtn || !copyRecoveryBtn) {
            console.error("Recovery elements missing");
            return;
        }
        
        // Clear previous options
        encryptionFiles.innerHTML = '';
        
        // Get encrypted content from storage
        chrome.storage.local.get(['encryptedContent'], function(result) {
            const encryptedItems = result.encryptedContent || [];
            
            if (encryptedItems.length === 0) {
                encryptionFiles.innerHTML = '<div class="empty-message">No encrypted content available for recovery.</div>';
                safeAddClass(startRecoveryBtn, 'hidden');
                safeAddClass(copyRecoveryBtn, 'hidden');
                return;
            }
            
            // Create select dropdown
            const select = document.createElement('select');
            select.id = 'encryptionSelect';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select content to recover...';
            select.appendChild(defaultOption);
            
            // Add options for each encrypted item
            encryptedItems.forEach((item, index) => {
                const option = document.createElement('option');
                option.value = index;
                
                const timestamp = new Date(item.timestamp).toLocaleString();
                const preview = item.preview || 'Encrypted content';
                
                option.textContent = `${preview} (${timestamp})`;
                select.appendChild(option);
            });
            
            encryptionFiles.appendChild(select);
            
            // Add change event listener to the select
            select.addEventListener('change', function() {
                const selectedIndex = this.value;
                
                if (selectedIndex === '') {
                    safeAddClass(recoveryResult, 'hidden');
                    safeAddClass(startRecoveryBtn, 'hidden');
                    safeAddClass(copyRecoveryBtn, 'hidden');
                    return;
                }
                
                const selectedItem = encryptedItems[selectedIndex];
                
                // Show the encrypted content
                safeRemoveClass(recoveryResult, 'hidden');
                if (recoveredText) {
                    recoveredText.textContent = selectedItem.content;
                }
                
                // Show the recovery buttons
                safeRemoveClass(startRecoveryBtn, 'hidden');
                safeRemoveClass(copyRecoveryBtn, 'hidden');
            });
        });
    }
    
    // Function to set up button event listeners
    function setupButtonListeners() {
        // Reset stats button
        if (resetStatsBtn) {
            resetStatsBtn.addEventListener('click', function() {
                if (confirm('Are you sure you want to reset all filtering statistics?')) {
                    chrome.storage.local.set({
                        'textFiltered': 0,
                        'imagesFiltered': 0
                    }, function() {
                        console.log('Stats reset');
                        loadStats();
                    });
                }
            });
        }
        
        // Setup button
        if (setupBtn) {
            setupBtn.addEventListener('click', function() {
                chrome.tabs.create({url: 'setup.html'});
            });
        }
        
        // Start recovery button
        if (startRecoveryBtn) {
            startRecoveryBtn.addEventListener('click', function() {
                const select = document.getElementById('encryptionSelect');
                if (!select) {
                    console.error("Encryption select element not found");
                    return;
                }
                
                const selectedIndex = select.value;
                
                if (selectedIndex === '') {
                    return;
                }
                
                chrome.storage.local.get(['encryptedContent'], function(result) {
                    const encryptedItems = result.encryptedContent || [];
                    const selectedItem = encryptedItems[selectedIndex];
                    
                    // Send message to content script to apply the recovered content
                    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'applyRecoveredContent',
                            content: selectedItem.content,
                            selector: selectedItem.selector
                        }, function(response) {
                            if (chrome.runtime.lastError) {
                                console.error('Error applying recovered content:', chrome.runtime.lastError);
                                alert('Error applying recovered content: ' + chrome.runtime.lastError.message);
                                return;
                            }
                            
                            if (response && response.success) {
                                alert('Content successfully applied to the page!');
                            } else {
                                alert('Could not apply content to the page. The element may no longer exist.');
                            }
                        });
                    });
                });
            });
        }
        
        // Copy recovery button
        if (copyRecoveryBtn && recoveredText) {
            copyRecoveryBtn.addEventListener('click', function() {
                const text = recoveredText.textContent;
                
                // Copy to clipboard
                navigator.clipboard.writeText(text).then(function() {
                    alert('Content copied to clipboard!');
                }, function(err) {
                    console.error('Could not copy text:', err);
                    alert('Failed to copy content: ' + err);
                });
            });
        }
    }
    
    // Function to check backend status
    function checkBackendStatus() {
        console.log("Checking backend status");
        
        if (!backendStatus) {
            console.error("Backend status element missing");
            return;
        }
        
        fetch('https://socio-backend-zxxd.onrender.com/ping')
            .then(response => response.json())
            .then(data => {
                console.log("Backend is running:", data);
                backendStatus.textContent = 'Connected';
                backendStatus.className = 'status-good';
            })
            .catch(error => {
                console.log("Backend connection error:", error);
                backendStatus.textContent = 'Disconnected';
                backendStatus.className = 'status-bad';
            });
    }
    
    // Initialize components
    initProtectionToggle();
    loadStats();
    setupTabSwitching();
    setupButtonListeners();
    checkBackendStatus();
});