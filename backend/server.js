/**
 * Socio.io Content Moderation Backend Server
 * This Express server provides content moderation APIs for the Socio.io browser extension.
 * It uses Python scripts for advanced content filtering with Google Cloud Vision and text analysis.
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const winston = require('winston');
const ContentFilter = require('./content_filter');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load environment variables
dotenv.config();

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Check for Google Cloud credentials in various forms
const setupGoogleCredentials = () => {
  // Try multiple possible locations for Google Cloud credentials file
  const possibleCredentialPaths = [
    path.join(__dirname, 'my-project-92814-457204-c90e6bf83130.json'),
    path.join(__dirname, 'google_credentials.json')
  ];
  
  // Find the first valid credentials file
  const credentialsPath = possibleCredentialPaths.find(p => fs.existsSync(p));
  
  if (credentialsPath) {
    logger.info(`Google Cloud credentials file found at ${credentialsPath}`);
    // Set the environment variable for Google Cloud
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    return true;
  } 
  
  // Handle Google Cloud credentials from Base64 environment variable
  if (process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64) {
    try {
      const credentialsJson = Buffer.from(process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64, 'base64').toString();
      const tempCredentialsPath = path.join(__dirname, 'google_credentials_temp.json');
      fs.writeFileSync(tempCredentialsPath, credentialsJson);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredentialsPath;
      console.log('Google Cloud credentials loaded from environment variable');
    } catch (error) {
      console.error('Error setting up Google Cloud credentials:', error);
    }
  }
  
  // Check if credentials are provided as environment variables (for deployment)
  if (process.env.GOOGLE_CLOUD_CREDENTIALS_JSON) {
    logger.info('Using Google Cloud credentials from environment variable');
    
    // Write the credentials to a temporary file
    const tempCredentialsPath = path.join(os.tmpdir(), `google_credentials_${Date.now()}.json`);
    fs.writeFileSync(tempCredentialsPath, process.env.GOOGLE_CLOUD_CREDENTIALS_JSON);
    
    // Set the environment variable for Google Cloud
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredentialsPath;
    
    // Register cleanup on process exit
    process.on('exit', () => {
      try {
        if (fs.existsSync(tempCredentialsPath)) {
          fs.unlinkSync(tempCredentialsPath);
        }
      } catch (error) {
        logger.error(`Error cleaning up temporary credentials file: ${error.message}`);
      }
    });
    
    return true;
  }
  
  // Check if credentials are provided as base64 encoded string (for deployment)
  if (process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64) {
    logger.info('Using Google Cloud credentials from base64 environment variable');
    
    try {
      // Decode the base64 string
      const credentialsJson = Buffer.from(process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64, 'base64').toString();
      
      // Write the credentials to a temporary file
      const tempCredentialsPath = path.join(os.tmpdir(), `google_credentials_${Date.now()}.json`);
      fs.writeFileSync(tempCredentialsPath, credentialsJson);
      
      // Set the environment variable for Google Cloud
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredentialsPath;
      
      // Register cleanup on process exit
      process.on('exit', () => {
        try {
          if (fs.existsSync(tempCredentialsPath)) {
            fs.unlinkSync(tempCredentialsPath);
          }
        } catch (error) {
          logger.error(`Error cleaning up temporary credentials file: ${error.message}`);
        }
      });
      
      return true;
    } catch (error) {
      logger.error(`Error decoding base64 credentials: ${error.message}`);
    }
  }
  
  logger.warn('Google Cloud credentials not found in any form');
  return false;
};

// Setup Google Cloud credentials
const googleCredentialsAvailable = setupGoogleCredentials();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(cors());

// Initialize content filter
const contentFilter = new ContentFilter();

// Simple endpoint to check if the server is running
app.get('/ping', (req, res) => {
  logger.info('Received ping request');
  res.json({ status: 'ok', message: 'pong' });
});

// Filter text content for inappropriate content
app.post('/filter/text', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    logger.info(`Filtering text: ${text.substring(0, 50)}...`);
    
    // Filter the text using the async method
    const result = await contentFilter.filterText(text);
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error filtering text: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Filter image content for inappropriate content
app.post('/filter/image', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'No image URL provided' });
    }
    
    logger.info(`Filtering image: ${url}`);
    
    // Filter the image using the async method
    const result = await contentFilter.filterImage(url);
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error filtering image: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Decrypt previously filtered content
app.post('/decrypt', async (req, res) => {
  try {
    const { encrypted } = req.body;
    if (!encrypted) {
      return res.status(400).json({ error: 'No encrypted content provided' });
    }
    
    logger.info('Decrypting content...');
    
    // Decrypt the content using the async method
    const decrypted = await contentFilter.decryptContent(encrypted);
    
    return res.json({ decrypted });
  } catch (error) {
    logger.error(`Error decrypting content: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Get the status of the backend server
app.get('/status', (req, res) => {
  try {
    const stats = contentFilter.getStats();
    return res.json({
      status: 'running',
      stats,
      version: '1.0.0',
      python_integration: stats.python_available,
      google_cloud_integration: stats.google_cloud_available
    });
  } catch (error) {
    logger.error(`Error getting status: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Starting Socio.io backend server on port ${PORT}`);
  logger.info(`Google Cloud credentials: ${fs.existsSync(credentialsPath) ? 'Available' : 'Not available'}`);
});