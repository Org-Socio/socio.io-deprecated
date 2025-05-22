const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');
const glob = require('glob');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { createLogger, format, transports } = require('winston');
const textAnalysis = require('./text_analysis');
const ImageContentFilter = require('./image_content_filter');

// Set up logging
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level}: ${message}`;
    })
  ),
  transports: [new transports.Console()]
});

// Initialize Express app
const app = express();

// Configuration
const config = {
  DEBUG: true,
  SECRET_KEY: 'socio-io-secret-key-2025',
  UPLOAD_FOLDER: 'uploads',
  LOG_FOLDER: 'logs',
  ENCRYPTION_KEY_FILE: 'encryption_key.key'
};

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Ensure directories exist
async function ensureDirectories() {
  for (const folder of [config.UPLOAD_FOLDER, config.LOG_FOLDER]) {
    try {
      await fs.mkdir(folder, { recursive: true });
    } catch (err) {
      logger.error(`Error creating directory ${folder}: ${err.message}`);
    }
  }
}

// Load or generate encryption key
async function loadEncryptionKey() {
  const keyFile = config.ENCRYPTION_KEY_FILE;
  
  try {
    // Check if the key file exists
    await fs.access(keyFile);
    // If it exists, read it
    const key = await fs.readFile(keyFile);
    console.log("Encryption key loaded from encryption_key.key");
    return key;
  } catch (err) {
    // If it doesn't exist, generate a new key
    const key = crypto.randomBytes(32);
    await fs.writeFile(keyFile, key);
    console.log("New encryption key generated and saved");
    return key;
  }
}

// Initialize encryption
let encryptionKey;
let cipher;

async function initializeEncryption() {
  encryptionKey = await loadEncryptionKey();
  // In Node.js, we won't use Fernet but our own encryption function
}

// Helper functions
async function saveProcessingLog(text, processedText, detectionResults, encryptionLog, action) {
  const timestamp = moment().format('YYYYMMDD_HHmmss');
  const filename = path.join(config.LOG_FOLDER, `processing_log_${timestamp}.json`);
  
  const logData = {
    timestamp,
    original: text,
    processed: processedText,
    detection_results: detectionResults,
    encryption_log: encryptionLog,
    action
  };
  
  try {
    await fs.mkdir(config.LOG_FOLDER, { recursive: true });
    await fs.writeFile(filename, JSON.stringify(logData, null, 2));
    return filename;
  } catch (err) {
    logger.error(`Error saving processing log: ${err.message}`);
    return null;
  }
}

async function saveEncryptionLog(originalText, encryptedText) {
  const timestamp = moment().format('YYYYMMDD_HHmmss');
  const filename = path.join(config.LOG_FOLDER, `encryption_log_${timestamp}.json`);
  
  const logData = {
    timestamp,
    original: originalText,
    encrypted: encryptedText
  };
  
  try {
    await fs.writeFile(filename, JSON.stringify(logData, null, 2));
    return filename;
  } catch (err) {
    logger.error(`Error saving encryption log: ${err.message}`);
    return null;
  }
}

async function loadEncryptionLog(filename) {
  try {
    let filepath = path.join(config.LOG_FOLDER, path.basename(filename));
    
    try {
      await fs.access(filepath);
    } catch (err) {
      // Try with the name as provided
      filepath = filename;
    }
    
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    logger.error(`Error loading encryption log: ${err.message}`);
    return null;
  }
}

// Encrypt and decrypt functions (replacing Fernet)
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = encryptionKey.slice(0, 32); // Ensure key is right length
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted; // Store IV with encrypted data
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const key = encryptionKey.slice(0, 32); // Ensure key is right length
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

// Process text based on detection results
async function processText(text, detectionResults, action) {
  let encryptionLog = {};
  
  if (action === "keep") {
    return { processedText: text, encryptionLog };
  } 
  else if (action === "remove") {
    // Replace with asterisks
    const processedText = '*'.repeat(text.length);
    return { processedText, encryptionLog };
  }
  else if (action === "encrypt") {
    // Encrypt the text
    const encryptedText = encrypt(text);
    
    // Save encryption log
    encryptionLog = {
      original: text,
      encrypted: encryptedText
    };
    
    const logFile = await saveEncryptionLog(text, encryptedText);
    encryptionLog.log_file = logFile;
    
    // Return placeholder text
    const processedText = "[Encrypted content]";
    return { processedText, encryptionLog };
  }
  else {
    return { processedText: text, encryptionLog };
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/history', async (req, res) => {
  try {
    // Get all processing logs
    const logs = [];
    const logPattern = path.join(config.LOG_FOLDER, "processing_log_*.json");
    
    const files = glob.sync(logPattern).sort().reverse();
    
    for (const filename of files) {
      try {
        const data = await fs.readFile(filename, 'utf-8');
        const log = JSON.parse(data);
        logs.push({
          timestamp: moment(log.timestamp, 'YYYYMMDD_HHmmss').toISOString(),
          action: log.action,
          detection_summary: log.detection_results
        });
      } catch (err) {
        logger.error(`Error loading log file ${filename}: ${err.message}`);
      }
    }
    
    res.json(logs);
  } catch (err) {
    logger.error(`Error getting history: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// API routes
app.get('/api/status', (req, res) => {
  res.json({
    active: true,
    version: '1.0',
    timestamp: moment().toISOString()
  });
});

app.get('/ping', (req, res) => {
  // Add CORS headers to prevent blocking
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  res.json({
    status: 'ok',
    message: 'pong'
  });
});

app.post('/analyze_text', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const text = data.text;
    const url = data.url || 'Unknown URL';
    
    logger.info(`Analyzing text from ${url}: ${text.substring(0, 50)}...`);
    
    // Detect content using our module
    const detectionResults = textAnalysis.detectContent(text);
    
    // Determine action based on detection
    let action = "keep";
    if (detectionResults.hate_speech) {
      action = "remove";
    } else if (detectionResults.profanity) {
      action = "remove";
    } else if (Object.values(detectionResults.sensitive_info || {}).some(v => v)) {
      action = "encrypt";
    }
    
    logger.info(`Action determined for text: ${action}`);
    
    // Process text based on detection results
    const { processedText, encryptionLog } = await processText(text, detectionResults, action);
    
    // Save processing log
    const logFilename = await saveProcessingLog(text, processedText, detectionResults, encryptionLog, action);
    
    // Prepare response with explanations
    const reasons = [];
    if (detectionResults.hate_speech) {
      reasons.push("Hate speech detected");
    }
    if (detectionResults.profanity) {
      reasons.push("Profanity detected");
    }
    
    // Add details about sensitive information
    for (const [category, items] of Object.entries(detectionResults.sensitive_info || {})) {
      if (items && (Array.isArray(items) ? items.length > 0 : items)) {
        reasons.push(`${category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} detected`);
      }
    }
    
    res.json({
      original_text: text,
      processed_text: processedText,
      action: action,
      reasons: reasons,
      log_file: logFilename
    });
  
  } catch (err) {
    logger.error(`Error analyzing text: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/analyze_image', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.image_url) {
      return res.status(400).json({ error: 'No image URL provided' });
    }
    
    const imageUrl = data.image_url;
    const pageUrl = data.url || 'Unknown URL';
    
    logger.info(`Analyzing image from ${pageUrl}: ${imageUrl}`);
    
    let results;
    let imageFilter;
    
    // Initialize the image content filter if not already done
    try {
      if (!global.imageFilter) {
        global.imageFilter = new ImageContentFilter();
        logger.info("Image content filter initialized successfully");
      }
      imageFilter = global.imageFilter;
      
      // Analyze the image using the image_url
      const analysisResults = await imageFilter.analyzeImage({ imageUrl, showResults: false });
      
      // Extract relevant information from the analysis results
      results = {
        overall_safety: analysisResults.overall_safety || "safe",
        content_flags: analysisResults.content_flags || [],
        confidence: 0.9,  // Default confidence
        suggested_action: analysisResults.suggested_action || "allow"
      };
      
      logger.info(`Image analysis results: ${JSON.stringify(results)}`);
      
    } catch (err) {
      logger.error(`Error during image analysis: ${err.message}`);
      // Fallback to mock results if analysis fails
      results = {
        overall_safety: "questionable",
        content_flags: ["processing_error"],
        confidence: 0.5
      };
    }
    
    // Determine action based on results
    let action = "allow";
    if (results.overall_safety === "unsafe") {
      action = "block";
    } else if (results.overall_safety === "questionable") {
      action = "blur";
    } else if (results.overall_safety === "potentially_concerning") {
      action = "blur";  // Also blur potentially concerning content
    }
    
    logger.info(`Action determined for image: ${action}`);
    
    // Prepare reasons
    const reasons = results.content_flags.map(flag => {
      return flag.replace(/_/g, ' ')
                .replace(/:/g, ': ')
                .replace(/\b\w/g, c => c.toUpperCase()) + " detected";
    });
    
    // Save log
    const timestamp = moment().format('YYYYMMDD_HHmmss');
    const logFilename = path.join(config.LOG_FOLDER, `image_log_${timestamp}.json`);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(logFilename), { recursive: true });
    
    await fs.writeFile(logFilename, JSON.stringify({
      timestamp,
      image_url: imageUrl,
      page_url: pageUrl,
      action,
      reasons,
      analysis: results
    }, null, 2));
    
    res.json({
      image_url: imageUrl,
      action,
      reasons,
      analysis: results
    });
    
  } catch (err) {
    logger.error(`Error analyzing image: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/encryption_files', async (req, res) => {
  try {
    const files = [];
    const logPattern = path.join(config.LOG_FOLDER, "encryption_log_*.json");
    
    const filenames = glob.sync(logPattern);
    
    for (const filename of filenames) {
      try {
        const stats = await fs.stat(filename);
        const data = JSON.parse(await fs.readFile(filename, 'utf-8'));
        
        files.push({
          filename: path.basename(filename),
          date: moment(stats.mtime).format('YYYY-MM-DD HH:mm:ss'),
          content_type: filename.includes('text') ? 'text' : 'unknown'
        });
      } catch (err) {
        logger.error(`Error loading encryption file ${filename}: ${err.message}`);
      }
    }
    
    res.json(files);
    
  } catch (err) {
    logger.error(`Error getting encryption files: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/recover_content', async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) {
      return res.status(400).json({ error: 'No filename provided' });
    }
    
    // Load encryption log
    const encryptionLog = await loadEncryptionLog(filename);
    if (!encryptionLog) {
      return res.status(400).json({ error: 'Invalid encryption file or file not found' });
    }
    
    // Recover the content - use original directly from log
    // (In a real app, you might need to decrypt here)
    const recoveredText = encryptionLog.original || '';
    
    res.json({
      recovered_text: recoveredText
    });
    
  } catch (err) {
    logger.error(`Error recovering content: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Additional debug endpoints
app.get('/debug/info', async (req, res) => {
  try {
    const fileCount = glob.sync(path.join(config.LOG_FOLDER, "*.json")).length;
    const keyFileExists = await fs.access(config.ENCRYPTION_KEY_FILE)
      .then(() => true)
      .catch(() => false);
    
    res.json({
      node_version: process.version,
      app_version: '1.0',
      timestamp: moment().toISOString(),
      log_files: fileCount,
      has_encryption_key: keyFileExists,
      image_filter_loaded: !!global.imageFilter
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/debug/test_detection', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const text = data.text;
    const detectionResults = textAnalysis.detectContent(text);
    
    let action = "keep";
    if (detectionResults.hate_speech) {
      action = "remove";
    } else if (detectionResults.profanity) {
      action = "remove";
    } else if (Object.values(detectionResults.sensitive_info || {}).some(v => v)) {
      action = "encrypt";
    }
    
    res.json({
      text,
      detection_results: detectionResults,
      determined_action: action
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialization and startup
async function startServer() {
  // Log startup info
  logger.info("Starting Socio.io Content Moderation Backend");
  
  // Ensure directories exist
  await ensureDirectories();
  
  // Initialize encryption
  await initializeEncryption();
  
  // Initialize the image content filter
  try {
    global.imageFilter = new ImageContentFilter();
    logger.info("Image content filter initialized successfully");
  } catch (err) {
    logger.error(`Error initializing image filter: ${err.message}`);
    logger.warn("Image filtering will use fallback mock implementation");
  }
  
  logger.info("Content filter initialized successfully");
  
  // Start the server
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

// Start the server
startServer().catch(err => {
  logger.error(`Error starting server: ${err.message}`);
});

module.exports = app; // For testing purposes