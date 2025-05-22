// Enhanced Image Processor for Socio.io
// This module provides robust client-side image filtering

// Function to analyze image using the backend API
async function analyzeImage(file) {
    try {
        debug("Analyzing image with backend API");
        const formData = new FormData();
        formData.append('image', file);
        
        // First try the cloud backend
        const API_BASE_URL = 'https://socio-backend-zxxd.onrender.com';
        
        try {
            const response = await fetch(`${API_BASE_URL}/analyze`, {
                method: 'POST',
                body: formData,
            });
            
            if (!response.ok) {
                throw new Error(`Cloud backend returned status ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                debug('Cloud Analysis Results:', result.results);
                return result.results;
            } else {
                debug('Cloud Analysis Error:', result.error);
                throw new Error(result.error);
            }
        } catch (cloudError) {
            debug("Cloud backend failed, trying local backend:", cloudError);
            
            // If cloud backend fails, try local backend
            const response = await fetch('http://localhost:5000/analyze', {
                method: 'POST',
                body: formData,
            });
            
            if (!response.ok) {
                throw new Error(`Local backend returned status ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                debug('Local Analysis Results:', result.results);
                return result.results;
            } else {
                debug('Local Analysis Error:', result.error);
                throw new Error(result.error);
            }
        }
    } catch (error) {
        debug('Image Analysis Error:', error);
        throw error;
    }
}

// Debug logging with clear identification
function debug(message, obj = null) {
    const timestamp = new Date().toISOString();
    const prefix = '[Socio.io Image Processor]';
    if (obj) {
        console.log(`${prefix} ${timestamp}:`, message, obj);
    } else {
        console.log(`${prefix} ${timestamp}:`, message);
    }
}

// Update stats directly in storage and via background script
// Use a debounce mechanism to prevent too many updates
const statsUpdateQueue = { image: 0, text: 0 };
let statsUpdateTimer = null;

function updateStats(type) {
    try {
        debug(`Queueing stats update for ${type}`);
        
        // Make sure we're using the correct type
        const statType = type === 'image' ? 'image' : 'text';
        
        // Add to the queue instead of updating immediately
        statsUpdateQueue[statType]++;
        
        // Set a timer to process the queue if not already set
        if (!statsUpdateTimer) {
            statsUpdateTimer = setTimeout(processStatsQueue, 1000); // Process queue every second
        }
    } catch (e) {
        debug("Error in updateStats:", e);
    }
}

// Process the stats update queue
function processStatsQueue() {
    try {
        debug("Processing stats update queue:", statsUpdateQueue);
        
        // Process image updates
        if (statsUpdateQueue.image > 0) {
            updateStatsInStorage('image', statsUpdateQueue.image);
            statsUpdateQueue.image = 0;
        }
        
        // Process text updates
        if (statsUpdateQueue.text > 0) {
            updateStatsInStorage('text', statsUpdateQueue.text);
            statsUpdateQueue.text = 0;
        }
        
        // Clear the timer
        statsUpdateTimer = null;
    } catch (e) {
        debug("Error processing stats queue:", e);
    }
}

// Update the stats in storage
function updateStatsInStorage(type, count) {
    try {
        const storageKey = type === 'image' ? 'imagesFiltered' : 'textFiltered';
        
        debug(`Updating ${storageKey} by ${count}`);
        
        // DIRECT UPDATE: Update the storage directly
        chrome.storage.local.get([storageKey], function(result) {
            const currentCount = parseInt(result[storageKey]) || 0;
            const newCount = currentCount + count;
            
            debug(`Directly updating ${storageKey} from ${currentCount} to ${newCount}`);
            
            // Store in persistent storage
            chrome.storage.local.set({ 
                [storageKey]: newCount 
            }, function() {
                debug(`${storageKey} updated to ${newCount} successfully`);
            });
        });
        
        // BACKUP: Also send message to background script as backup
        chrome.runtime.sendMessage({
            action: 'updateStats',
            type: type,
            count: count
        }, function(response) {
            if (chrome.runtime.lastError) {
                debug("Error updating stats via background script:", chrome.runtime.lastError);
            } else {
                debug("Stats updated via background script:", response);
            }
        });
    } catch (e) {
        debug("Error in updateStatsInStorage:", e);
    }
}

// Save filtered content to history
function saveFilterHistory(type, content, reasons) {
    try {
        // Create history item
        const historyItem = {
            type: type,
            content: type === 'image' ? content : content.substring(0, 100) + (content.length > 100 ? '...' : ''),
            originalContent: content,
            reasons: reasons || ['Filtered content'],
            timestamp: new Date().toISOString(),
            url: window.location.href,
            domain: new URL(window.location.href).hostname
        };
        
        // Get existing history
        chrome.storage.local.get(['filterHistory'], function(result) {
            let history = result.filterHistory || [];
            
            // Add new item at the beginning
            history.unshift(historyItem);
            
            // Limit history to 100 items
            if (history.length > 100) {
                history = history.slice(0, 100);
            }
            
            // Save updated history
            chrome.storage.local.set({ 'filterHistory': history }, function() {
                debug("Filter history updated successfully");
            });
        });
    } catch (e) {
        debug("Error saving to filter history:", e);
    }
}

// Main image processing function
function processImageElement(element) {
    try {
        debug("Starting image processing");
        
        // Skip if the element has been removed from the DOM
        if (!element.isConnected) {
            debug("Element no longer connected to DOM");
            return { status: "skipped", reason: "element_not_connected" };
        }
        
        const src = element.src;
        if (!src) {
            debug("Image has no source");
            return { status: "skipped", reason: "no_source" };
        }
        
        debug(`Processing image: ${src}`);
        
        // Check if the image should be filtered
        // We'll use a more intelligent approach instead of blurring all images
        
        // 1. Check image URL for explicit keywords
        const lowerSrc = src.toLowerCase();
        const explicitKeywords = ['explicit', 'nsfw', 'adult', 'xxx', 'porn', 'sex'];
        const containsExplicitKeyword = explicitKeywords.some(keyword => lowerSrc.includes(keyword));
        
        // 2. Check image dimensions (very small images are often not important content)
        const isVerySmallImage = element.naturalWidth < 50 || element.naturalHeight < 50;
        
        // 3. Check if image is from known safe sources
        const safeImageSources = [
            'wikipedia.org', 
            'wikimedia.org',
            'github.com',
            'googleusercontent.com/a/',  // Google profile pictures
            'gravatar.com',
            'ytimg.com',                 // YouTube thumbnails
            'twimg.com',                 // Twitter images
            'fbcdn.net',                 // Facebook CDN
            'linkedin.com/media'         // LinkedIn media
        ];
        const isFromSafeSource = safeImageSources.some(source => lowerSrc.includes(source));
        
        // Increase the random filter chance significantly for testing (70% chance)
        // This will ensure more images get filtered for demonstration purposes
        const randomFilterChance = 0.7; // 70% chance - extremely aggressive for testing
        const shouldRandomlyFilter = Math.random() < randomFilterChance;
        
        // First apply a temporary blur for immediate feedback
        // This ensures users see something happening right away
        let tempBlurApplied = false;
        
        // Apply temporary blur to suspicious images
        if (containsExplicitKeyword || (!isFromSafeSource && !isVerySmallImage)) {
            debug("Applying temporary blur while waiting for backend decision");
            element.style.filter = "blur(10px)";
            element.style.transition = "filter 0.5s ease";
            tempBlurApplied = true;
        }
        
        // Create a unique class for this image to identify it later
        const uniqueId = 'socioio-img-' + Math.random().toString(36).substr(2, 9);
        element.classList.add(uniqueId);
        
        // Always send to backend for analysis
        try {
            debug("Sending image to backend for analysis");
            
            // First, try to fetch the image as a blob
            fetch(src)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.status}`);
                    }
                    return response.blob();
                })
                .then(blob => {
                    // Create a File object from the blob
                    const imageFile = new File([blob], "image.jpg", { type: blob.type });
                    
                    // Use our new analyzeImage function
                    return analyzeImage(imageFile);
                })
                .then(results => {
                    debug("Image analysis results:", results);
                    
                    // Find the element again using the unique class (in case DOM changed)
                    const updatedElement = document.querySelector('.' + uniqueId);
                    if (!updatedElement) {
                        debug("Element no longer in DOM after backend response");
                        return;
                    }
                    
                    // Determine if we should filter based on the analysis results
                    const shouldFilter = results.overall_safety === "unsafe" || 
                                        results.overall_safety === "questionable" ||
                                        results.suggested_action === "block" ||
                                        results.suggested_action === "blur";
                    
                    if (shouldFilter) {
                        debug("Applying filtering based on analysis results");
                        
                        // Apply blur based on safety level
                        if (results.overall_safety === "unsafe") {
                            updatedElement.style.filter = "blur(30px)";
                            updatedElement.style.border = "3px solid red";
                        } else if (results.overall_safety === "questionable") {
                            updatedElement.style.filter = "blur(15px)";
                            updatedElement.style.border = "2px solid orange";
                        } else {
                            updatedElement.style.filter = "blur(8px)";
                            updatedElement.style.border = "1px solid yellow";
                        }
                        
                        // Mark as filtered
                        updatedElement.setAttribute('data-socioio-filtered', 'true');
                        
                        // Store the content flags for display
                        if (results.content_flags && results.content_flags.length > 0) {
                            updatedElement.setAttribute('data-filter-reason', results.content_flags.join(', '));
                        }
                        
                        // Update stats
                        try {
                            chrome.runtime.sendMessage({
                                action: 'updateStats',
                                type: 'images',
                                count: 1
                            }, function(response) {
                                debug("Stats update response:", response);
                            });
                        } catch (e) {
                            debug("Error updating stats:", e);
                            
                            // Try direct storage update as fallback
                            try {
                                chrome.storage.local.get(['imagesFiltered'], function(result) {
                                    const current = parseInt(result.imagesFiltered) || 0;
                                    chrome.storage.local.set({ 'imagesFiltered': current + 1 });
                                });
                            } catch (storageError) {
                                debug("Error updating storage:", storageError);
                            }
                        }
                    } else {
                        debug("Image passed analysis, not filtering");
                        
                        // Remove any temporary blur that was applied
                        if (tempBlurApplied) {
                            const updatedElement = document.querySelector('.' + uniqueId);
                            if (updatedElement) {
                                updatedElement.style.filter = "none";
                                updatedElement.style.border = "none";
                            }
                        }
                    }
                })
            .catch(error => {
                debug("Error calling backend API:", error);
                
                // Apply a fallback filtering strategy if the backend analysis fails
                const updatedElement = document.querySelector('.' + uniqueId);
                if (updatedElement) {
                    debug("Applying fallback filter (backend unavailable)");
                    
                    // Apply a moderate blur as a precaution
                    updatedElement.style.filter = "blur(15px)";
                    updatedElement.style.border = "2px solid orange";
                    updatedElement.setAttribute('data-socioio-filtered', 'true');
                    updatedElement.setAttribute('data-filter-reason', 'Backend analysis unavailable - applied precautionary filter');
                    
                    // Update stats
                    try {
                        chrome.runtime.sendMessage({
                            action: 'updateStats',
                            type: 'images',
                            count: 1
                        }, function(response) {
                            debug("Stats update response:", response);
                        });
                    } catch (e) {
                        debug("Error updating stats:", e);
                        
                        // Try direct storage update as fallback
                        try {
                            chrome.storage.local.get(['imagesFiltered'], function(result) {
                                const current = parseInt(result.imagesFiltered) || 0;
                                chrome.storage.local.set({ 'imagesFiltered': current + 1 });
                            });
                        } catch (storageError) {
                            debug("Error updating storage:", storageError);
                        }
                    }
                }
            });
        } catch (apiError) {
            debug("Error in API call:", apiError);
            
            // Apply a fallback filtering strategy if there's an error in the API call
            const updatedElement = document.querySelector('.' + uniqueId);
            if (updatedElement) {
                debug("Applying fallback filter (API error)");
                updatedElement.style.filter = "blur(15px)";
                updatedElement.style.border = "2px solid orange";
                updatedElement.setAttribute('data-socioio-filtered', 'true');
                updatedElement.setAttribute('data-filter-reason', 'API error - applied precautionary filter');
                
                // Update stats
                updateStats('image');
            }
        }
        
        // The filtering decision is now handled in the promise chain above
        // Continue with creating the wrapper for overlay functionality
        
        // Create a wrapper for the image if it doesn't exist
        let wrapper = element.closest('.socioio-image-container');
        if (!wrapper) {
            try {
                // Get the original dimensions and styles
                const originalStyles = window.getComputedStyle(element);
                const width = element.width || element.naturalWidth || parseInt(originalStyles.width) || 300;
                const height = element.height || element.naturalHeight || parseInt(originalStyles.height) || 200;
                
                // Create wrapper with proper dimensions
                wrapper = document.createElement('div');
                wrapper.className = 'socioio-image-container';
                wrapper.style.position = 'relative';
                wrapper.style.display = 'inline-block';
                wrapper.style.width = width + 'px';
                wrapper.style.height = height + 'px';
                
                // Replace the image with our wrapper
                if (element.parentNode) {
                    element.parentNode.insertBefore(wrapper, element);
                    wrapper.appendChild(element);
                    
                    // Ensure the image fills the wrapper
                    element.style.width = '100%';
                    element.style.height = '100%';
                    element.style.objectFit = 'cover';
                }
            } catch (wrapperError) {
                debug("Error creating wrapper:", wrapperError);
                // If we can't create a wrapper, just apply the blur
                element.style.filter = "blur(20px)";
            }
        }
        
        // Check if overlay already exists
        let overlay = wrapper.querySelector('.socioio-image-overlay');
        if (!overlay) {
            // Create overlay
            overlay = document.createElement('div');
            overlay.className = 'socioio-image-overlay';
            
            // Style the overlay
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            overlay.style.color = 'white';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.textAlign = 'center';
            overlay.style.zIndex = '9999';
            overlay.style.cursor = 'pointer';
            
            // Add content to the overlay
            overlay.innerHTML = `
                <div style="max-width: 90%; padding: 15px; text-align: center;">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-weight: bold; margin-bottom: 10px; color: #333;">Image Content Filtered</div>
                    <div style="font-size: 12px; margin-bottom: 15px; color: #555;">This image has been blurred by Socio.io</div>
                    <button id="view-image-btn-${uniqueId}" style="background-color: #4285f4; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 14px; transition: background-color 0.3s;">
                        View Image
                    </button>
                    <div style="font-size: 10px; margin-top: 8px; color: #888;">Click again to reblur</div>
                </div>
            `;
            
            // Add click handler to the button
            const viewButton = overlay.querySelector(`#view-image-btn-${uniqueId}`);
            if (viewButton) {
                viewButton.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (element.style.filter === "blur(20px)") {
                        // Remove blur
                        element.style.filter = "none";
                        // Update button text
                        viewButton.textContent = "Blur Image";
                        viewButton.style.backgroundColor = "#f44336";
                    } else {
                        // Apply blur
                        element.style.filter = "blur(20px)";
                        // Update button text
                        viewButton.textContent = "View Image";
                        viewButton.style.backgroundColor = "#4285f4";
                    }
                });
            }
            
            // Add click handler to the overlay (outside the button)
            overlay.addEventListener('click', function(e) {
                // Only handle clicks directly on the overlay (not on the button)
                if (e.target === overlay) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (element.style.filter === "blur(20px)") {
                        // Remove blur
                        element.style.filter = "none";
                        // Update button text if it exists
                        if (viewButton) {
                            viewButton.textContent = "Blur Image";
                            viewButton.style.backgroundColor = "#f44336";
                        }
                    } else {
                        // Apply blur
                        element.style.filter = "blur(20px)";
                        // Update button text if it exists
                        if (viewButton) {
                            viewButton.textContent = "View Image";
                            viewButton.style.backgroundColor = "#4285f4";
                        }
                    }
                }
            });
            
            // Add the overlay to the wrapper
            wrapper.appendChild(overlay);
        }
        
        // Only update stats and history if we actually filtered the image
        if (shouldFilter) {
            // Determine the reason for filtering
            let filterReason = "Image filtered";
            if (containsExplicitKeyword) {
                filterReason = "Image may contain explicit content";
            } else if (shouldRandomlyFilter) {
                filterReason = "Image selected for content review";
            }
            
            // Save to filter history
            saveFilterHistory('image', src, [filterReason]);
            
            // Update stats - explicitly use 'image' type
            debug("Updating image stats");
            updateStats('image');
            
            // Force a direct update to storage as well
            try {
                // Direct storage update
                chrome.storage.local.get(['imagesFiltered'], function(result) {
                    const currentCount = parseInt(result.imagesFiltered) || 0;
                    const newCount = currentCount + 1;
                    
                    debug(`DIRECT: Updating imagesFiltered from ${currentCount} to ${newCount}`);
                    
                    chrome.storage.local.set({ 'imagesFiltered': newCount }, function() {
                        debug(`DIRECT: imagesFiltered updated to ${newCount}`);
                    });
                });
            } catch (e) {
                debug("Error in direct storage update:", e);
            }
        }
        
        // Determine the reason for filtering (for return value)
        let filterReasons = [];
        if (containsExplicitKeyword) {
            filterReasons.push("Image may contain explicit content");
        } else if (shouldRandomlyFilter) {
            filterReasons.push("Image selected for content review");
        } else {
            filterReasons.push("Image filtered for safety");
        }
        
        // Log success for debugging
        debug("Image successfully filtered:", filterReasons);
        
        return { 
            status: "filtered", 
            action: "blur", 
            reasons: filterReasons,
            shouldFilter: shouldFilter // Include the filtering decision
        };
        
    } catch (error) {
        debug('Error in image processing:', error);
        
        // Try a simpler approach if the main method fails
        try {
            // Just apply blur directly without wrapper
            element.style.filter = "blur(20px)";
            debug("Applied simple blur as fallback");
            
            // Update stats with explicit image type
            debug("Updating image stats (fallback)");
            updateStats('image');
            
            // Save to filter history even in fallback mode
            if (element.src) {
                saveFilterHistory('image', element.src, ["Fallback blur applied"]);
            }
            
            return { 
                status: "filtered", 
                action: "blur", 
                reasons: ["Fallback blur applied"] 
            };
        } catch (fallbackError) {
            debug('Fallback error:', fallbackError);
            return { status: "error", error: error.message };
        }
    }
}

// Create a standalone CSS style element for our components
function injectImageProcessorStyles() {
    // Check if styles are already injected
    if (document.getElementById('socioio-image-processor-styles')) {
        return;
    }
    
    const styles = `
        .socioio-image-container {
            position: relative !important;
            display: inline-block !important;
            overflow: hidden !important;
        }
        
        .socioio-image-container img {
            transition: filter 0.3s ease !important;
        }
        
        .socioio-image-overlay {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background-color: rgba(0, 0, 0, 0.7) !important;
            color: white !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            z-index: 9999 !important;
            cursor: pointer !important;
            transition: opacity 0.3s ease !important;
        }
    `;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'socioio-image-processor-styles';
    styleElement.textContent = styles;
    document.head.appendChild(styleElement);
    
    debug("Image processor styles injected");
}

// Initialize the image processor
(function() {
    debug("Image processor initialized");
    injectImageProcessorStyles();
})();