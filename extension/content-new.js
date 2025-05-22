/**
 * Socio.io Content Moderation - Content Script
 * ---------------------------------------------
 * This script analyzes and moderates web page content including text and images.
 * It integrates with a backend API for sophisticated content analysis and only
 * filters content that's deemed problematic based on the analysis results.
 */

// ================ CONFIGURATION ================

const config = {
    // API endpoints
    api: {
        baseUrl: 'https://socio-backend-zxxd.onrender.com',
        localUrl: 'http://localhost:5000',
        imageAnalysisPath: '/analyze_image',
        textAnalysisPath: '/analyze_text',
        pingPath: '/ping'
    },

    // Processing settings
    processing: {
        batchSize: 10,           // Process elements in small batches
        queueInterval: 200,      // Interval between batch processing
        initialDelay: 1000,      // Delay before initial scan
        elementDelay: 50         // Delay between processing elements
    },

    // UI settings
    ui: {
        transitionDuration: 300, // Duration for visual transitions
        temporaryBlur: 5,        // Light blur for suspicious content
        fullBlur: 20             // Strong blur for confirmed unsafe content
    },

    // CSS class names
    classes: {
        processed: 'socioio-processed',
        analyzing: 'socioio-analyzing',
        filtered: 'socioio-filtered',
        indicator: 'socioio-indicator',
        overlay: 'socioio-overlay',
        wrapper: 'socioio-wrapper'
    },

    // Selectors for content
    selectors: {
        text: 'p, h1, h2, h3, h4, h5, h6, span, div:not(:has(*)), a, li, td, th, blockquote, pre, code',
        images: 'img',
        uiElements: [
            'button', '[role="button"]', '.btn', '.button', '.nav-item',
            '.logo', '.header', '.footer', '.navigation', '.menu'
        ]
    },

    // Lists of sources and keywords
    lists: {
        safeImageSources: [
            'wikipedia.org',
            'wikimedia.org',
            'github.com',
            'googleusercontent.com/a/',
            'gravatar.com',
            'ytimg.com',
            'twimg.com',
            'fbcdn.net',
            'linkedin.com/media'
        ],
        sensitiveKeywords: [
            'nsfw', 'adult', 'xxx', 'porn', 'nude', 'sex'
        ]
    }
};
// ================ STATE MANAGEMENT ================

// Global state object
const state = {
    enabled: true,                 // Whether the extension is enabled
    backendAvailable: true,        // Whether the backend is available
    processedElements: new Set(),  // Set of processed elements
    processingQueue: [],           // Queue of elements to process
    currentlyProcessing: false,    // Whether processing is in progress
    scanIntervals: {               // Interval IDs for periodic scans
        content: null,
        images: null,
        backendCheck: null
    }
};

// ================ UTILITY FUNCTIONS ================

/**
 * Log debug messages with timestamp
 * @param {string} message - The message to log
 * @param {any} [data] - Optional data to log
 */
function debug(message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = '[Socio.io]';

    if (data) {
        console.log(`${prefix} ${timestamp}:`, message, data);
    } else {
        console.log(`${prefix} ${timestamp}:`, message);
    }
}

/**
 * Safely add a class to an element
 * @param {Element} element - DOM element
 * @param {string} className - CSS class to add
 * @returns {boolean} - Whether the operation was successful
 */
function safelyAddClass(element, className) {
    if (element && element.classList) {
        element.classList.add(className);
        return true;
    }
    return false;
}

/**
 * Safely remove a class from an element
 * @param {Element} element - DOM element
 * @param {string} className - CSS class to remove
 * @returns {boolean} - Whether the operation was successful
 */
function safelyRemoveClass(element, className) {
    if (element && element.classList) {
        element.classList.remove(className);
        return true;
    }
    return false;
}

/**
 * Create a debounced function
 * @param {Function} func - The function to debounce
 * @param {number} wait - The debounce delay in milliseconds
 * @returns {Function} - The debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}
// ================ BACKEND INTEGRATION ================

/**
 * Check if the backend API is available
 * @returns {Promise<boolean>} - Whether the backend is available
 */
async function checkBackendAvailability() {
    try {
        // Try the cloud backend first
        const response = await fetch(`${config.api.baseUrl}${config.api.pingPath}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            debug("Cloud backend available");
            return true;
        }

        // Try the local backend as fallback
        const localResponse = await fetch(`${config.api.localUrl}${config.api.pingPath}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (localResponse.ok) {
            debug("Local backend available");
            return true;
        }

        debug("Backend unavailable");
        return false;
    } catch (error) {
        debug("Error checking backend availability:", error);
        return false;
    }
}

/**
 * Analyze text content using the backend API
 * @param {string} text - The text to analyze
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeText(text) {
    if (!text || text.trim().length < 5) {
        return { action: "allow", reasons: ["Text too short"] };
    }

    try {
        const baseUrl = state.backendAvailable ? config.api.baseUrl : config.api.localUrl;
        const response = await fetch(`${baseUrl}${config.api.textAnalysisPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                url: window.location.href
            })
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const result = await response.json();
        debug("Text analysis result:", result);
        return result;
    } catch (error) {
        debug("Error analyzing text:", error);

        // Basic fallback analysis for critical cases when backend fails
        return performBasicTextAnalysis(text);
    }
}

/**
 * Analyze image content using the backend API
 * @param {string} imageUrl - URL of the image to analyze
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeImage(imageUrl) {
    if (!imageUrl) {
        return { action: "allow", reasons: ["No image URL"] };
    }

    try {
        const baseUrl = state.backendAvailable ? config.api.baseUrl : config.api.localUrl;
        const response = await fetch(`${baseUrl}${config.api.imageAnalysisPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_url: imageUrl,
                url: window.location.href
            })
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const result = await response.json();
        debug("Image analysis result:", result);
        return result;
    } catch (error) {
        debug("Error analyzing image:", error);

        // Basic fallback for image analysis
        return {
            action: "allow",  // Default to allowing images when analysis fails
            reasons: ["Analysis failed, allowing by default"]
        };
    }
}

/**
 * Basic text analysis for when backend is unavailable
 * @param {string} text - Text to analyze
 * @returns {Object} - Analysis results
 */
function performBasicTextAnalysis(text) {
    const lowerText = text.toLowerCase();

    // Initialize the extension
    function initialize() {
        debug("Initializing Socio.io content moderation");

        try {
            // Always assume enabled for testing
            isEnabled = true;
            backendRunning = true;

            // Add styles for tooltips and overlays
            injectStyles();

            // Set up message listener
            setupMessageListener();

            // Set up observer
            setupObserver();

            // Tell background script we're active and check backend status
            notifyBackgroundScript();

            // Set up periodic backend status check
            setupBackendStatusCheck();

            // Set up mutation observer to detect new images
            setupImageMutationObserver();

            // Check if we should be enabled (and wait for this before proceeding)
            chrome.storage.local.get(['enabled'], function (result) {
                try {
                    isEnabled = result.enabled !== false;  // Default to true if not set
                    debug("Protection enabled:", isEnabled);

                    // Only proceed with content filtering if enabled
                    if (isEnabled) {
                        // Add delay before starting filtering for better UX
                        setTimeout(() => {
                            debug("Starting content filtering after initial delay");

                            // Scan the page for content after delay
                            scanContentForModeration();

                            // Set up a periodic scan with increased interval
                            window.socioIntervalScan = setInterval(() => {
                                if (isEnabled) {
                                    scanContentForModeration();
                                }
                            }, 5000); // Increased from 3000 to 5000ms

                            // Less frequent image scans
                            window.socioIntervalImageScan = setInterval(() => {
                                if (isEnabled) {
                                    scanImagesForModeration();
                                }
                            }, 3000); // Increased from 1000 to 3000ms
                        }, INITIAL_DELAY);
                    }
                } catch (innerError) {
                    console.error("Error getting enabled state:", innerError);
                    isEnabled = true;
                }
            });
        } catch (error) {
            console.error("Error during extension initialization:", error);
        }

        // Try to continue with basic functionality
        try {
            setupObserver();
            applyImmediateBlurToAllImages();
        } catch (e) {
            console.error("Fatal error in extension initialization:", e);
        }
    }
}

// Set up message listener
function setupMessageListener() {
    debug("Setting up message listener");

    // Listen for messages from popup or background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            debug("Received message:", message);

            switch (message.action) {
                case 'toggleProtection':
                case 'setEnabled':
                    const previousState = isEnabled;
                    isEnabled = message.enabled;
                    debug("Protection toggled from", previousState, "to:", isEnabled);

                    if (isEnabled && !previousState) {
                        // Protection was turned on
                        debug("Protection turned ON - starting content moderation");

                        // Start the intervals if they don't exist
                        if (!window.socioIntervalScan) {
                            window.socioIntervalScan = setInterval(() => {
                                if (isEnabled) {
                                    debug("Performing periodic scan");
                                    scanContentForModeration();
                                }
                            }, 3000);
                        }

                        if (!window.socioIntervalImageScan) {
                            window.socioIntervalImageScan = setInterval(() => {
                                if (isEnabled) {
                                    debug("Performing image-only scan");
                                    scanImagesForModeration();
                                }
                            }, 1000);
                        }

                        // Perform an immediate scan
                        scanContentForModeration();
                    } else if (!isEnabled && previousState) {
                        // Protection was turned off
                        debug("Protection turned OFF - stopping content moderation and restoring content");

                        // Clear the intervals
                        if (window.socioIntervalScan) {
                            clearInterval(window.socioIntervalScan);
                            window.socioIntervalScan = null;
                        }

                        if (window.socioIntervalImageScan) {
                            clearInterval(window.socioIntervalImageScan);
                            window.socioIntervalImageScan = null;
                        }

                        // Restore all original content
                        restoreOriginalContent();
                    }

                    // Save the state to storage
                    chrome.storage.local.set({ enabled: isEnabled });

                    sendResponse({ status: "Protection toggled", enabled: isEnabled });
                    break;

                case 'getEncryptedContent':
                    // Find all encrypted content on the page
                    const encryptedContent = Array.from(document.querySelectorAll('.socioio-encrypted'))
                        .map(el => el.textContent)
                        .join('\n');

                    debug("Found encrypted content:", encryptedContent);
                    sendResponse({ encryptedContent });
                    break;

                case 'applyRecoveredContent':
                    applyRecoveredContent(message.recoveredText);
                    sendResponse({ status: "Content recovered" });
                    break;

                case 'checkStatus':
                    debug("Status check requested");
                    sendResponse({
                        status: "Content script active",
                        isEnabled: isEnabled,
                        backendRunning: backendRunning,
                        elementsScanned: textElementsProcessed.size + imageElementsProcessed.size,
                        queueLength: processingQueue.length
                    });
                    break;

                case 'backendStatusChanged':
                    debug("Backend status changed:", message.running);
                    backendRunning = message.running;

                    // If backend is now running and we're enabled, start scanning
                    if (backendRunning && isEnabled) {
                        scanContentForModeration();
                    }

                    sendResponse({ status: "Backend status updated" });
                    break;

                default:
                    debug("Unknown message action:", message.action);
                    sendResponse({ status: "Unknown action" });
                    break;
            }

            return true;  // Indicates async response
        } catch (messageError) {
            console.error("Error handling message:", messageError);
            // If we get an extension context invalidated error, we can't do anything
            if (messageError.message && messageError.message.includes("Extension context invalidated")) {
                console.log("Extension context was invalidated. Please refresh the page.");
            }
            sendResponse({ error: "Error processing message", message: messageError.message });
            return true;
        }
    });

    debug("Message listener set up successfully");
}

// Set up periodic backend status check
function setupBackendStatusCheck() {
    // Clear any existing timer
    if (backendCheckTimer) {
        clearInterval(backendCheckTimer);
    }

    // Check backend status immediately
    checkBackendStatus();

    // Set up periodic check
    backendCheckTimer = setInterval(checkBackendStatus, BACKEND_CHECK_INTERVAL);
}

// Check backend status
function checkBackendStatus() {
    // Always assume backend is running for testing purposes
    // This ensures content filtering works even if backend is down
    backendRunning = true;

    try {
        // First try a direct ping to the backend using the simple ping endpoint
        fetch(`${API_BASE_URL}/ping`)
            .then(response => response.json())
            .then(data => {
                debug("Backend connection test successful:", data);
                backendRunning = true;

                // Notify background script that backend is running
                try {
                    chrome.runtime.sendMessage({
                        action: "backendStatus",
                        status: true
                    });
                } catch (e) {
                    debug("Error sending backend status to background:", e);
                }

                // If we're enabled and not currently scanning, start scanning
                if (isEnabled) {
                    // Always scan for images when backend is confirmed running
                    scanImagesForModeration();

                    // Also do a full scan if queue is empty
                    if (processingQueue.length === 0) {
                        scanContentForModeration();
                    }
                }
            })
            .catch(error => {
                debug("Backend connection test failed:", error);
                // Keep backendRunning true for testing

                try {
                    // Notify background script about backend connection issue
                    chrome.runtime.sendMessage({ action: "backendConnectionIssue" }, function (response) {
                        if (chrome.runtime.lastError) {
                            debug("Error sending message to background:", chrome.runtime.lastError);
                            return;
                        }
                        debug("Backend connection issue notification response:", response);
                    });
                } catch (msgError) {
                    debug("Failed to send message to background script:", msgError);
                    // If extension context is invalidated, we can't do anything
                    if (msgError.message && msgError.message.includes("Extension context invalidated")) {
                        console.log("Extension context was invalidated. Please refresh the page.");
                    }
                }

                // Even if backend is down, still scan for client-side filtering
                if (isEnabled) {
                    scanImagesForModeration();
                }
            });
    } catch (fetchError) {
        debug("Error during backend status check:", fetchError);
        // Keep backendRunning true for testing

        // Even if backend check fails, still scan for client-side filtering
        if (isEnabled) {
            scanImagesForModeration();
        }
    }
}

// Notify the background script that we're active
function notifyBackgroundScript() {
    chrome.runtime.sendMessage({
        action: 'contentScriptActive',
        url: window.location.href
    }, function (response) {
        if (chrome.runtime.lastError) {
            debug("Error notifying background script:", chrome.runtime.lastError);
        } else {
            debug("Background script notified:", response);

            // Update backend status from response
            if (response && response.backendRunning !== undefined) {
                backendRunning = response.backendRunning;
                debug("Backend status from background:", backendRunning);

                // If backend is running and we're enabled, start scanning
                if (backendRunning && isEnabled) {
                    scanContentForModeration();
                }
            }
        }
    });
}

// Set up mutation observer to detect new content
function setupObserver() {
    debug("Setting up mutation observer");

    // Create an observer instance with improved handling
    const observer = new MutationObserver((mutations) => {
        if (!isEnabled) return;

        let hasNewImages = false;
        let hasNewText = false;

        // Check what types of content were added
        for (const mutation of mutations) {
            // Check for added nodes
            if (mutation.addedNodes && mutation.addedNodes.length) {
                for (const node of mutation.addedNodes) {
                    // Check if this is an element node
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if this is an image
                        if (node.tagName === 'IMG') {
                            hasNewImages = true;
                        }

                        // Check if this node contains images
                        if (node.querySelectorAll) {
                            const images = node.querySelectorAll('img');
                            if (images.length > 0) {
                                hasNewImages = true;
                            }

                            // Check for text elements
                            const textElements = node.querySelectorAll(TEXT_SELECTORS);
                            if (textElements.length > 0) {
                                hasNewText = true;
                            }
                        }
                    }
                }
            }

            // Check for attribute changes on images (src changes)
            if (mutation.type === 'attributes' &&
                mutation.target.tagName === 'IMG' &&
                mutation.attributeName === 'src') {
                hasNewImages = true;
            }
        }

        // Process immediately if we have new images
        if (hasNewImages) {
            debug("New images detected, scanning immediately");
            // Process only images for immediate response
            scanImagesForModeration();
        }

        // Use debounce for text and general scanning
        if (hasNewText || mutations.length > 0) {
            debounce(() => {
                debug("DOM changed, scanning for all content");
                scanContentForModeration();
            }, DEBOUNCE_DELAY)();
        }
    });

    // Start observing with expanded options
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['src'] // Only care about src attribute changes
    });

    debug("Enhanced mutation observer set up");

    // Set up multiple handlers to catch all possible image loading scenarios

    // 1. Capture load events for images
    document.addEventListener('load', function (event) {
        if (event.target.tagName === 'IMG' && isEnabled) {
            debug("Image load event detected");
            processNewImage(event.target);
        }
    }, true); // Use capture to get the event before it reaches the target

    // 2. Watch for src attribute changes on images
    document.addEventListener('DOMAttrModified', function (event) {
        if (event.target.tagName === 'IMG' && event.attrName === 'src' && isEnabled) {
            debug("Image src attribute changed");
            processNewImage(event.target);
        }
    }, true);

    // 3. Set up a MutationObserver specifically for images
    const imageObserver = new MutationObserver(function (mutations) {
        if (!isEnabled) return;

        for (const mutation of mutations) {
            // Check for new nodes
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    // If it's an image, process it
                    if (node.tagName === 'IMG') {
                        debug("New image added to DOM");
                        processNewImage(node);
                    }

                    // Also check for images inside the added node
                    if (node.nodeType === 1) { // Element node
                        const images = node.querySelectorAll('img');
                        for (const img of images) {
                            debug("Found image inside new DOM node");
                            processNewImage(img);
                        }
                    }
                }
            }

            // Check for attribute changes
            if (mutation.type === 'attributes' &&
                mutation.attributeName === 'src' &&
                mutation.target.tagName === 'IMG') {
                debug("Image src attribute changed via mutation");
                processNewImage(mutation.target);
            }
        }
    });

    // Start observing with expanded options
    imageObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
    });

    debug("Image load event listener added");
}

// Debounce function to prevent too many scans
function debounce(func, wait) {
    let timeout;
    return function () {
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Queue all images for analysis (without immediate blurring)
// Replace the applyImmediateBlurToAllImages function with a non-blurring version
function applyImmediateBlurToAllImages() {
    try {
        // Find all images on the page
        const images = document.querySelectorAll('img');
        debug(`Found ${images.length} images to queue for analysis`);

        // Keywords that might indicate sensitive content
        const sensitiveKeywords = ["nsfw", "adult", "xxx", "porn", "nude", "sex"];

        let batchSize = 10; // Process 10 images at a time
        let blurredCount = 0;

        // Function to process a batch of images
        function processImageBatch(startIndex) {
            const endIndex = Math.min(startIndex + batchSize, images.length);

            for (let i = startIndex; i < endIndex; i++) {
                const img = images[i];

                try {
                    // Skip very small images - they're likely icons or UI elements
                    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
                        continue;
                    }

                    // Skip images from known safe sources
                    const safeImageSources = [
                        'wikipedia.org',
                        'wikimedia.org',
                        'github.com',
                        'googleusercontent.com/a/',
                        'gravatar.com',
                        'maps.gstatic.com',
                        'schema.org',
                        'w3.org',
                        'placeholder.com'
                    ];

                    const src = img.src.toLowerCase();
                    const alt = (img.alt || "").toLowerCase();
                    const isFromSafeSource = safeImageSources.some(source => src.includes(source));

                    if (isFromSafeSource) {
                        continue;
                    }

                    // Only blur initially if URL or alt text contains sensitive keywords
                    const mightBeSensitive = sensitiveKeywords.some(keyword =>
                        src.includes(keyword) || alt.includes(keyword)
                    );

                    // If on a page with "porn", "xxx", etc. in the URL, be more aggressive
                    const pageUrlLower = window.location.href.toLowerCase();
                    const isSensitivePage = sensitiveKeywords.some(keyword =>
                        pageUrlLower.includes(keyword)
                    );

                    // Apply immediate blur only if potentially sensitive or on a sensitive page
                    if (mightBeSensitive || isSensitivePage) {
                        debug("Applying immediate blur to potentially sensitive image:", img.src);

                        // Queue for proper analysis instead of immediate blur
                        processingQueue.push({
                            type: 'image',
                            element: img,
                            priority: 'high'
                        });

                        imageElementsProcessed.add(img);
                    } else {
                        // Queue this image for proper backend analysis
                        if (!imageElementsProcessed.has(img)) {
                            processingQueue.push({
                                type: 'image',
                                element: img
                            });
                            imageElementsProcessed.add(img);
                        }
                    }
                } catch (imgError) {
                    debug("Error processing image in batch:", imgError);
                }
            }

            // If there are more images to process, schedule the next batch
            if (endIndex < images.length) {
                setTimeout(() => {
                    processImageBatch(endIndex);
                }, 50); // Small delay between batches
            } else {
                debug(`Finished initial image processing. Queued ${blurredCount} potentially sensitive images`);

                // Process queue
                if (typeof processingQueue !== 'undefined' &&
                    processingQueue.length > 0 &&
                    typeof processNextBatch === 'function') {
                    processNextBatch();
                }
            }
        }

        // Start processing the first batch
        processImageBatch(0);

    } catch (error) {
        debug("Error in applyImmediateBlurToAllImages:", error);
    }
}
// Process a newly loaded image immediately with aggressive filtering
function processNewImage(imageElement) {
    try {
        if (!isEnabled) return;

        // Skip if already processed
        if (imageElement.classList.contains(EXCLUSION_CLASS) ||
            imageElementsProcessed.has(imageElement)) {
            return;
        }

        debug("Processing newly loaded image:", imageElement.src);

        // Skip images without a source
        if (!imageElement.src) return;

        // Mark as processed
        imageElementsProcessed.add(imageElement);
        imageElement.classList.add(EXCLUSION_CLASS);

        // Apply immediate blur to all images (we'll remove it later if needed)
        // This ensures images are blurred as soon as they appear
        applyImmediateImageBlur(imageElement);

        // Process immediately without adding to queue
        processElement({
            type: 'image',
            element: imageElement
        }).then(result => {
            debug("Immediate image processing result:", result);
        }).catch(error => {
            debug("Error in immediate image processing:", error);
        });
    } catch (error) {
        debug("Error processing new image:", error);
    }
}

// Apply immediate blur to images for faster response
function applyImmediateImageBlur(imageElement) {
    try {
        // Skip very small images
        if (imageElement.naturalWidth < 50 || imageElement.naturalHeight < 50) {
            return;
        }

        // Skip images from known safe sources
        const safeImageSources = [
            'wikipedia.org',
            'wikimedia.org',
            'github.com',
            'googleusercontent.com/a/',
            'gravatar.com'
        ];

        const src = imageElement.src.toLowerCase();
        const isFromSafeSource = safeImageSources.some(source => src.includes(source));

        if (isFromSafeSource) {
            return;
        }

        // Always blur images for testing purposes (100% chance)
        debug("Applying immediate blur to image:", imageElement.src);
        imageElement.style.filter = "blur(20px)";
        imageElement.style.border = "3px solid red";

        // Mark as filtered
        imageElement.setAttribute('data-socioio-filtered', 'true');

        // Update stats
        try {
            chrome.runtime.sendMessage({
                action: 'updateStats',
                type: 'images',
                count: 1
            }, function (response) {
                debug("Stats update response:", response);
            });
        } catch (e) {
            debug("Error updating stats:", e);

            // Try direct storage update as fallback
            try {
                chrome.storage.local.get(['imagesFiltered'], function (result) {
                    const current = parseInt(result.imagesFiltered) || 0;
                    chrome.storage.local.set({ 'imagesFiltered': current + 1 });
                });
            } catch (storageError) {
                debug("Error updating storage:", storageError);
            }
        }
    } catch (error) {
        debug("Error in immediate image blur:", error);
    }
}

// Process an image for moderation
// Replace your processImage function with this improved version
function processImage(img) {
    // Skip if null or already processed
    if (!img || (img.classList && img.classList.contains(EXCLUSION_CLASS))) {
        return;
    }

    // Skip very small images (UI elements)
    if (img.width < 100 || img.height < 100) {
        return;
    }

    // Mark as being processed to prevent duplicate processing
    img.classList.add(EXCLUSION_CLASS);

    // Only apply temporary, lighter blur while waiting for backend analysis
    const tempStyle = img.getAttribute('style') || '';
    img.setAttribute('data-original-style', tempStyle);
    img.style.transition = `filter ${UI_TRANSITION_DURATION}ms ease`;

    // Add a subtle indicator that image is being analyzed
    img.style.border = "1px dashed #ccc";
    img.setAttribute('data-socioio-analyzing', 'true');

    // Instead of auto-blurring, send to backend for analysis first
    if (backendRunning) {
        fetch(`${API_BASE_URL}/analyze_image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: img.src, url: window.location.href })
        })
            .then(response => response.json())
            .then(data => {
                // Remove analyzing indicator
                img.removeAttribute('data-socioio-analyzing');

                // Only blur if the analysis indicates it should be filtered
                if (data.overall_safety === "unsafe" || data.overall_safety === "questionable") {
                    debug("Applying blur based on analysis");
                    img.style.filter = "blur(20px)";
                    img.style.border = "3px solid red";
                    addOverlayToImage(img);
                    updateStats('image');
                } else {
                    // If safe, remove any temporary styling
                    img.style = img.getAttribute('data-original-style') || '';
                }
            })
            .catch(error => {
                debug("Error analyzing image, removing temporary blur:", error);
                // Remove analyzing indicator
                img.removeAttribute('data-socioio-analyzing');
                // Don't blur if analysis fails - better user experience
                img.style = img.getAttribute('data-original-style') || '';
            });
    } else {
        // If backend isn't running, don't filter the image
        img.style = img.getAttribute('data-original-style') || '';
        img.removeAttribute('data-socioio-analyzing');
    }
}

// Add this helper function
function applyBlurToImage(img) {
    // Add smooth transition first
    img.style.transition = `filter ${UI_TRANSITION_DURATION}ms ease`;

    // Then apply the blur with slight delay for smooth effect
    setTimeout(() => {
        img.style.filter = "blur(20px)";
        img.style.border = "3px solid red";
        img.setAttribute('data-socioio-filtered', 'true');

        // Add overlay with warning and button
        addOverlayToImage(img);

        // Update stats
        updateStats('image');
    }, 50);
}

// Add this function for image analysis
function analyzeImageContent(img) {
    if (!img.src) return;

    // Skip if the backend isn't running
    if (!backendRunning) {
        debug("Backend not running, skipping image analysis");
        return;
    }

    fetch(`${API_BASE_URL}/analyze_image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ image_url: img.src, url: window.location.href })
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            debug("Image analysis response:", data);

            // Only blur if unsafe or questionable
            if (data.overall_safety === "unsafe" || data.overall_safety === "questionable") {
                applyBlurToImage(img);
            } else {
                // Make sure the image is not blurred
                img.style.filter = "none";
                img.style.border = "";
            }
        })
        .catch(error => {
            debug("Error analyzing image:", error);
            // Don't blur by default if analysis fails
        });
}

// Add overlay with warning and button to a filtered image
function addOverlayToImage(img) {
    try {
        // Skip if image is null or doesn't have a parent
        if (!img || !img.parentNode) {
            return;
        }

        // Check if overlay already exists
        const existingOverlay = img.parentNode.querySelector('.socioio-overlay');
        if (existingOverlay) {
            return; // Overlay already exists
        }

        // Get image dimensions and position
        const rect = img.getBoundingClientRect();
        const imgWidth = img.width || rect.width;
        const imgHeight = img.height || rect.height;

        // Skip if image is too small
        if (imgWidth < 100 || imgHeight < 100) {
            return;
        }

        // Create a simpler overlay approach that works more reliably
        const overlay = document.createElement('div');
        overlay.className = 'socioio-overlay';

        // Create warning text
        const warning = document.createElement('div');
        warning.className = 'socioio-warning';
        warning.textContent = 'This image has been blurred by Socio.io';

        // Create show button
        const button = document.createElement('button');
        button.className = 'socioio-show-button';
        button.textContent = 'Show Image';

        // Add button event listener
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();

            // Unblur the image
            img.style.filter = 'none';

            // Hide the overlay
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }

            // Add a small indicator that the image was previously filtered
            const indicator = document.createElement('div');
            indicator.className = 'socioio-viewed-indicator';
            indicator.textContent = 'Filtered by Socio.io';

            // Position the indicator
            if (img.parentNode) {
                img.parentNode.style.position = 'relative';
                img.parentNode.appendChild(indicator);
            }

            return false;
        });

        // Assemble overlay
        overlay.appendChild(warning);
        overlay.appendChild(button);

        // Position the overlay
        const container = document.createElement('div');
        container.className = 'socioio-image-container';
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        container.style.width = imgWidth + 'px';
        container.style.height = imgHeight + 'px';

        // Insert the container before the image
        img.parentNode.insertBefore(container, img);

        // Move the image into the container
        container.appendChild(img);

        // Add the overlay to the container
        container.appendChild(overlay);

        // Make sure the image is positioned correctly
        img.style.position = 'relative';
        img.style.zIndex = '1';

        debug("Added overlay to image successfully");
    } catch (error) {
        debug("Error adding overlay to image:", error);

        // Fallback to simple blur without overlay
        try {
            img.style.filter = 'blur(20px)';
            img.style.border = '3px solid red';
        } catch (fallbackError) {
            debug("Error applying fallback blur:", fallbackError);
        }
    }
}

// Scan only images for moderation (for faster response)
function scanImagesForModeration() {
    debug("Scanning images for moderation");

    try {
        if (!isEnabled) return;

        // Get all images on the page that haven't been processed yet
        const images = document.querySelectorAll('img:not(.' + EXCLUSION_CLASS + ')');

        debug(`Found ${images.length} images to scan`);

        // Process images in smaller batches to avoid overloading the browser
        const batchSize = 5; // Process 5 images at a time
        let processedCount = 0;

        // Function to process a batch of images
        function processBatch(startIndex) {
            const endIndex = Math.min(startIndex + batchSize, images.length);

            for (let i = startIndex; i < endIndex; i++) {
                const img = images[i];

                // Check if image exists and has loaded
                if (img && img.complete && img.naturalWidth > 0) {
                    // Check if this image has already been processed
                    if (!imageElementsProcessed.has(img)) {
                        try {
                            processImage(img);
                            // Add to processed set
                            imageElementsProcessed.add(img);
                            processedCount++;
                        } catch (error) {
                            debug("Error processing image:", error);
                        }
                    }
                }
            }

            // If there are more images to process, schedule the next batch
            if (endIndex < images.length) {
                setTimeout(() => {
                    processBatch(endIndex);
                }, 100); // Small delay between batches
            } else {
                debug(`Processed ${processedCount} images in batches`);

                // Also add to processing queue for backend processing if needed
                addImagesToProcessingQueue(images);
            }
        }

        // Start processing the first batch
        processBatch(0);

    } catch (scanError) {
        console.error("[Socio.io " + new Date().toISOString() + "] Error during image scan:", scanError);
    }
}

// Add images to the processing queue for backend processing
function addImagesToProcessingQueue(images) {
    try {
        let imagesAdded = 0;

        for (const element of images) {
            try {
                // Skip images without a source
                if (!element.src) continue;

                // Skip elements that have already been processed by the queue
                if (element.classList.contains(EXCLUSION_CLASS)) continue;

                // Add to processing queue if it exists
                if (typeof processingQueue !== 'undefined') {
                    processingQueue.push({
                        type: 'image',
                        element: element
                    });
                }

                // Mark as processed
                element.classList.add(EXCLUSION_CLASS);
                imagesAdded++;
            } catch (imageError) {
                debug("Error adding image to processing queue:", imageError);
                // Continue with the next element
            }
        }

        debug(`Added ${imagesAdded} images to processing queue`);

        // Process the queue immediately if we have images
        if (imagesAdded > 0 && typeof processNextBatch === 'function') {
            processNextBatch();
        }
    } catch (error) {
        debug("Error in addImagesToProcessingQueue:", error);
    }
}

// Scan the page for all content that needs moderation
// Update text scanning to exclude UI elements
function scanContentForModeration() {
    try {
        if (!isEnabled) return;
        if (!backendRunning) {
            debug("Backend not running, skipping content scan");
            return;
        }

        debug("Scanning page for all content moderation");

        // Add a special selector just for headings to ensure they're processed
        const headingSelector = 'h1, h2, h3, h4, h5, h6';
        let headingElements = document.querySelectorAll(headingSelector + ':not(.' + EXCLUSION_CLASS + ')');
        debug(`Found ${headingElements.length} unprocessed heading elements`);

        // Process heading elements first and with higher priority
        processElementsWithDelay(headingElements, 'text', ELEMENT_PROCESSING_DELAY / 2);

        // Normal text elements excluding UI elements
        let selector = TEXT_SELECTORS + ':not(.' + EXCLUSION_CLASS + ')';

        // Add exclusions for UI elements, but KEEP headings
        UI_ELEMENT_SELECTORS.forEach(uiSelector => {
            if (!uiSelector.startsWith('h')) { // Don't exclude headings
                selector += `:not(${uiSelector})`;
                selector += `:not(${uiSelector} *)`;
            }
        });

        const textElements = document.querySelectorAll(selector);
        debug(`Found ${textElements.length} unprocessed text elements`);

        // Process text elements with delay
        processElementsWithDelay(textElements, 'text', ELEMENT_PROCESSING_DELAY);

        // Process images as before
        const imageSelector = IMAGE_SELECTORS + ':not(.' + EXCLUSION_CLASS + ')';
        const imageElements = document.querySelectorAll(imageSelector);
        debug(`Found ${imageElements.length} unprocessed image elements`);

        processElementsWithDelay(imageElements, 'image', ELEMENT_PROCESSING_DELAY);
    } catch (scanError) {
        debug("Error during content scan:", scanError);
    }
}

// Helper function to process elements with delay
function processElementsWithDelay(elements, type, delay) {
    // Process elements in smaller batches with delay
    const batchSize = 5; // Process 5 elements at a time

    for (let i = 0; i < elements.length; i += batchSize) {
        setTimeout(() => {
            const end = Math.min(i + batchSize, elements.length);
            for (let j = i; j < end; j++) {
                try {
                    const element = elements[j];

                    // Skip elements that have already been processed
                    if ((type === 'text' && textElementsProcessed.has(element)) ||
                        (type === 'image' && imageElementsProcessed.has(element))) {
                        continue;
                    }

                    // Add to processing queue with delay
                    setTimeout(() => {
                        processingQueue.push({
                            type: type,
                            element: element
                        });

                        // Mark as processed
                        if (type === 'text') {
                            textElementsProcessed.add(element);
                        } else {
                            imageElementsProcessed.add(element);
                        }

                        element.classList.add(EXCLUSION_CLASS);
                    }, j % batchSize * 50); // Small delay between individual elements
                } catch (elementError) {
                    debug(`Error processing ${type} element:`, elementError);
                }
            }

            // Process queue after elements are added
            if (i + batchSize >= elements.length) {
                setTimeout(processNextBatch, 100);
            }
        }, i / batchSize * delay);
    }
}

// Process the next batch of elements in the queue
function processNextBatch() {
    if (currentlyProcessing || processingQueue.length === 0 || !isEnabled) {
        debug(`Not processing batch: currentlyProcessing=${currentlyProcessing}, queueLength=${processingQueue.length}, isEnabled=${isEnabled}`);
        return;
    }

    currentlyProcessing = true;

    // Process a batch of elements
    const batch = processingQueue.splice(0, BATCH_SIZE);
    debug(`Processing batch of ${batch.length} elements`);

    // Count image elements in this batch for debugging
    const imageCount = batch.filter(item => item.type === 'image').length;
    debug(`Batch contains ${imageCount} image elements`);

    const promises = batch.map(processElement);

    // When all elements in the batch are processed
    Promise.allSettled(promises).then(results => {
        debug("Batch processing complete", results);

        // Count successful image filtrations - only count images that were actually filtered
        const successfulImageFilters = results.filter((result, index) => {
            return batch[index].type === 'image' &&
                result.status === 'fulfilled' &&
                result.value &&
                result.value.status === 'filtered' &&
                result.value.shouldFilter === true; // Only count if it should be filtered
        }).length;

        debug(`Successfully filtered ${successfulImageFilters} images in this batch`);

        currentlyProcessing = false;

        // If there are more elements in the queue, process the next batch after a delay
        if (processingQueue.length > 0) {
            debug(`Scheduling next batch of ${Math.min(BATCH_SIZE, processingQueue.length)} elements in ${BATCH_DELAY}ms`);
            setTimeout(processNextBatch, BATCH_DELAY);
        }
    });
}

// Process a single element
function processElement(item) {
    return new Promise((resolve, reject) => {
        try {
            debug(`Processing ${item.type} element`, item.element);
            if (item.type === 'text') {
                processTextElement(item.element)
                    .then(result => {
                        debug("Text processing complete", result);
                        resolve(result);
                    })
                    .catch(error => {
                        debug("Text processing error", error);
                        reject(error);
                    });
            } else if (item.type === 'image') {
                try {
                    // Make sure the image is fully loaded before processing
                    if (item.element.complete) {
                        // Image is already loaded, process it immediately
                        const result = processImageElement(item.element);
                        debug("Image processing complete", result);

                        // Only count as filtered if the image was actually filtered
                        if (result && result.status === "filtered" && result.shouldFilter) {
                            debug("Image was filtered:", result.reasons);
                        } else {
                            debug("Image was not filtered or kept:", result);
                        }

                        resolve(result);
                    } else {
                        // Wait for the image to load before processing
                        item.element.onload = function () {
                            try {
                                const result = processImageElement(item.element);
                                debug("Image processing complete (after load)", result);

                                // Only count as filtered if the image was actually filtered
                                if (result && result.status === "filtered" && result.shouldFilter) {
                                    debug("Image was filtered after load:", result.reasons);
                                } else {
                                    debug("Image was not filtered or kept after load:", result);
                                }

                                resolve(result);
                            } catch (loadError) {
                                debug("Image processing error after load", loadError);
                                reject(loadError);
                            }
                        };

                        // Handle image load errors
                        item.element.onerror = function () {
                            debug("Image failed to load", item.element.src);
                            resolve({ status: "skipped", reason: "image_load_failed" });
                        };

                        // Set a timeout in case the image takes too long to load
                        setTimeout(() => {
                            if (!item.element.complete) {
                                debug("Image load timeout", item.element.src);
                                resolve({ status: "skipped", reason: "image_load_timeout" });
                            }
                        }, 5000); // 5 second timeout
                    }
                } catch (error) {
                    debug("Image processing error", error);
                    reject(error);
                }
            } else {
                debug(`Unknown element type: ${item.type}`);
                resolve();
            }
        } catch (error) {
            debug('Error processing element:', error);
            resolve();  // Resolve anyway to continue with other elements
        }
    });
}

function analyzeTextContent(text, url) {
    return new Promise((resolve, reject) => {
        if (!text || text.trim().length < 3) {
            resolve({ action: "allow" });
            return;
        }

        // Improved error handling for fetch
        fetch(`${API_BASE_URL}/analyze_text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text, url: url })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Server responded with status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                debug("Text analysis response:", data);
                resolve(data);
            })
            .catch(error => {
                debug('Error analyzing text:', error);
                // Fallback to client-side detection
                const clientSideAnalysis = {
                    action: "allow",
                    reasons: [],
                    processed_text: text
                };

                // Basic profanity detection as fallback
                const profanityWords = ["fuck", "shit", "ass", "bitch"];
                const containsProfanity = profanityWords.some(word =>
                    text.toLowerCase().includes(word)
                );

                if (containsProfanity) {
                    clientSideAnalysis.action = "remove";
                    clientSideAnalysis.reasons = ["Profanity detected (client-side fallback)"];
                }

                resolve(clientSideAnalysis);
            });
    });
}

// Process a text element with client-side backup detection
// Process a text element with proper analysis
async function processTextElement(element) {
    try {
        // Skip if the element has been removed from the DOM
        if (!element.isConnected) {
            debug("Element no longer connected to DOM");
            return { status: "skipped", reason: "element_not_connected" };
        }

        const text = element.textContent.trim();
        if (!text) {
            debug("Element has no text content");
            return { status: "skipped", reason: "no_text" };
        }

        // Skip very short text
        if (text.length < 5) {
            return { status: "skipped", reason: "text_too_short" };
        }

        // Save the original text before any modifications
        element.setAttribute('data-original-text', text);

        // Try to send to backend for analysis
        try {
            debug("Sending text to backend for analysis");

            const response = await fetch(`${API_BASE_URL}/analyze_text`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    url: window.location.href
                })
            });

            // Parse the response
            const data = await response.json();
            debug("Text analysis response:", data);

            // Only apply action if backend detects something
            if (data.action !== "allow") {
                debug(`Applying action: ${data.action} to text`);

                if (data.action === "remove") {
                    // Create a more user-friendly filtered text display
                    let filteredText;

                    // Different filtering methods based on content length
                    if (text.length < 30) {
                        // For short text, use a generic message
                        filteredText = "[Content filtered]";
                    } else if (text.length < 100) {
                        // For medium text, show beginning and end with filtered middle
                        const start = text.substring(0, 10);
                        const end = text.substring(text.length - 10);
                        filteredText = `${start}... [Content filtered] ...${end}`;
                    } else {
                        // For long text, show a paragraph summary
                        const firstSentence = text.split('.')[0];
                        const preview = firstSentence.length > 50 ? firstSentence.substring(0, 50) + "..." : firstSentence;
                        filteredText = `${preview}\n\n[Additional content filtered]`;
                    }

                    // Apply the filtered text
                    element.textContent = filteredText;
                    element.classList.add('socioio-filtered-text');

                    // Add visual indicator next to the element
                    addModerationIndicator(element, "remove", data.reasons);
                    updateStats('text');
                    return { status: "filtered", action: data.action, reasons: data.reasons };
                }
            }

            return { status: "kept" };

        } catch (error) {
            debug('Error in fetch request:', error);

            // Fallback to client-side detection if backend fails
            const lowerText = text.toLowerCase();

            // Check for profanity and hate speech with exact word matches
            const profanityWords = ["fuck", "shit", "asshole"];
            const hateWords = ["nigger", "faggot", "kill all"];

            let isProfanity = profanityWords.some(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'i');
                return regex.test(lowerText);
            });

            let isHateSpeech = hateWords.some(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'i');
                return regex.test(lowerText);
            });

            // Only filter if we detect something serious
            if (isProfanity || isHateSpeech) {
                let filteredText = "[Content filtered - click indicator to view]";
                element.textContent = filteredText;
                element.classList.add('socioio-filtered-text');

                const reasons = [];
                if (isProfanity) reasons.push("Profanity detected");
                if (isHateSpeech) reasons.push("Hate speech detected");

                addModerationIndicator(element, "remove", reasons);
                updateStats('text');
                return { status: "filtered", action: "remove", reasons: reasons };
            }

            return { status: "kept" };
        }
    } catch (error) {
        debug('Error in text processing:', error);
        return { status: "error", error: error.message };
    }
}

// Add visual indicator for moderated content - Enhanced user-friendly version
// Improved indicator positioning that stays with the element
function addModerationIndicator(element, action, reasons) {
    try {
        // Clear any existing indicators for this element
        const existingIndicators = document.querySelectorAll('.' + INDICATOR_CLASS);
        for (const indicator of existingIndicators) {
            const rect = indicator.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();

            // If the indicator is close to this element, remove it
            if (Math.abs(rect.top - elementRect.top) < 30 &&
                Math.abs(rect.left - elementRect.left) < 30) {
                indicator.parentNode.removeChild(indicator);
            }
        }

        // Create indicator element
        const indicator = document.createElement('span'); // Changed to span for inline positioning
        indicator.className = INDICATOR_CLASS;

        // Set icon, text and color based on action
        let icon, text, color;
        if (action === "remove") {
            icon = "🛡️";
            text = "View";
            color = "#4285f4"; // Google blue
        } else if (action === "encrypt") {
            icon = "🔒";
            text = "View";
            color = "#0f9d58"; // Google green
        } else {
            icon = "⚠️";
            text = "View";
            color = "#f4b400"; // Google yellow
        }

        // Style the indicator as an inline element
        indicator.style.display = "inline-flex";
        indicator.style.alignItems = "center";
        indicator.style.backgroundColor = color;
        indicator.style.color = "white";
        indicator.style.padding = "2px 6px";
        indicator.style.borderRadius = "4px";
        indicator.style.fontSize = "11px";
        indicator.style.cursor = "pointer";
        indicator.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
        indicator.style.marginLeft = "5px";
        indicator.style.verticalAlign = "middle";
        indicator.style.lineHeight = "normal";
        indicator.style.transition = "all 0.2s ease";
        indicator.innerHTML = `${icon} <span style="margin-left: 3px;">${text}</span>`;

        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'socioio-tooltip';
        tooltip.style.display = "none";
        tooltip.style.position = "absolute";
        tooltip.style.top = "100%";
        tooltip.style.left = "0";
        tooltip.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        tooltip.style.color = "white";
        tooltip.style.padding = "8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.width = "220px";
        tooltip.style.zIndex = "10000";
        tooltip.style.boxShadow = "0 3px 10px rgba(0,0,0,0.3)";
        tooltip.style.fontSize = "11px";
        tooltip.style.lineHeight = "1.3";

        // Add reasons to tooltip
        let tooltipContent = `<div style="font-weight: bold; margin-bottom: 5px;">Content Filtered by Socio.io</div>`;
        if (reasons && reasons.length > 0) {
            tooltipContent += `<div style="margin-bottom: 3px;">Filtered for:</div>`;
            tooltipContent += `<ul style="margin: 3px 0; padding-left: 15px;">`;
            reasons.forEach(reason => {
                tooltipContent += `<li>${reason}</li>`;
            });
            tooltipContent += `</ul>`;
        }
        tooltipContent += `<div style="margin-top: 5px; opacity: 0.8;">Click to view original content</div>`;
        tooltip.innerHTML = tooltipContent;

        // Add tooltip to indicator
        indicator.appendChild(tooltip);

        // Make indicator position:relative to contain tooltip
        indicator.style.position = "relative";

        // Show/hide tooltip on hover
        indicator.addEventListener('mouseenter', () => {
            tooltip.style.display = "block";
            indicator.style.backgroundColor = darkenColor(color, 10);
        });

        indicator.addEventListener('mouseleave', () => {
            tooltip.style.display = "none";
            indicator.style.backgroundColor = color;
        });

        // Add click handler to show original content
        indicator.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Get the original content from history or element
            let originalContent = "";
            if (element.hasAttribute('data-original-text')) {
                originalContent = element.getAttribute('data-original-text');
                showContentModal(originalContent, reasons);
            } else {
                // Try to find in history
                chrome.storage.local.get(['filterHistory'], function (result) {
                    const history = result.filterHistory || [];
                    const matchingItem = history.find(item => {
                        return element.classList.contains('socioio-filtered-text') &&
                            item.type === 'text';
                    });

                    if (matchingItem) {
                        showContentModal(matchingItem.originalContent, reasons);
                    } else {
                        showContentModal("Original content not found. Please use the recovery option from the extension popup.", []);
                    }
                });
            }
        });

        // Instead of adding to the body at an absolute position, insert after the element
        if (element.nextSibling) {
            element.parentNode.insertBefore(indicator, element.nextSibling);
        } else {
            element.parentNode.appendChild(indicator);
        }

    } catch (error) {
        debug('Error adding moderation indicator:', error);
    }
}

// Improved image overlay that maintains position and layout
function addOverlayToImage(img) {
    try {
        // Skip if image is null or doesn't have a parent
        if (!img || !img.parentNode) {
            return;
        }

        // Check if overlay already exists
        const existingOverlay = img.nextElementSibling;
        if (existingOverlay && existingOverlay.classList.contains('socioio-overlay')) {
            return; // Overlay already exists
        }

        // Store original dimensions and styling
        const originalWidth = img.offsetWidth || img.naturalWidth;
        const originalHeight = img.offsetHeight || img.naturalHeight;
        const originalStyle = img.getAttribute('style') || '';

        // Store original classes and add our marker class
        const originalClasses = img.className;
        img.classList.add('socioio-filtered-image');

        // Create a wrapper to maintain layout
        const wrapper = document.createElement('div');
        wrapper.className = 'socioio-image-wrapper';
        wrapper.style.display = window.getComputedStyle(img).display;
        wrapper.style.position = 'relative';
        wrapper.style.width = originalWidth + 'px';
        wrapper.style.height = originalHeight + 'px';
        wrapper.style.margin = window.getComputedStyle(img).margin;
        wrapper.style.padding = '0';
        wrapper.style.overflow = 'hidden';

        // Create the overlay
        const overlay = document.createElement('div');
        overlay.className = 'socioio-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.color = 'white';
        overlay.style.textAlign = 'center';
        overlay.style.zIndex = '2';

        // Warning text
        const warning = document.createElement('div');
        warning.style.padding = '10px';
        warning.style.fontSize = '14px';
        warning.style.fontWeight = 'bold';
        warning.textContent = 'Image filtered by Socio.io';

        // Show button
        const button = document.createElement('button');
        button.style.marginTop = '10px';
        button.style.padding = '6px 12px';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.backgroundColor = '#4285f4';
        button.style.color = 'white';
        button.style.cursor = 'pointer';
        button.style.fontSize = '12px';
        button.textContent = 'Show Image';

        // Add button event listener
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();

            // Remove blur
            img.style.filter = 'none';

            // Remove overlay
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }

            return false;
        });

        // Assemble overlay
        overlay.appendChild(warning);
        overlay.appendChild(button);

        // Apply blur to image
        img.style.filter = 'blur(20px)';

        // Insert wrapper before the image
        img.parentNode.insertBefore(wrapper, img);

        // Move image inside wrapper and add overlay
        wrapper.appendChild(img);
        wrapper.appendChild(overlay);

        debug("Added improved overlay to image");
    } catch (error) {
        debug("Error adding overlay to image:", error);

        // Fallback to simple blur without overlay
        try {
            img.style.filter = 'blur(20px)';
        } catch (fallbackError) {
            debug("Error applying fallback blur:", fallbackError);
        }
    }
}

// Helper function to darken a color
function darkenColor(color, percent) {
    // Convert hex to RGB
    let r, g, b;
    if (color.startsWith('#')) {
        r = parseInt(color.substr(1, 2), 16);
        g = parseInt(color.substr(3, 2), 16);
        b = parseInt(color.substr(5, 2), 16);
    } else {
        return color; // Return original if not hex
    }

    // Darken
    r = Math.max(0, Math.floor(r * (100 - percent) / 100));
    g = Math.max(0, Math.floor(g * (100 - percent) / 100));
    b = Math.max(0, Math.floor(b * (100 - percent) / 100));

    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Show a modal with the original content
function showContentModal(content, reasons) {
    // Create modal container
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '99999';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = 'white';
    modalContent.style.padding = '20px';
    modalContent.style.borderRadius = '8px';
    modalContent.style.maxWidth = '600px';
    modalContent.style.maxHeight = '80%';
    modalContent.style.overflow = 'auto';
    modalContent.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';

    // Add header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    header.style.paddingBottom = '10px';
    header.style.borderBottom = '1px solid #eee';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.color = '#333';
    title.textContent = 'Original Filtered Content';

    const closeBtn = document.createElement('button');
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = '#666';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Add content
    const contentDiv = document.createElement('div');
    contentDiv.style.marginBottom = '15px';
    contentDiv.style.color = '#333';
    contentDiv.style.lineHeight = '1.5';
    contentDiv.textContent = content;

    // Add reasons if available
    let reasonsDiv = '';
    if (reasons && reasons.length > 0) {
        reasonsDiv = document.createElement('div');
        reasonsDiv.style.marginTop = '15px';
        reasonsDiv.style.padding = '10px';
        reasonsDiv.style.backgroundColor = '#f8f9fa';
        reasonsDiv.style.borderRadius = '4px';
        reasonsDiv.style.fontSize = '14px';

        const reasonsTitle = document.createElement('div');
        reasonsTitle.style.fontWeight = 'bold';
        reasonsTitle.style.marginBottom = '5px';
        reasonsTitle.textContent = 'Filtered for the following reasons:';

        const reasonsList = document.createElement('ul');
        reasonsList.style.margin = '5px 0';
        reasonsList.style.paddingLeft = '20px';

        reasons.forEach(reason => {
            const item = document.createElement('li');
            item.textContent = reason;
            reasonsList.appendChild(item);
        });

        reasonsDiv.appendChild(reasonsTitle);
        reasonsDiv.appendChild(reasonsList);
    }

    // Add footer with buttons
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.marginTop = '15px';
    footer.style.paddingTop = '10px';
    footer.style.borderTop = '1px solid #eee';

    const copyBtn = document.createElement('button');
    copyBtn.style.backgroundColor = '#4285f4';
    copyBtn.style.color = 'white';
    copyBtn.style.border = 'none';
    copyBtn.style.padding = '8px 15px';
    copyBtn.style.borderRadius = '4px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.marginLeft = '10px';
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content)
            .then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy to Clipboard';
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy: ', err);
            });
    });

    footer.appendChild(copyBtn);

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(contentDiv);
    if (reasonsDiv) modalContent.appendChild(reasonsDiv);
    modalContent.appendChild(footer);

    modal.appendChild(modalContent);

    // Add click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // Add to document
    document.body.appendChild(modal);
}

// Store processed elements for persistence
function storeProcessedElements() {
    // This is a placeholder for future implementation
    // We might want to store the IDs of processed elements in local storage
    // so we don't reprocess them on page reload
}

// Update stats in the background script
function updateStats(type) {
    try {
        // Make sure we're using the correct type name for images
        const correctedType = type === 'image' ? 'images' : type;

        debug(`Updating stats for ${correctedType}`);

        chrome.runtime.sendMessage({
            action: 'updateStats',
            type: correctedType,
            count: 1
        }, function (response) {
            if (chrome.runtime.lastError) {
                debug("Error updating stats:", chrome.runtime.lastError);

                // Try again after a short delay
                setTimeout(() => {
                    chrome.runtime.sendMessage({
                        action: 'updateStats',
                        type: correctedType,
                        count: 1
                    });
                }, 500);
            } else {
                debug("Stats updated:", response);
            }
        });

        // Also update local storage directly as a backup
        chrome.storage.local.get([correctedType + 'Filtered'], function (result) {
            const current = parseInt(result[correctedType + 'Filtered']) || 0;
            const newCount = current + 1;

            chrome.storage.local.set({
                [correctedType + 'Filtered']: newCount
            }, function () {
                debug(`Directly updated ${correctedType}Filtered to ${newCount}`);
            });
        });
    } catch (e) {
        debug("Error sending stats update:", e);
    }
}

// Restore original content when protection is disabled
function restoreOriginalContent() {
    debug("Restoring original content");

    // Remove all socioio elements
    document.querySelectorAll('.socioio-blocked-image, .socioio-image-overlay, .socioio-image-wrapper, .' + INDICATOR_CLASS).forEach(el => {
        try {
            el.parentNode.removeChild(el);
        } catch (e) {
            debug("Error removing element:", e);
        }
    });

    // Remove blur from all images
    document.querySelectorAll('img[style*="blur"], .socioio-filtered-image, img[data-socioio-filtered="true"]').forEach(img => {
        try {
            img.style.filter = 'none';
            img.style.border = '';
            img.classList.remove('socioio-filtered-image');
            img.removeAttribute('data-socioio-filtered');

            // If the image has an original src, restore it
            if (img.dataset.originalSrc) {
                img.src = img.dataset.originalSrc;
                img.removeAttribute('data-original-src');
            }

            // If the image is in a wrapper, unwrap it
            if (img.parentNode && img.parentNode.classList && img.parentNode.classList.contains('socioio-image-wrapper')) {
                const wrapper = img.parentNode;
                const parent = wrapper.parentNode;
                parent.insertBefore(img, wrapper);
                parent.removeChild(wrapper);
            }
        } catch (e) {
            debug("Error restoring image:", e);
        }
    });

    // Restore filtered text
    document.querySelectorAll('.socioio-filtered-text').forEach(el => {
        try {
            if (el.dataset.originalText) {
                el.textContent = el.dataset.originalText;
                el.removeAttribute('data-original-text');
            }
            el.classList.remove('socioio-filtered-text');
            el.style = '';
        } catch (e) {
            debug("Error restoring text:", e);
        }
    });

    // Remove any remaining overlays
    document.querySelectorAll('.socioio-overlay').forEach(el => {
        try {
            el.parentNode.removeChild(el);
        } catch (e) {
            debug("Error removing overlay:", e);
        }
    });

    debug("Content restoration complete");
}

// Apply recovered content from popup
function applyRecoveredContent(recoveredText) {
    debug("Applying recovered content:", recoveredText);

    try {
        // Find all elements with our new filtered text class
        const modernFilteredElements = Array.from(document.querySelectorAll('.socioio-filtered-text'));

        // Also find legacy elements with asterisks (for backward compatibility)
        const legacyFilteredElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'))
            .filter(el => {
                // Check if the element contains only asterisks
                const text = el.textContent.trim();
                return text.length > 0 && text.split('').every(char => char === '*');
            });

        // Also find elements with our filtered content message
        const messageFilteredElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'))
            .filter(el => {
                const text = el.textContent.trim();
                return text.includes('[Content filtered by Socio.io]');
            });

        // Combine all types of filtered elements
        const allFilteredElements = [
            ...modernFilteredElements,
            ...legacyFilteredElements,
            ...messageFilteredElements
        ];

        debug(`Found ${allFilteredElements.length} filtered elements to restore (${modernFilteredElements.length} modern, ${legacyFilteredElements.length} legacy, ${messageFilteredElements.length} message)`);

        // If no filtered elements found, try to create a new element with the recovered text
        if (allFilteredElements.length === 0) {
            debug("No filtered elements found, creating a new element with the recovered text");

            // Create a notification to show the recovered text
            const notification = document.createElement('div');
            notification.style.position = 'fixed';
            notification.style.top = '20px';
            notification.style.left = '50%';
            notification.style.transform = 'translateX(-50%)';
            notification.style.backgroundColor = '#4285f4';
            notification.style.color = 'white';
            notification.style.padding = '15px 20px';
            notification.style.borderRadius = '5px';
            notification.style.zIndex = '9999999';
            notification.style.fontFamily = 'Arial, sans-serif';
            notification.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            notification.style.maxWidth = '80%';
            notification.style.maxHeight = '80%';
            notification.style.overflow = 'auto';

            // Add a title
            const title = document.createElement('div');
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '10px';
            title.textContent = 'Recovered Content:';
            notification.appendChild(title);

            // Add the recovered text
            const content = document.createElement('div');
            content.style.whiteSpace = 'pre-wrap';
            content.style.wordBreak = 'break-word';
            content.textContent = recoveredText;
            notification.appendChild(content);

            // Add a close button
            const closeButton = document.createElement('button');
            closeButton.style.position = 'absolute';
            closeButton.style.top = '5px';
            closeButton.style.right = '5px';
            closeButton.style.background = 'none';
            closeButton.style.border = 'none';
            closeButton.style.color = 'white';
            closeButton.style.fontSize = '20px';
            closeButton.style.cursor = 'pointer';
            closeButton.textContent = '×';
            closeButton.addEventListener('click', () => {
                document.body.removeChild(notification);
            });
            notification.appendChild(closeButton);

            // Add to document
            document.body.appendChild(notification);

            // Remove after 30 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 30000);

            return;
        }

        // If we found filtered elements, restore the first one
        if (allFilteredElements.length > 0) {
            const elementToRestore = allFilteredElements[0];

            // Restore the content
            elementToRestore.textContent = recoveredText;

            // Remove the filtered class if it exists
            elementToRestore.classList.remove('socioio-filtered-text');

            // Remove the indicator if it exists
            const indicators = document.querySelectorAll('.' + INDICATOR_CLASS);
            for (const indicator of indicators) {
                const rect = indicator.getBoundingClientRect();
                const elementRect = elementToRestore.getBoundingClientRect();

                // If the indicator is close to this element, remove it
                if (Math.abs(rect.top - elementRect.top) < 50 &&
                    Math.abs(rect.left - elementRect.left) < 100) {
                    indicator.parentNode.removeChild(indicator);
                }
            }
        }

        // Also try to find and update encrypted elements
        document.querySelectorAll('.socioio-encrypted').forEach(el => {
            el.textContent = recoveredText;
            el.classList.remove('socioio-encrypted');
        });

        // Show notification
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '9999999';
        notification.style.fontFamily = 'Arial, sans-serif';
        notification.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';

        if (allFilteredElements.length > 0) {
            notification.textContent = 'Content restored successfully!';
        } else {
            notification.textContent = 'No filtered content found to restore. Content copied to clipboard.';

            // Copy to clipboard as fallback
            navigator.clipboard.writeText(recoveredText)
                .catch(err => {
                    debug("Error copying to clipboard:", err);
                });
        }

        document.body.appendChild(notification);

        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);

        debug("Content applied to page");
    } catch (e) {
        debug("Error applying recovered content:", e);

        // Show error notification
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '9999999';
        notification.style.fontFamily = 'Arial, sans-serif';
        notification.textContent = 'Error restoring content. Try copying it manually.';

        document.body.appendChild(notification);

        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Inject CSS styles for our elements
function injectStyles() {
    debug("Injecting styles");

    const styles = `
        /* Preserve original font styles for filtered content */
        .socioio-filtered-text {
            font-family: inherit !important;
            font-size: inherit !important;
            line-height: inherit !important;
            color: inherit !important;
            text-align: inherit !important;
            margin: inherit !important;
            padding: inherit !important;
            background-color: rgba(255, 0, 0, 0.05) !important;
            border-radius: 3px !important;
            transition: all 0.3s ease !important;
        }
        
        /* Improved indicator styling */
        .${INDICATOR_CLASS} {
            display: inline-flex !important;
            align-items: center !important;
            margin-left: 5px !important;
            vertical-align: middle !important;
        }
        
        /* Improved image wrapper to maintain layout */
            .socioio-image-wrapper {
            display: inline-block !important;
            position: relative !important;
            overflow: hidden !important;
            box-sizing: content-box !important;
        }
        
        /* Ensure filtered images maintain original dimensions */
        .socioio-filtered-image {
            width: 100% !important;
            height: auto !important;
            object-fit: cover !important;
            transition: filter 0.3s ease !important;
        }
        
        /* Proper overlay positioning */
        .socioio-overlay {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 2 !important;
        }
        
        /* Modal styling improvements */
        .socioio-modal {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        }
    `;

    // Check if style element already exists
    let styleElement = document.getElementById('socioio-styles');

    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'socioio-styles';
        document.head.appendChild(styleElement);
    }
    styleElement.textContent = styles;
}

// Save filtered content to history
function saveFilterHistory(type, content, reasons) {
    try {
        debug(`Saving ${type} to filter history`);

        // Make sure we have valid content
        if (!content) {
            debug('No content provided for filter history');
            return;
        }

        // Make sure we have valid reasons
        const validReasons = Array.isArray(reasons) ? reasons.filter(r => r) : ['Filtered content'];

        // Create history item
        const historyItem = {
            type: type,
            content: type === 'image' ? 'Image URL: ' + content.substring(0, 50) + '...' :
                content.substring(0, 100) + (content.length > 100 ? '...' : ''),
            originalContent: content,
            reasons: validReasons,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            domain: new URL(window.location.href).hostname
        };

        debug('Created history item:', historyItem);

        // Get existing history
        chrome.storage.local.get(['filterHistory'], function (result) {
            let history = result.filterHistory || [];

            debug(`Current history has ${history.length} items`);

            // Add new item at the beginning
            history.unshift(historyItem);

            // Limit history to 100 items
            if (history.length > 100) {
                history = history.slice(0, 100);
            }

            // Save updated history
            chrome.storage.local.set({ 'filterHistory': history }, function () {
                if (chrome.runtime.lastError) {
                    debug('Error saving filter history:', chrome.runtime.lastError);
                } else {
                    debug(`Filter history updated successfully, now has ${history.length} items`);
                }
            });
        });
    } catch (e) {
        debug('Error saving to filter history:', e);

        // Try a simpler approach as fallback
        try {
            const simpleItem = {
                type: type,
                content: type === 'image' ? 'Image filtered' : 'Text filtered',
                timestamp: new Date().toISOString(),
                domain: window.location.hostname
            };

            chrome.storage.local.get(['filterHistory'], function (result) {
                let history = result.filterHistory || [];
                history.unshift(simpleItem);
                if (history.length > 100) history = history.slice(0, 100);
                chrome.storage.local.set({ 'filterHistory': history });
            });
        } catch (fallbackError) {
            debug('Fallback history save also failed:', fallbackError);
        }
    }
}

// Reset processed sets periodically
function resetProcessedSets() {
    // Clear the sets every 5 minutes to allow re-checking
    setInterval(() => {
        debug("Resetting processed element sets");
        textElementsProcessed.clear();
        imageElementsProcessed.clear();
    }, 5 * 60 * 1000);
}

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Also initialize after a short delay to ensure everything is loaded
setTimeout(function () {
    debug("Running delayed initialization");
    initialize();

    // Force a scan of all images
    applyImmediateBlurToAllImages();
    scanImagesForModeration();

    // Reset processed sets periodically
    resetProcessedSets();

    // Set up periodic rescans to catch any new images
    setInterval(function () {
        debug("Running periodic rescan for new images");
        scanImagesForModeration();
    }, 3000); // Every 3 seconds
}, 1000);

// Add a mutation observer to detect new images added to the page
function setupImageMutationObserver() {
    try {
        const observer = new MutationObserver(function (mutations) {
            let newImagesFound = false;

            mutations.forEach(function (mutation) {
                // Check for added nodes
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];

                        // Check if the node is an image
                        if (node.nodeName === 'IMG') {
                            newImagesFound = true;
                            break;
                        }

                        // Check if the node contains images
                        if (node.nodeType === 1) { // Element node
                            const images = node.querySelectorAll('img');
                            if (images.length > 0) {
                                newImagesFound = true;
                                break;
                            }
                        }
                    }
                }
            });

            // If new images were found, scan them
            if (newImagesFound) {
                debug("New images detected, scanning...");
                scanImagesForModeration();
            }
        });

        // Start observing the document with the configured parameters
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        debug("Image mutation observer set up");
    } catch (error) {
        debug("Error setting up image mutation observer:", error);
    }
}

// Call this in initialize function
setTimeout(function () {
    setupImageMutationObserver();
}, 2000); // Delay to ensure document is fully loaded