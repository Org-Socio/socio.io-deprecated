/**
 * Content Filter Module for Socio.io
 * This module provides content moderation functionality for text and images.
 * It uses Python scripts for advanced content filtering with Google Cloud Vision and text analysis.
 */

const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const fetch = require('node-fetch');
const { URL } = require('url');
const winston = require('winston');
const textAnalysis = require('./text_analysis');
const PythonBridge = require('./python_bridge');
const path = require('path');
const fs = require('fs');

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

class ContentFilter {
  /**
   * Initialize the content filter.
   */
  constructor() {
    this.stats = {
      text_filtered: 0,
      images_filtered: 0,
      total_requests: 0
    };
    
    // Initialize encryption key
    this.key = crypto.randomBytes(32).toString('base64');
    
    // Define inappropriate content patterns
    this.inappropriatePatterns = [
      '\\b(hate|violence|abuse|explicit|obscene)\\b',
      '\\b(racist|sexist|discriminat(e|ion|ory))\\b',
      '\\b(nsfw|porn|xxx|adult\\s+content)\\b'
    ];
    
    // Compile patterns for efficiency
    this.compiledPatterns = this.inappropriatePatterns.map(pattern => new RegExp(pattern, 'i'));
    
    // Initialize Python bridge for advanced content filtering
    try {
      this.pythonBridge = new PythonBridge();
      logger.info('Python bridge initialized for advanced content filtering');
      this.pythonAvailable = true;
    } catch (error) {
      logger.error(`Error initializing Python bridge: ${error.message}`);
      this.pythonAvailable = false;
    }
    
    // Check if Google Cloud credentials are available
    this.googleCloudAvailable = false;
    const credentialsPath = path.join(__dirname, 'my-project-92814-457204-c90e6bf83130.json');
    if (fs.existsSync(credentialsPath)) {
      logger.info('Google Cloud credentials found');
      this.googleCloudAvailable = true;
    } else {
      logger.warn('Google Cloud credentials not found');
    }
    
    logger.info('Content filter initialized');
  }
  
  /**
   * Filter text content for inappropriate content.
   * 
   * @param {string} text - The text to filter
   * @returns {object} Result of the filtering operation
   */
  async filterText(text) {
    this.stats.total_requests += 1;
    
    if (!text || text.length < 3) {
      return {
        filtered: false,
        reason: 'Text too short',
        original: text,
        modified: text
      };
    }
    
    // Try to use Python for advanced filtering if available
    if (this.pythonAvailable) {
      try {
        logger.info('Using Python for advanced text filtering');
        const result = await this.pythonBridge.filterText(text);
        
        // Update stats if content was filtered
        if (result.filtered) {
          this.stats.text_filtered += 1;
        }
        
        return result;
      } catch (error) {
        logger.error(`Error using Python for text filtering: ${error.message}`);
        logger.info('Falling back to JavaScript implementation');
        // Fall back to JavaScript implementation
      }
    }
    
    // Use the JavaScript implementation as fallback
    logger.info('Using JavaScript implementation for text filtering');
    
    // Use the text analysis module for more comprehensive detection
    const analysisResults = textAnalysis.analyzeText(text);
    
    // Check if any problematic content was detected
    const inappropriate = analysisResults.hate_speech || analysisResults.profanity || 
                         Object.values(analysisResults.sensitive_info).some(arr => arr.length > 0);
    
    if (inappropriate) {
      // Encrypt the original content
      const encrypted = this.encryptContent(text);
      
      // Replace inappropriate content with asterisks
      let modifiedText = text;
      
      // Replace flagged words with asterisks
      for (const word of analysisResults.flagged_words) {
        const regex = new RegExp(word, 'gi');
        modifiedText = modifiedText.replace(regex, match => '*'.repeat(match.length));
      }
      
      // Also use the basic patterns for additional filtering
      for (const pattern of this.compiledPatterns) {
        modifiedText = modifiedText.replace(pattern, match => '*'.repeat(match.length));
      }
      
      // Mask sensitive information
      for (const [type, items] of Object.entries(analysisResults.sensitive_info)) {
        for (const item of items) {
          // For sensitive info like credit cards, only show last 4 digits
          if (type === 'credit_cards') {
            const lastFour = item.slice(-4);
            const masked = '*'.repeat(item.length - 4) + lastFour;
            modifiedText = modifiedText.replace(new RegExp(item, 'g'), masked);
          } else {
            modifiedText = modifiedText.replace(new RegExp(item, 'g'), match => '*'.repeat(match.length));
          }
        }
      }
      
      this.stats.text_filtered += 1;
      
      return {
        filtered: true,
        reason: 'Inappropriate content detected',
        analysis: analysisResults,
        original: text,
        modified: modifiedText,
        encrypted
      };
    }
    
    return {
      filtered: false,
      reason: 'No inappropriate content detected',
      original: text,
      modified: text
    };
  }
  
  /**
   * Filter image content for inappropriate content.
   * 
   * @param {string} imageUrl - URL of the image to filter
   * @returns {object} Result of the filtering operation
   */
  async filterImage(imageUrl) {
    this.stats.total_requests += 1;
    
    // Validate URL
    try {
      const parsedUrl = new URL(imageUrl);
      if (!parsedUrl.protocol || !parsedUrl.hostname) {
        return {
          filtered: false,
          reason: 'Invalid URL',
          original: imageUrl,
          modified: imageUrl
        };
      }
    } catch (error) {
      logger.error(`Error parsing URL: ${error.message}`);
      return {
        filtered: false,
        reason: `Error parsing URL: ${error.message}`,
        original: imageUrl,
        modified: imageUrl
      };
    }
    
    // Try to use Python for advanced filtering if available
    if (this.pythonAvailable && this.googleCloudAvailable) {
      try {
        logger.info('Using Python with Google Cloud Vision for advanced image filtering');
        const result = await this.pythonBridge.filterImage(imageUrl);
        
        // Update stats if content was filtered
        if (result.filtered) {
          this.stats.images_filtered += 1;
        }
        
        return result;
      } catch (error) {
        logger.error(`Error using Python for image filtering: ${error.message}`);
        logger.info('Falling back to JavaScript implementation');
        // Fall back to JavaScript implementation
      }
    }
    
    // Use the JavaScript implementation as fallback
    logger.info('Using JavaScript implementation for image filtering');
    
    // For demonstration purposes, we'll filter images based on URL patterns
    // In a real implementation, you would use image recognition APIs
    const inappropriateUrlPatterns = [
      'nsfw',
      'adult',
      'xxx',
      'porn',
      'explicit'
    ];
    
    for (const pattern of inappropriateUrlPatterns) {
      if (imageUrl.toLowerCase().includes(pattern)) {
        this.stats.images_filtered += 1;
        
        // In a real implementation, you would replace with a placeholder image
        const placeholderImage = 'https://via.placeholder.com/400x300?text=Content+Filtered';
        
        return {
          filtered: true,
          reason: 'Potentially inappropriate image',
          original: imageUrl,
          modified: placeholderImage,
          encrypted: this.encryptContent(imageUrl)
        };
      }
    }
    
    // For demonstration purposes, randomly filter some images
    // This simulates an AI model making decisions
    if (Math.random() < 0.1) { // 10% chance of filtering
      this.stats.images_filtered += 1;
      
      // In a real implementation, you would replace with a placeholder image
      const placeholderImage = 'https://via.placeholder.com/400x300?text=Content+Filtered';
      
      return {
        filtered: true,
        reason: 'Randomly filtered for demonstration',
        original: imageUrl,
        modified: placeholderImage,
        encrypted: this.encryptContent(imageUrl)
      };
    }
    
    return {
      filtered: false,
      reason: 'No inappropriate content detected',
      original: imageUrl,
      modified: imageUrl
    };
  }
  
  /**
   * Encrypt content for secure storage.
   * 
   * @param {string} content - Content to encrypt
   * @returns {string} Encrypted content as a base64 string
   */
  encryptContent(content) {
    try {
      // Encrypt the content using CryptoJS
      const encrypted = CryptoJS.AES.encrypt(content, this.key).toString();
      return encrypted;
    } catch (error) {
      logger.error(`Error encrypting content: ${error.message}`);
      return '';
    }
  }
  
  /**
   * Decrypt previously encrypted content.
   * 
   * @param {string} encrypted - Encrypted content as a base64 string
   * @returns {string} Decrypted content
   */
  async decryptContent(encrypted) {
    // Try to use Python for decryption if available
    if (this.pythonAvailable) {
      try {
        logger.info('Using Python for decryption');
        const result = await this.pythonBridge.decryptContent(encrypted);
        return result.decrypted || '';
      } catch (error) {
        logger.error(`Error using Python for decryption: ${error.message}`);
        logger.info('Falling back to JavaScript implementation');
        // Fall back to JavaScript implementation
      }
    }
    
    // Use the JavaScript implementation as fallback
    logger.info('Using JavaScript implementation for decryption');
    
    try {
      // Decrypt the content using CryptoJS
      const bytes = CryptoJS.AES.decrypt(encrypted, this.key);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted;
    } catch (error) {
      logger.error(`Error decrypting content: ${error.message}`);
      return '';
    }
  }
  
  /**
   * Get statistics about the content filter.
   * 
   * @returns {object} Statistics about filtered content
   */
  getStats() {
    return {
      ...this.stats,
      python_available: this.pythonAvailable,
      google_cloud_available: this.googleCloudAvailable
    };
  }
}

module.exports = ContentFilter;