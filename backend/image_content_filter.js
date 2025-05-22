/**
 * Image Content Filter Module
 * Detects and filters inappropriate image content using Google Cloud Vision API
 */

const fs = require('fs').promises;
const path = require('path');
const { createCanvas, loadImage, Image } = require('canvas');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const axios = require('axios');
const dotenv = require('dotenv');
const winston = require('winston');

// Set up logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level}: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Load environment variables
dotenv.config();

class ImageContentFilter {
  constructor() {
    /**
     * Initialize the content filter with Google Cloud Vision API
     */
    // Load Google Cloud credentials from .env
    this.apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    this.confidenceThresholds = {
      "adult": 0.8,
      "violence": 0.75,
      "racy": 0.8,
      "medical": 0.5,
      "spoof": 0.9,
      "text_offense": 0.8,
      "hate_symbols": 0.8
    };
    
    // Enhanced blur settings (increased intensity)
    this.blurSettings = {
      "unsafe": 30,         // Was 15, now 30 for stronger blur
      "questionable": 15,   // Was 8, now 15
      "potentially_concerning": 8  // Was 3, now 8
    };
    
    // Check if API key is available
    if (!this.apiKey) {
      throw new Error("Google Cloud API key not found in .env file. Please add GOOGLE_CLOUD_API_KEY=your_key_here to your .env file.");
    }

    // Initialize Google Cloud Vision client
    try {
      // First try to use the environment variable
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath && fs.access(credentialsPath).then(() => true).catch(() => false)) {
        this.client = new ImageAnnotatorClient({
          keyFilename: credentialsPath
        });
        logger.info(`Using Google Cloud credentials from environment variable: ${credentialsPath}`);
      } else {
        // Fallback to a local path relative to the project
        const localCredentialsPath = path.join(__dirname, "google_credentials.json");
        if (fs.access(localCredentialsPath).then(() => true).catch(() => false)) {
          this.client = new ImageAnnotatorClient({
            keyFilename: localCredentialsPath
          });
          logger.info(`Using Google Cloud credentials from local file: ${localCredentialsPath}`);
        } else {
          // Last resort - try the hardcoded path but with a warning
          const fallbackPath = "C:/Users/Antriksh Sharma/Documents/project capstone/my-project-92814-457204-c90e6bf83130.json";
          if (fs.access(fallbackPath).then(() => true).catch(() => false)) {
            this.client = new ImageAnnotatorClient({
              keyFilename: fallbackPath
            });
            logger.warning(`Using fallback Google Cloud credentials: ${fallbackPath}`);
          } else {
            throw new Error("No valid Google Cloud credentials found. Please set GOOGLE_APPLICATION_CREDENTIALS environment variable.");
          }
        }
      }
    } catch (e) {
      logger.error(`Error initializing Google Cloud Vision client: ${e.message}`);
      throw e;
    }
    
    this.offensiveTerms = [
      "hate", "kill", "attack", "racist", "nazi", "violence", 
      "offensive", "explicit", "suicide", "abuse", "kill", "murder",
      "slur", "profanity", "obscene"
    ];
    
    logger.info("Content filter initialized successfully");
  }

  async analyzeImage(options = {}) {
    /**
     * Analyze an image for content filtering using Google Cloud Vision API
     *
     * @param {Object} options - The options for analysis
     * @param {string} options.imagePath - Path to the local image file
     * @param {string} options.imageUrl - URL of an image online
     * @param {Buffer} options.imageData - Raw image data
     * @param {boolean} options.showResults - Whether to display visual results
     * @param {boolean} options.exportComparison - Whether to export side-by-side comparison
     * @returns {Object} Analysis results
     */
    try {
      let content, displayImage, source, sourceFilename;
      
      // Load the image based on the provided input
      if (options.imagePath) {
        try {
          content = await fs.readFile(options.imagePath);
          displayImage = await loadImage(content);
          source = `Local file: ${path.basename(options.imagePath)}`;
          sourceFilename = path.basename(options.imagePath);
        } catch (e) {
          if (e.code === 'ENOENT') {
            throw new Error(`Image file not found: ${options.imagePath}`);
          } else {
            throw new Error(`Error opening image file: ${e.message}`);
          }
        }
      } 
      else if (options.imageUrl) {
        try {
          // Handle data URLs (base64 encoded images)
          if (options.imageUrl.startsWith('data:image')) {
            try {
              // Extract the base64 part
              const [contentType, data] = options.imageUrl.split(',', 2);
              // Decode the base64 data
              content = Buffer.from(data, 'base64');
              displayImage = await loadImage(content);
              source = "Data URL image";
              sourceFilename = "data_url_image";
            } catch (e) {
              logger.error(`Error processing data URL: ${e.message}`);
              throw new Error(`Error processing data URL image: ${e.message}`);
            }
          } else {
            // Regular URL handling
            const headers = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            };
            const response = await axios.get(options.imageUrl, { 
              responseType: 'arraybuffer',
              timeout: 10000,
              headers: headers
            });
            
            // Check if the content is actually an image
            const contentType = response.headers['content-type'];
            if (!contentType.startsWith('image/')) {
              logger.warning(`URL does not point to an image. Content-Type: ${contentType}`);
              // Try to proceed anyway, it might still be an image
            }
            
            content = Buffer.from(response.data);
            displayImage = await loadImage(content);
            source = `URL: ${options.imageUrl}`;
            // Extract filename from URL for export
            sourceFilename = path.basename(options.imageUrl.split('?')[0]);  // Remove query parameters
            if (!sourceFilename) {
              sourceFilename = "downloaded_image";
            }
          }
        } catch (e) {
          if (e.response) {
            logger.error(`Error downloading image from URL (HTTP ${e.response.status}): ${e.message}`);
            throw new Error(`Error downloading image from URL (HTTP ${e.response.status}): ${e.message}`);
          } else {
            logger.error(`Error processing image from URL: ${e.message}`);
            throw new Error(`Error processing image from URL: ${e.message}`);
          }
        }
      }
      else if (options.imageData) {
        try {
          content = options.imageData;
          displayImage = await loadImage(content);
          source = "Provided image data";
          sourceFilename = "provided_image_data";
        } catch (e) {
          throw new Error(`Error processing provided image data: ${e.message}`);
        }
      }
      else {
        throw new Error("No image provided. Please provide either imagePath, imageUrl, or imageData.");
      }
    
      // Prepare request for Google Cloud Vision API
      const request = {
        image: {
          content: content.toString('base64')
        },
        features: [
          { type: 'SAFE_SEARCH_DETECTION' },
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'TEXT_DETECTION' },
          { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
        ]
      };
      
      // Perform image annotation
      const [response] = await this.client.annotateImage(request);
      
      // Check if the API returned an error
      if (response.error && response.error.message) {
        throw new Error(`Google Vision API error: ${response.error.message}`);
      }
      
      // Process the response
      const results = this._processResponse(response, displayImage, source);
      
      // Create processed image if needed for display or export
      let processedImage = null;
      if (options.showResults || options.exportComparison) {
        processedImage = await this._createProcessedImage(displayImage, results);
      }
      
      // Export side-by-side comparison if requested
      if (options.exportComparison && processedImage) {
        const exportPath = await this._exportSideBySide(displayImage, processedImage, results, sourceFilename);
        results.export_path = exportPath;
      }
      
      // Generate HTML for display if requested
      if (options.showResults) {
        results.html = this._generateResultsHtml(results, displayImage, processedImage);
      }
      
      return results;
    
    } catch (e) {
      logger.error(`Error in image analysis: ${e.message}`);
      throw e;
    }
  }
  
  async _createProcessedImage(image, results) {
    /**
     * Create a processed image based on the analysis results
     * @param {Image} image - The original image
     * @param {Object} results - Analysis results
     * @returns {Canvas} - Processed canvas with the image
     */
    try {
      // Create canvas with image dimensions
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      
      // Draw the image on the canvas
      ctx.drawImage(image, 0, 0);
      
      // Apply blur based on safety score
      if (results.overall_safety === "unsafe") {
        this._applyGaussianBlur(ctx, this.blurSettings.unsafe);
      } else if (results.overall_safety === "questionable") {
        this._applyGaussianBlur(ctx, this.blurSettings.questionable);
      } else if (results.overall_safety === "potentially_concerning") {
        this._applyGaussianBlur(ctx, this.blurSettings.potentially_concerning);
      }
      
      // Draw bounding boxes for detected objects
      for (const obj of results.detected_objects) {
        const name = obj.name;
        const vertices = obj.bounding_box;
        const xCoords = vertices.map(v => v.x * image.width);
        const yCoords = vertices.map(v => v.y * image.height);
        
        // Determine if object is concerning
        const isConcerning = results.content_flags.some(flag => 
          flag.includes(`concerning_object:${name}`)
        );
        
        // Draw rectangle
        const color = isConcerning ? 'rgba(255, 0, 0, 0.7)' : 'rgba(0, 255, 0, 0.7)';
        
        ctx.beginPath();
        ctx.moveTo(xCoords[0], yCoords[0]);
        for (let i = 1; i < xCoords.length; i++) {
          ctx.lineTo(xCoords[i], yCoords[i]);
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Add label
        ctx.fillStyle = color;
        ctx.font = '14px Arial';
        ctx.fillText(name, Math.min(...xCoords), Math.min(...yCoords) - 5);
      }
      
      return canvas;
    } catch (e) {
      logger.error(`Error creating processed image: ${e.message}`);
      throw e;
    }
  }
  
  _applyGaussianBlur(ctx, radius) {
    /**
     * Apply a Gaussian blur effect to a canvas context
     * Note: This is a simplified version as canvas doesn't have built-in Gaussian blur
     */
    // Use a CSS filter if in browser environment
    if (typeof ctx.filter !== 'undefined') {
      ctx.filter = `blur(${radius}px)`;
      // Need to redraw the image with the filter applied
      const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.putImageData(imageData, 0, 0);
      ctx.filter = 'none';
    } else {
      // In Node.js with node-canvas, we need a different approach
      // This is a simplified blur - not true Gaussian
      const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      const pixels = imageData.data;
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      
      // Simple box blur - repeat for stronger effect
      const iterations = Math.min(Math.floor(radius / 3), 5); // Cap iterations
      
      for (let iter = 0; iter < iterations; iter++) {
        const tempData = new Uint8ClampedArray(pixels);
        
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            
            // Average of surrounding pixels (3x3 box)
            for (let c = 0; c < 3; c++) { // RGB channels
              pixels[idx + c] = Math.floor(
                (tempData[((y-1) * width + (x-1)) * 4 + c] +
                tempData[((y-1) * width + x) * 4 + c] +
                tempData[((y-1) * width + (x+1)) * 4 + c] +
                tempData[(y * width + (x-1)) * 4 + c] +
                tempData[(y * width + x) * 4 + c] +
                tempData[(y * width + (x+1)) * 4 + c] +
                tempData[((y+1) * width + (x-1)) * 4 + c] +
                tempData[((y+1) * width + x) * 4 + c] +
                tempData[((y+1) * width + (x+1)) * 4 + c]) / 9
              );
            }
          }
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
    }
  }
  
  async _exportSideBySide(originalImage, processedCanvas, results, sourceFilename) {
    /**
     * Export original and processed images side by side
     */
    try {
      // Create a new canvas with double width
      const canvas = createCanvas(originalImage.width * 2, originalImage.height);
      const ctx = canvas.getContext('2d');
      
      // Draw original image on the left
      ctx.drawImage(originalImage, 0, 0);
      
      // Draw processed image on the right
      ctx.drawImage(processedCanvas, originalImage.width, 0);
      
      // Add dividing line
      ctx.beginPath();
      ctx.moveTo(originalImage.width, 0);
      ctx.lineTo(originalImage.width, originalImage.height);
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Add safety label
      const safetyText = results.overall_safety.toUpperCase().replace(/_/g, ' ');
      const actionText = results.suggested_action.toUpperCase();
      
      ctx.font = '20px Arial';
      ctx.fillStyle = results.overall_safety === "unsafe" ? 'red' : 'orange';
      ctx.fillText(`STATUS: ${safetyText}`, originalImage.width + 10, 30);
      ctx.fillText(`ACTION: ${actionText}`, originalImage.width + 10, 60);
      
      // Generate output filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
      const baseName = path.parse(sourceFilename).name;
      const outputFilename = `${baseName}_analyzed_${timestamp}.jpg`;
      
      // Save the combined image
      const buffer = canvas.toBuffer('image/jpeg', { quality: 0.95 });
      await fs.writeFile(outputFilename, buffer);
      
      logger.info(`Exported side-by-side comparison to ${outputFilename}`);
      return outputFilename;
      
    } catch (e) {
      logger.error(`Error exporting side-by-side comparison: ${e.message}`);
      return null;
    }
  }
  
  _processResponse(response, displayImage, source) {
    /**
     * Process the Google Cloud Vision API response
     */
    const results = {
      source: source,
      image_size: `${displayImage.width}x${displayImage.height}`,
      safe_search: {},
      labels: [],
      text_content: "",
      detected_objects: [],
      content_flags: [],
      overall_safety: "safe",
      detailed_analysis: {}
    };
    
    // Convert likelihood enum to score and name
    const getLikelihoodScore = (likelihoodValue) => {
      const likelihoodMap = {
        0: { score: 0.0, name: "UNKNOWN" },
        1: { score: 0.1, name: "VERY_UNLIKELY" },
        2: { score: 0.3, name: "UNLIKELY" },
        3: { score: 0.5, name: "POSSIBLE" },
        4: { score: 0.7, name: "LIKELY" },
        5: { score: 0.9, name: "VERY_LIKELY" }
      };
      
      return likelihoodMap[likelihoodValue] || { score: 0.0, name: "UNKNOWN" };
    };
    
    // Process Safe Search
    if (response.safeSearchAnnotation) {
      const safeSearch = response.safeSearchAnnotation;
      
      // Process each safe search category
      const safeSearchResults = {
        adult: getLikelihoodScore(safeSearch.adult),
        violence: getLikelihoodScore(safeSearch.violence),
        racy: getLikelihoodScore(safeSearch.racy),
        medical: getLikelihoodScore(safeSearch.medical),
        spoof: getLikelihoodScore(safeSearch.spoof)
      };
      
      results.safe_search = safeSearchResults;
      
      // Flag content based on thresholds
      for (const [category, data] of Object.entries(safeSearchResults)) {
        if (data.score >= (this.confidenceThresholds[category] || 0.7)) {
          results.content_flags.push(category);
        }
      }
    }
    
    // Process Labels
    const labels = [];
    if (response.labelAnnotations) {
      for (const label of response.labelAnnotations) {
        labels.push({
          description: label.description,
          score: label.score,
          topicality: label.topicality
        });
      }
      results.labels = labels;
      
      // Look for potentially concerning labels
      const concerningKeywords = [
        "weapon", "gun", "knife", "blood", "drug", "alcohol", "cigarette",
        "smoking", "death", "corpse", "nazi", "hate", "explicit", "nude",
        "naked", "underwear"
      ];
      
      for (const label of labels) {
        if (concerningKeywords.some(keyword => 
            label.description.toLowerCase().includes(keyword)) && 
            label.score > 0.7) {
          results.content_flags.push(`concerning_label:${label.description}`);
        }
      }
    }
    
    // Process Text
    if (response.textAnnotations && response.textAnnotations.length > 0) {
      const fullText = response.textAnnotations[0].description;
      results.text_content = fullText;
      
      // Check for offensive content in text
      const textLower = fullText.toLowerCase();
      const offensiveWordsFound = this.offensiveTerms.filter(word => 
        textLower.includes(word)
      );
      
      if (offensiveWordsFound.length > 0) {
        results.content_flags.push("offensive_text");
        results.detailed_analysis.offensive_text = offensiveWordsFound;
      }
    }
    
    // Process Objects
    const objects = [];
    if (response.localizedObjectAnnotations) {
      for (const obj of response.localizedObjectAnnotations) {
        objects.push({
          name: obj.name,
          score: obj.score,
          bounding_box: obj.boundingPoly.normalizedVertices.map(vertex => ({
            x: vertex.x,
            y: vertex.y
          }))
        });
      }
      results.detected_objects = objects;
      
      // Check for potentially concerning objects
      const concerningObjects = ["Weapon", "Gun", "Knife", "Alcohol", "Cigarette", "Drug"];
      for (const obj of objects) {
        if (concerningObjects.includes(obj.name) && obj.score > 0.7) {
          results.content_flags.push(`concerning_object:${obj.name}`);
        }
      }
    }
    
    // Determine overall safety
    if (results.content_flags.length > 0) {
      // Check severity - Adult and Violence are highest concerns
      if (results.content_flags.includes("adult") || results.content_flags.includes("violence")) {
        results.overall_safety = "unsafe";
      } else if (results.content_flags.includes("racy") || results.content_flags.some(flag => flag.includes("concerning_object:Weapon"))) {
        results.overall_safety = "questionable";
      } else if (results.content_flags.length > 2) { // Multiple minor flags
        results.overall_safety = "questionable";
      } else {
        results.overall_safety = "potentially_concerning";
      }
    }
    
    results.suggested_action = this._getRecommendedAction(results);
    
    return results;
  }
  
  _getRecommendedAction(results) {
    /**
     * Determine recommended action based on analysis
     */
    if (results.overall_safety === "unsafe") {
      return "block";
    } else if (results.overall_safety === "questionable") {
      return "blur";
    } else if (results.overall_safety === "potentially_concerning") {
      return "warn";
    } else {
      return "allow";
    }
  }
  
  _generateResultsHtml(results, originalImage, processedImage) {
    /**
     * Generate HTML for displaying results
     */
    // CSS styles
    const css = `
      <style>
      .results-container {
        font-family: Arial, sans-serif;
        max-width: 1200px;
        margin: 0 auto;
      }
      .results-images {
        display: flex;
        justify-content: space-between;
        margin-bottom: 20px;
      }
      .image-container {
        flex: 1;
        margin: 0 10px;
        text-align: center;
      }
      .image-container img {
        max-width: 100%;
        max-height: 500px;
      }
      .results-table {
        border-collapse: collapse;
        width: 100%;
        margin-bottom: 20px;
      }
      .results-table th, .results-table td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: left;
      }
      .results-table tr:nth-child(even) {
        background-color: #f2f2f2;
      }
      .results-table th {
        padding-top: 12px;
        padding-bottom: 12px;
        background-color: #4CAF50;
        color: white;
      }
      .safe { color: green; font-weight: bold; }
      .questionable { color: orange; font-weight: bold; }
      .unsafe { color: red; font-weight: bold; }
      .flag-item {
        margin: 5px 0;
        padding: 3px 8px;
        border-radius: 3px;
        display: inline-block;
        margin-right: 5px;
      }
      .flag-adult { background-color: #ffcccc; }
      .flag-violence { background-color: #ffaaaa; }
      .flag-racy { background-color: #ffd8b1; }
      .flag-text { background-color: #ffffcc; }
      .flag-object { background-color: #e6ccff; }
      </style>
    `;
    
    // Determine safety class for styling
    let safetyClass = "";
    if (results.overall_safety === "safe") {
      safetyClass = "safe";
    } else if (["potentially_concerning", "questionable"].includes(results.overall_safety)) {
      safetyClass = "questionable";
    } else {
      safetyClass = "unsafe";
    }
    
    // Image display section - omitting actual image data to keep HTML lightweight
    // In a real app, you'd use URLs or data URIs for the images
    const imagesHtml = `
      <div class="results-images">
        <div class="image-container">
          <h3>Original Image</h3>
          <p>Image display would go here</p>
        </div>
        <div class="image-container">
          <h3 class="${safetyClass}">
            ${results.overall_safety === "unsafe" ? 
              "UNSAFE CONTENT DETECTED - BLURRED" : 
              results.overall_safety === "questionable" ? 
                "Questionable Content - Blurred" : 
                results.overall_safety === "potentially_concerning" ? 
                  "Potentially Concerning - Slightly Blurred" : 
                  "No Issues Detected"}
          </h3>
          <p>Processed image display would go here</p>
        </div>
      </div>
    `;
    
    // Overview table
    let html = `
      <div class="results-container">
        <h2>Image Content Analysis Results</h2>
        ${imagesHtml}
        <table class="results-table">
          <tr>
            <th colspan="2">Overview</th>
          </tr>
          <tr>
            <td>Source</td>
            <td>${results.source}</td>
          </tr>
          <tr>
            <td>Image Size</td>
            <td>${results.image_size}</td>
          </tr>
          <tr>
            <td>Overall Safety Rating</td>
            <td class="${safetyClass}">${results.overall_safety.toUpperCase().replace(/_/g, " ")}</td>
          </tr>
          <tr>
            <td>Recommended Action</td>
            <td class="${safetyClass}">${results.suggested_action.toUpperCase()}</td>
          </tr>
    `;
    
    // Add export path if available
    if (results.export_path) {
      html += `
        <tr>
          <td>Side-by-Side Export</td>
          <td>${results.export_path}</td>
        </tr>
      `;
    }
    
    html += `</table>`;
    
    // Safe Search results
    html += `
      <table class="results-table">
        <tr>
          <th>Category</th>
          <th>Rating</th>
          <th>Confidence</th>
        </tr>
    `;
    
    for (const [category, data] of Object.entries(results.safe_search)) {
      const score = data.score;
      const likelihood = data.name;
      
      // Determine cell color based on score
      let cellClass = "";
      if (score >= 0.7) {
        cellClass = "unsafe";
      } else if (score >= 0.5) {
        cellClass = "questionable";
      } else {
        cellClass = "safe";
      }
      
      html += `
        <tr>
          <td>${category.charAt(0).toUpperCase() + category.slice(1)}</td>
          <td class="${cellClass}">${likelihood}</td>
          <td>${score.toFixed(2)}</td>
        </tr>
      `;
    }
    
    html += `</table>`;
    
    // Content flags
    if (results.content_flags.length > 0) {
      html += `
        <table class="results-table">
          <tr>
            <th>Content Flags</th>
          </tr>
          <tr>
            <td>
      `;
      
      for (const flag of results.content_flags) {
        let flagClass = "";
        if (flag === "adult") {
          flagClass = "flag-adult";
        } else if (flag === "violence") {
          flagClass = "flag-violence";
        } else if (flag === "racy") {
          flagClass = "flag-racy";
        } else if (flag.includes("text")) {
          flagClass = "flag-text";
        } else if (flag.includes("object")) {
          flagClass = "flag-object";
        }
        
        html += `<span class="flag-item ${flagClass}">${flag.replace(/_/g, " ").replace(/:/g, ": ")}</span>`;
      }
      
      html += `
            </td>
          </tr>
        </table>
      `;
    }
    
    // Text content
    if (results.text_content) {
      const escapedText = results.text_content.replace(/\n/g, "<br>");
      
      html += `
        <table class="results-table">
          <tr>
            <th>Detected Text</th>
          </tr>
          <tr>
            <td>${escapedText}</td>
          </tr>
        </table>
      `;
    }
    
    // Labels
    if (results.labels && results.labels.length > 0) {
      html += `
        <table class="results-table">
          <tr>
            <th>Image Labels</th>
          </tr>
          <tr>
            <td>
      `;
      
      const labelsText = results.labels
        .map(label => `${label.description} (${label.score.toFixed(2)})`)
        .join(", ");
      
      html += labelsText;
      
      html += `
            </td>
          </tr>
        </table>
      `;
    }
    
    html += `</div>`;
    
    return css + html;
  }
  
  // Interactive method converted to be usable in Node.js
  async analyzeImageInteractive() {
    /**
     * Interactive function to analyze images from various sources
     * For use in a command-line environment
     */
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    try {
      console.log("Image Content Filter");
      console.log("=============================================");
      console.log("Choose an input method:");
      console.log("1. Local file path");
      console.log("2. Image URL");
      
      const choice = await new Promise(resolve => {
        rl.question("Enter your choice (1-2): ", resolve);
      });
      
      let results;
      
      try {
        if (choice === "1") {
          const path = await new Promise(resolve => {
            rl.question("Enter the path to your local image file: ", resolve);
          });
          results = await this.analyzeImage({ 
            imagePath: path, 
            exportComparison: true 
          });
          
        } else if (choice === "2") {
          const url = await new Promise(resolve => {
            rl.question("Enter the image URL: ", resolve);
          });
          results = await this.analyzeImage({ 
            imageUrl: url, 
            exportComparison: true 
          });
        } else {
          console.log("Invalid choice, please run again.");
          rl.close();
          return;
        }
        
        // Let user know about the side-by-side export
        const imgExpo = await new Promise(resolve => {
          rl.question("Enter to export the image(no=0/yes=1): ", resolve);
        });
        
        if (imgExpo === "1") {
          if (results.export_path) {
            console.log(`\nSide-by-side comparison exported to: ${results.export_path}`);
          }
        }
        
        // Export results to JSON if desired
        const exportChoice = await new Promise(resolve => {
          rl.question("Export analysis results to JSON file? (y/n): ", resolve);
        });
        
        if (exportChoice.toLowerCase() === 'y') {
          const outputFile = `content_filter_results_${results.overall_safety}.json`;
          await fs.writeFile(outputFile, JSON.stringify(results, null, 2));
          console.log(`Analysis results exported to ${outputFile}`);
        }
        
      } catch (e) {
        console.error(`Error: ${e.message}`);
        logger.error(`Error: ${e.message}`);
      }
    } catch (e) {
      console.error(`Failed to initialize the content filter: ${e.message}`);
      logger.error(`Fatal error in content filter: ${e.message}`);
    } finally {
      rl.close();
    }
  }
}

// Export the class
module.exports = ImageContentFilter;

// Run the interactive function if executed directly
if (require.main === module) {
  const filter = new ImageContentFilter();
  filter.analyzeImageInteractive().catch(console.error);
}