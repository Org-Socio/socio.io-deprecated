require('dotenv').config(); // MUST be first import

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { performance } = require('perf_hooks');
const moment = require('moment');

// Type alias for clarity is handled implicitly in JS

// =================================================================
// 1. Content Detection Module - Using Google Vertex AI
// =================================================================

let vertexAiClient = null;
let projectId = null;
let location = null;
let modelName = null;

// Enhanced content detection template that covers both hate speech/profanity and sensitive info
const contentDetectionTemplate = `
Analyze the following text and identify all problematic content including hate speech, profanity, and sensitive information in any language.
Return ONLY a valid JSON with these keys:
- "hate_speech": true/false if hate speech is detected
- "profanity": true/false if profanity is detected
- "flagged_words": array of specific problematic words detected
- "flagged_sentences": array of complete sentences containing hate speech or profanity
- "sensitive_info": object containing detected sensitive information with these keys:
  - "phone_numbers": array of detected phone numbers
  - "emails": array of detected email addresses
  - "aadhaar": array of detected Aadhaar numbers (12-digit Indian ID)
  - "pan": array of detected PAN numbers (Indian tax ID)
  - "account_numbers": array of detected bank account numbers
  - "ifsc_codes": array of detected IFSC codes
  - "swift_codes": array of detected SWIFT codes
  - "passport_numbers": array of detected passport numbers
  - "credit_cards": array of detected credit card numbers
  - "gps_coordinates": array of detected GPS coordinates
  - "ssn": array of detected Social Security Numbers
  - "nhs_numbers": array of detected NHS numbers
  - "other_sensitive": array of other potentially sensitive information

TEXT: {text}

Respond with ONLY the JSON object. No other text, no explanations.
`;

function detectionPrompt(text) {
  return contentDetectionTemplate.replace('{text}', text);
}

// Define patterns for hate speech and profanity detection
const HATE_SPEECH_KEYWORDS = [
  // Violence and elimination keywords
  '\\b(?:kill|eliminate|destroy|murder|slaughter|genocide)\\s+(?:all|every|each)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\b',
  '\\b(?:death|die|eliminate|exterminate)\\s+to\\s+(?:all|every)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\b',

  // Dehumanization patterns
  '\\b(?:all|every|those)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\s+(?:are|is)\\s+(?:animals|vermin|cockroaches|rats|trash|garbage)\\b',

  // Violent action patterns
  '\\b(?:we|they|people|everyone)\\s+should\\s+(?:kill|eliminate|eradicate|remove|cleanse)\\s+(?:all|every|the|those)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\b',

  // General hate patterns
  '\\b(?:hate|despise|loathe)\\s+(?:all|every|those|these)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\b',

  // Explicit discriminatory statements
  '\\b(?:all|every|each)\\s+(?:\\w+\\s+)*(?:people|group|community|race|ethnicity)\\s+(?:should|must|need to)\\s+(?:be|get)\\s+(?:banned|deported|removed|eliminated|killed)\\b'
];

// Common profanity and slurs (abbreviated/masked to avoid explicit content)
const PROFANITY_PATTERNS = [
  // Common general profanity (abbreviated)
  '\\ba[s$][s$]\\b', '\\bb[i!]t?ch\\b', '\\bf[u\\*][c\\*]k\\b', '\\bs[h\\*][i\\*]t\\b',
  '\\bd[a\\*]mn\\b', '\\bh[e\\*]ll\\b', '\\bcr[a\\*]p\\b', '\\bd[i\\*]ck\\b', '\\bf[u\\*]ck(?:er|ing|ed)?\\b',

  // Hindi/Urdu profanity
  '\\bg[a\\*][a\\*]nd\\b', '\\bch[u\\*]t[i\\*]ya\\b', '\\bb[e\\*][h\\*][e\\*]n ?ch[o\\*]d\\b',

  // Various slurs (intentionally abbreviated)
  '\\bn[i\\*]gg[e\\*]r\\b', '\\bf[a\\*]g\\b', '\\bc[u\\*]nt\\b',

  // Common substitutions
  '\\bf\\*\\*k\\b', '\\bs\\*\\*t\\b', '\\ba\\*\\*\\b', '\\bb\\*\\*\\*h\\b'
];

async function setupVertexAi(project = null, loc = null, model = null) {
  // Check for existing working client instance
  if (vertexAiClient !== null) {
    console.log("Using existing Vertex AI client instance");
    return vertexAiClient;
  }

  // Get configuration from environment variables if not provided
  if (!project) {
    project = process.env.GOOGLE_CLOUD_PROJECT;
  }
  if (!loc) {
    loc = process.env.VERTEX_AI_LOCATION || "us-central1";
  }
  if (!model) {
    model = process.env.VERTEX_AI_MODEL || "text-bison@002";
  }

  // Consider using a more modern model if available
  if (model === "text-bison@002") {
    // Suggest alternative models if text-bison is specified
    console.log("Note: Consider using a newer model like 'gemini-1.5-flash-001'");
  }

  // Check if project ID is available
  if (!project) {
    console.log("ERROR: No Google Cloud project ID provided.");
    console.log("Set your project ID using the GOOGLE_CLOUD_PROJECT environment variable");
    console.log("or pass it as a parameter to setupVertexAi()");
    return null;
  }

  try {
    // Import the aiplatform module dynamically
    const { PredictionServiceClient } = require('@google-cloud/aiplatform');

    // Initialize Vertex AI client
    const endpoint = `projects/${project}/locations/${loc}`;
    const client = new PredictionServiceClient({
      projectId: project,
      apiEndpoint: `${loc}-aiplatform.googleapis.com`
    });

    // Store the configuration for later use
    vertexAiClient = client;
    projectId = project;
    location = loc;
    modelName = model;

    console.log(`Google Vertex AI initialized with project: ${project}, location: ${loc}, model: ${model}`);

    // Test the connection by accessing available endpoints
    try {
      // Just check if we can access the client (simplified test)
      if (vertexAiClient) {
        console.log(`Vertex AI model ${modelName} connected successfully`);
        return vertexAiClient;
      } else {
        console.log("VertexAI client initialization failed");
        return null;
      }
    } catch (e) {
      console.log(`Vertex AI test failed: ${e.message}`);
      return null;
    }

  } catch (e) {
    console.log(`Error initializing Vertex AI: ${e.message}`);
    return null;
  }
}

// Function to detect hate speech and profanity
function detectHateSpeechProfanity(text) {
  const results = {
    "hate_speech": false,
    "profanity": false,
    "flagged_words": [],
    "flagged_sentences": []
  };

  // Improved sentence splitting - handle multiple punctuation and line breaks
  let sentences = [];
  // First split by newlines to preserve paragraph structure
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    // Then split each paragraph into sentences
    const paragraphSentences = paragraph.split(/(?<=[.!?])\s+|(?<=[.!?])$/);
    // Filter out empty strings
    const filteredSentences = paragraphSentences
      .map(s => s.trim())
      .filter(s => s.length > 0);
    sentences = sentences.concat(filteredSentences);
  }

  // Check each sentence for hate speech patterns
  for (const sentence of sentences) {
    let hasHateSpeech = false;
    let hasProfanity = false;
    let profanityWords = [];

    // Check for hate speech
    for (const pattern of HATE_SPEECH_KEYWORDS) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(sentence.toLowerCase())) {
        hasHateSpeech = true;
        results.hate_speech = true;
        break;
      }
    }

    // Check for profanity
    for (const pattern of PROFANITY_PATTERNS) {
      const regex = new RegExp(pattern, 'gi');
      let match;
      while ((match = regex.exec(sentence.toLowerCase())) !== null) {
        hasProfanity = true;
        results.profanity = true;
        const flaggedWord = match[0];
        if (!results.flagged_words.includes(flaggedWord)) {
          results.flagged_words.push(flaggedWord);
        }
        profanityWords.push(flaggedWord);
      }
    }

    // Add sentence to flagged sentences if it contains hate speech or profanity
    if (hasHateSpeech || hasProfanity) {
      if (!results.flagged_sentences.includes(sentence)) {
        results.flagged_sentences.push(sentence);
      }
    }
  }

  return results;
}

const PATTERNS = {
  // Indian phone numbers - start with 6, 7, 8, or 9 followed by 9 digits
  "phone_numbers": [
    '\\b(?:\\+91[\\s-]?)?[6-9]\\d{9}\\b',  // Indian format with or without +91
    '\\b(?:0)?[6-9]\\d{9}\\b',           // With optional 0 prefix
    '\\b[6-9]\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{4}\\b',  // With separators
  ],

  // Email addresses
  "emails": [
    '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b'
  ],

  // Aadhaar numbers (12 digits, often with spaces after every 4 digits)
  "aadhaar": [
    '\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b'
  ],

  // PAN (Permanent Account Number) - 5 uppercase letters followed by 4 digits and 1 uppercase letter
  "pan": [
    '\\b[A-Z]{5}[0-9]{4}[A-Z]\\b'
  ],

  // Bank account numbers (generally 9-18 digits)
  "account_numbers": [
    '\\b(?:acc(?:ount)?(?:\\s?(?:no|number|#))?\\s?[:=]?\\s?)?\\d{9,18}\\b',  // With potential prefix
    '\\ba/c\\s?(?:no|#|:|=)?\\s?\\d{9,18}\\b',  // a/c format
    '\\bank\\s?(?:no|#|:|=)?\\s?\\d{9,18}\\b'   // bank no format
  ],

  // IFSC codes for Indian banks (4 chars + 0 + 6 chars/digits)
  "ifsc_codes": [
    '\\b[A-Z]{4}0[A-Z0-9]{6}\\b'
  ],

  // SWIFT codes for international banks (8 or 11 characters)
  "swift_codes": [
    '\\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\\b'
  ],

  // Credit card numbers (with or without separators)
  "credit_cards": [
    '\\b(?:\\d{4}[\\s-]?){3}\\d{4}\\b',  // Common format with separators
    '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\\d{3})\\d{11})\\b'  // Various card formats without separators
  ],

  // US Social Security Numbers
  "ssn": [
    '\\b\\d{3}[-\\s]?\\d{2}[-\\s]?\\d{4}\\b'
  ],

  // NHS numbers (UK National Health Service) - 10 digits with specific validation
  "nhs_numbers": [
    '\\b\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{4}\\b'
  ],

  // Passport numbers (various formats)
  "passport_numbers": [
    '\\b[A-Z]{1,2}\\d{6,9}\\b',  // Common format for many countries
    '\\b[A-Z][0-9]{7}\\b'       // US format
  ],

  // GPS coordinates
  "gps_coordinates": [
    '\\b-?\\d{1,2}\\.\\d{1,8},\\s*-?\\d{1,3}\\.\\d{1,8}\\b'  // Decimal format
  ]
};

// Context keywords that increase likelihood of correct identification
const CONTEXT_KEYWORDS = {
  "phone_numbers": ['phone', 'mobile', 'cell', 'call', 'contact', 'tel', 'telephone'],
  "emails": ['email', 'mail', 'contact', 'address', '@'],
  "aadhaar": ['aadhaar', 'aadhar', 'uid', 'unique id', 'identity', 'identification'],
  "pan": ['pan', 'permanent account', 'tax', 'income tax', 'it department'],
  "account_numbers": ['account', 'bank', 'a/c', 'acc', 'savings', 'current', 'deposit'],
  "ifsc_codes": ['ifsc', 'bank', 'branch', 'rtgs', 'neft', 'transfer'],
  "swift_codes": ['swift', 'bic', 'bank', 'international', 'transfer', 'foreign'],
  "credit_cards": ['credit', 'card', 'debit', 'visa', 'mastercard', 'amex', 'payment'],
  "ssn": ['social security', 'ssn', 'social insurance', 'national id'],
  "nhs_numbers": ['nhs', 'national health', 'health service', 'medical', 'patient'],
  "passport_numbers": ['passport', 'travel', 'document', 'visa', 'international'],
  "gps_coordinates": ['gps', 'location', 'coordinates', 'latitude', 'longitude', 'position', 'map']
};

// ======================================================
// VALIDATION FUNCTIONS
// ======================================================

function isValidIndianPhone(match) {
  // Remove any non-digit characters
  const digits = match.replace(/\D/g, '');

  // Check if starts with country code
  let cleanDigits = digits;
  if (digits.startsWith('91')) {
    cleanDigits = digits.substring(2);
  } else if (digits.startsWith('0')) {
    cleanDigits = digits.substring(1);
  }

  // Must be 10 digits and start with 6-9
  return (cleanDigits.length === 10 &&
    ['6', '7', '8', '9'].includes(cleanDigits[0]));
}

function isValidEmail(match) {
  // Basic email validation
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!pattern.test(match)) {
    return false;
  }

  // Check domain has at least one dot
  const parts = match.split('@');
  if (parts.length !== 2 || !parts[1].includes('.')) {
    return false;
  }

  return true;
}

function isValidAadhaar(match) {
  // Remove any non-digit characters
  const digits = match.replace(/\D/g, '');

  // Must be exactly 12 digits
  if (digits.length !== 12) {
    return false;
  }

  // Verhoeff algorithm can be implemented for full validation
  // This is a simplified version
  return true;
}

function isValidPan(match) {
  // Must be 10 characters: 5 letters + 4 digits + 1 letter
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(match)) {
    return false;
  }

  // First character represents category (P for individual, C for company, etc.)
  const validFirstChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (!validFirstChars.includes(match[0])) {
    return false;
  }

  // Fourth character represents status (P for individual, C for company, etc.)
  const validFourthChars = "ABCFGHLJPTK";
  if (!validFourthChars.includes(match[3])) {
    return false;
  }

  return true;
}

function isValidAccountNumber(match, context) {
  // Extract only the digits from the match
  const digits = match.replace(/\D/g, '');

  // Most bank account numbers are between 9 and 18 digits
  if (digits.length < 9 || digits.length > 18) {
    return false;
  }

  // Check surrounding context for keywords that suggest this is a bank account
  const accountContext = ['account', 'bank', 'a/c', 'acc', 'savings', 'current']
    .some(keyword => context.toLowerCase().includes(keyword));

  return accountContext;
}

function isValidIfsc(match) {
  // IFSC format: First 4 characters are bank code (letters), 
  // 5th is 0, and last 6 can be alphanumeric
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(match)) {
    return false;
  }

  // Could add a check against a list of valid bank codes
  return true;
}

function isValidSwift(match) {
  // SWIFT codes are either 8 or 11 characters
  if (!(match.length === 8 || match.length === 11)) {
    return false;
  }

  // First 4 are bank code (letters)
  // Next 2 are country code (letters)
  // Next 2 are location code (letters or digits)
  // Last 3 (optional) are branch code (letters or digits)
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(match)) {
    return false;
  }

  return true;
}

function isValidCreditCard(match) {
  // Remove any non-digit characters
  const digits = match.replace(/\D/g, '');

  // Check if length is valid (13-19 digits for most cards)
  if (!(13 <= digits.length && digits.length <= 19)) {
    return false;
  }

  // Make sure it's not an Aadhaar number (to prevent false positives)
  if (digits.length === 12) {
    return false;
  }

  // Check card type based on prefix
  let validPrefix = false;
  if (digits.startsWith('4')) {  // Visa
    validPrefix = true;
  } else if (['51', '52', '53', '54', '55'].some(prefix => digits.startsWith(prefix))) {  // Mastercard
    validPrefix = true;
  } else if (['34', '37'].some(prefix => digits.startsWith(prefix))) {  // American Express
    validPrefix = true;
  } else if (['6011', '644', '65'].some(prefix => digits.startsWith(prefix))) {  // Discover
    validPrefix = true;
  } else if (['5018', '5020', '5038', '5893', '6304', '6759', '6761', '6762', '6763']
    .some(prefix => digits.startsWith(prefix))) {  // Maestro
    validPrefix = true;
  } else if (['3528', '3529', '353', '354', '355', '356', '357', '358']
    .some(prefix => digits.startsWith(prefix))) {  // JCB
    validPrefix = true;
  } else if (['36', '300', '301', '302', '303', '304', '305']
    .some(prefix => digits.startsWith(prefix))) {  // Diners Club
    validPrefix = true;
  }

  // Apply Luhn algorithm (checksum validation)
  let checksum = 0;
  const reversedDigits = digits.split('').reverse();
  for (let i = 0; i < reversedDigits.length; i++) {
    let n = parseInt(reversedDigits[i]);
    if (i % 2 === 1) {  // odd position (from right)
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    checksum += n;
  }

  return (checksum % 10 === 0) && validPrefix;
}

function isValidSsn(match) {
  // Remove any non-digit characters
  const digits = match.replace(/\D/g, '');

  // Must be exactly 9 digits
  if (digits.length !== 9) {
    return false;
  }

  // Cannot begin with 000, 666, or 900-999
  if (digits.startsWith('000') ||
    digits.startsWith('666') ||
    (digits.startsWith('9') && parseInt(digits.slice(0, 3)) >= 900)) {
    return false;
  }

  // Middle group cannot be 00
  if (digits.slice(3, 5) === '00') {
    return false;
  }

  // Last group cannot be 0000
  if (digits.slice(5) === '0000') {
    return false;
  }

  return true;
}

function isValidNhsNumber(match, text) {
  // Remove any non-digit characters
  const digits = match.replace(/\D/g, '');

  // NHS numbers are exactly 10 digits
  if (digits.length !== 10) {
    return false;
  }

  // Check if it matches the pattern of an Indian phone number
  // If it starts with 6, 7, 8, or 9, it's more likely a phone number
  if (['6', '7', '8', '9'].includes(digits[0])) {
    // Only consider it an NHS number if there's strong NHS context
    const nhsContext = text.toLowerCase().includes('nhs') ||
      text.toLowerCase().includes('national health');
    if (!nhsContext) {
      return false;
    }
  }

  // NHS checksum validation:
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let checksum = 0;

  for (let i = 0; i < 9; i++) {
    checksum += parseInt(digits[i]) * weights[i];
  }

  const remainder = checksum % 11;
  const checkDigit = (11 - remainder) % 11; // Use modulo 11 to handle the case where 11-remainder=11

  return checkDigit === parseInt(digits[9]);
}

function validateNhsNumber(match) {
  // Remove any spaces or hyphens
  const digits = match.replace(/\D/g, '');

  // NHS numbers must be 10 digits
  if (digits.length !== 10) {
    return false;
  }

  // Don't consider Indian phone numbers as NHS numbers
  if (['6', '7', '8', '9'].includes(digits[0])) {
    return false;
  }

  // Apply NHS checksum algorithm
  // Multiply each of the first 9 digits by a weight factor
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let checksum = 0;

  for (let i = 0; i < 9; i++) {
    checksum += parseInt(digits[i]) * weights[i];
  }

  // The checksum mod 11 should be 0 for a valid NHS number
  let checkDigit = 11 - (checksum % 11);
  if (checkDigit === 11) {
    checkDigit = 0;
  }

  // Compare calculated check digit with the actual last digit
  return checkDigit === parseInt(digits[9]);
}

function validateAadhaar(text) {
  // Remove any non-digits
  const digits = text.replace(/\D/g, '');

  // Check if it has exactly 12 digits
  if (digits.length !== 12) {
    return false;
  }

  // Additional checks could be added here for Aadhaar Verhoeff algorithm
  // But for simplicity, we'll just verify the length
  return true;
}

function validatePan(text) {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(text)) {
    return false;
  }
  return true;
}

function validateCreditCard(text) {
  // Remove non-digits
  const digits = text.replace(/\D/g, '');

  // Luhn algorithm check
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  // Make sure it's not an Aadhaar number (12 digits)
  if (digits.length === 12 && validateAadhaar(digits)) {
    return false;
  }

  // Apply Luhn algorithm
  let checkSum = 0;
  const numDigits = digits.length;
  const oddEven = numDigits & 1;

  for (let i = 0; i < numDigits; i++) {
    let digit = parseInt(digits[i]);
    if (((i & 1) ^ oddEven) === 0) {
      digit = digit * 2;
      if (digit > 9) {
        digit = digit - 9;
      }
    }
    checkSum = checkSum + digit;
  }

  return (checkSum % 10) === 0;
}

function regexPatternDetection(text) {
  const sensitiveInfo = {};
  const alreadyMatched = new Set(); // Track all matched strings to avoid duplicates

  // Process categories in a specific order to prioritize more specific patterns
  const categoryOrder = [
    "emails", "pan", "ifsc_codes", "swift_codes", "passport_numbers",
    "credit_cards", "ssn", "gps_coordinates", "phone_numbers", "nhs_numbers", "aadhaar",
    "account_numbers"
  ];

  // First pass: process according to priority order
  for (const category of categoryOrder) {
    const patternList = PATTERNS[category];
    const matches = [];

    for (const pattern of patternList) {
      // Find all matches for this pattern
      const regex = new RegExp(pattern, 'g');
      let match;

      while ((match = regex.exec(text)) !== null) {
        const matchedText = match[0];

        // Skip if already matched in a higher priority category
        if (alreadyMatched.has(matchedText)) {
          continue;
        }

        // Additional validation for specific types
        // Find this code section in the validation part for phone numbers
        if (category === "phone_numbers") {
          // Extract the actual digits for validation
          const digits = matchedText.replace(/\D/g, '');
          // For Indian numbers, make sure it starts with 6-9 if it's 10 digits
          if (digits.length === 10 && !['6', '7', '8', '9'].includes(digits[0])) {
            continue;
          }
          // If it's not an Indian number with country code
          if (digits.length > 10 && digits.startsWith("91") &&
            !['6', '7', '8', '9'].includes(digits[2])) {
            continue;
          }

          // Check if this could be an NHS number - if so, skip it here
          if (digits.length === 10 && validateNhsNumber(matchedText)) {
            continue;
          }
        } else if (category === "aadhaar" && !validateAadhaar(matchedText)) {
          continue;
        } else if (category === "pan" && !validatePan(matchedText)) {
          continue;
        } else if (category === "credit_cards" && !validateCreditCard(matchedText)) {
          continue;
        }


        if (digits.length === 10 && !['6', '7', '8', '9'].includes(digits[0]) && validateNhsNumber(matchedText)) {
          continue;
        } else if (category === "nhs_numbers") {
          const digits = matchedText.replace(/\D/g, '');

          if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits[0])) {
            continue;
          }

          if (!validateNhsNumber(matchedText)) {
            continue;
          }
        }

        // Additional check to prevent phone numbers being identified as account numbers
        if (category === "account_numbers") {
          const digits = matchedText.replace(/\D/g, '');
          // Skip 10-digit numbers as they are likely phone numbers
          if (digits.length === 10) {
            continue;
          }
          // Skip 12-digit numbers that validate as Aadhaar
          if (digits.length === 12 && validateAadhaar(digits)) {
            continue;
          }
        }

        // Prevent credit card numbers from matching with Aadhaar numbers
        if (category === "credit_cards") {
          const digits = matchedText.replace(/\D/g, '');
          // Skip if it's a valid Aadhaar number
          if (digits.length === 12 && validateAadhaar(digits)) {
            continue;
          }
        }

        // Add to matches and mark as matched
        matches.push(matchedText);
        alreadyMatched.add(matchedText);
      }
    }

    if (matches.length > 0) {
      sensitiveInfo[category] = [...new Set(matches)]; // Remove duplicates
    } else {
      sensitiveInfo[category] = [];
    }
  }

  // Initialize the structure for the results
  return {
    "hate_speech": false,  // Placeholder
    "profanity": false,    // Placeholder
    "flagged_words": [],   // Placeholder
    "flagged_sentences": [],
    "sensitive_info": sensitiveInfo
  };
}

async function detectWithVertexAi(text) {
  if (vertexAiClient === null) {
    console.log("No Google Vertex AI client available");
    return null;
  }

  try {
    // Format the prompt using the template
    const formattedPrompt = detectionPrompt(text);

    // Endpoint format
    const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`;

    // Import required libraries dynamically
    const { PredictionServiceClient } = require('@google-cloud/aiplatform');

    console.log("Sending text to Google Vertex AI for analysis...");

    // Create request
    const request = {
      endpoint,
      instances: [
        { content: formattedPrompt }
      ],
      parameters: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        topK: 40,
        topP: 0.8,
      }
    };

    // Make the prediction
    const [response] = await vertexAiClient.predict(request);

    // Get the prediction result
    const result = response.predictions[0];
    let content = result;

    if (typeof result === 'object' && result.content) {
      content = result.content;
    }

    // Debug output (limited to avoid overwhelming console)
    console.log(content.length > 100 ?
      `Raw Vertex AI response preview: ${content.substring(0, 100)}...` :
      `Raw Vertex AI response: ${content}`);

    // Extract JSON from the response (handle both clean and messy responses)
    try {
      // First attempt: try parsing the entire response as JSON
      return JSON.parse(content);
    } catch (e) {
      // Second attempt: extract JSON block from response
      const jsonMatch = content.match(/(\{.*\})/s);
      if (jsonMatch) {
        let jsonStr = jsonMatch[1];
        // Clean up JSON string (fix common issues)
        jsonStr = jsonStr.replace(/,\s*}/g, '}');  // Fix trailing commas
        jsonStr = jsonStr.replace(/,\s*]/g, ']');  // Fix trailing commas in arrays

        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          console.log(`JSON parsing error: ${e.message}`);
          console.log(`Problematic JSON: ${jsonStr.substring(0, 200)}...`);
          return null;
        }
      } else {
        console.log("No JSON found in Vertex AI response");
        return null;
      }
    }
  } catch (e) {
    console.log(`Google Vertex AI detection error: ${e.message}`);
    return null;
  }
}

// For Gemini models, adjust the predict call like this:
async function detectWithVertexAiGemini(text) {
  if (vertexAiClient === null) {
    console.log("No Google Vertex AI client available");
    return null;
  }

  try {
    // Import the VertexAI package correctly
    const { VertexAI } = require('@google-cloud/vertexai');

    // Format the prompt using the template
    const formattedPrompt = detectionPrompt(text);

    console.log("Sending text to Google Vertex AI Gemini for analysis...");

    // Initialize VertexAI correctly
    const vertexAi = new VertexAI({
      project: projectId,
      location: location
    });

    // Create the generative model
    const model = vertexAi.preview.getGenerativeModel({ // Add 'preview' here
      model: modelName,
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 1024,
      }
    });

    // Generate content
    const request = { contents: [{ role: "user", parts: [{ text: formattedPrompt }] }] };
    const response = await model.generateContent(request);
    const result = response.response;

    // Extract the text from the response
    const content = result.candidates[0].content.parts[0].text;

    // Debug output
    console.log(content.length > 100 ?
      `Raw Gemini response preview: ${content.substring(0, 100)}...` :
      `Raw Gemini response: ${content}`);

    // Process JSON response - same as before
    try {
      return JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/(\{.*\})/s);
      if (jsonMatch) {
        let jsonStr = jsonMatch[1];
        jsonStr = jsonStr.replace(/,\s*}/g, '}');
        jsonStr = jsonStr.replace(/,\s*]/g, ']');

        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          console.log(`JSON parsing error: ${e.message}`);
          return null;
        }
      } else {
        console.log("No JSON found in Gemini response");
        return null;
      }
    }
  } catch (e) {
    console.log(`Google Vertex AI Gemini detection error: ${e.message}`);
    return null;
  }
}

async function detectContent(text, projectId = null, location = null, modelName = null) {
  console.log("Analyzing content...");

  // Always use regex detection for sensitive information as baseline
  const regexResults = regexPatternDetection(text);

  // Set up or get Vertex AI instance
  await setupVertexAi(projectId, location, modelName);

  // Check if it's a Gemini model
  let vertexAiResults = null;

  if (modelName && modelName.toLowerCase().includes('gemini')) {
    // Use Gemini-specific code path
    vertexAiResults = await detectWithVertexAiGemini(text);
  } else {
    // Use standard Vertex AI approach
    vertexAiResults = await detectWithVertexAi(text);
  }

  // If Vertex AI detection failed completely, use regex results
  if (!vertexAiResults) {
    console.log("Using regex-based detection results (Vertex AI unavailable or failed)");
    return regexResults;
  }

  // If Vertex AI succeeded, merge with regex findings for better sensitive info detection
  console.log("Merging Vertex AI and regex detection results");

  // Ensure sensitive_info exists in Vertex AI results
  if (!vertexAiResults.sensitive_info) {
    vertexAiResults.sensitive_info = {};
  }

  // Ensure all categories exist in Vertex AI results
  for (const category in regexResults.sensitive_info) {
    if (!vertexAiResults.sensitive_info[category]) {
      vertexAiResults.sensitive_info[category] = [];
    }
  }

  // Merge sensitive info findings from regex
  for (const [category, items] of Object.entries(regexResults.sensitive_info)) {
    if (items.length > 0) {
      // Add regex findings to Vertex AI results
      if (!Array.isArray(vertexAiResults.sensitive_info[category])) {
        vertexAiResults.sensitive_info[category] = [];
      }
      vertexAiResults.sensitive_info[category].push(...items);
      // Remove duplicates
      vertexAiResults.sensitive_info[category] = [...new Set(vertexAiResults.sensitive_info[category])];
    }
  }

  // Ensure other required fields exist in the results
  for (const field of ["hate_speech", "profanity", "flagged_words", "flagged_sentences"]) {
    if (vertexAiResults[field] === undefined) {
      vertexAiResults[field] = regexResults[field];
    }
  }

  return vertexAiResults;
}

// =================================================================
// 2. Encryption/Decryption Module with Key Management
// =================================================================

function generateKey() {
  // Generate a random 32 byte key (for AES-256)
  return crypto.randomBytes(32);
}

async function saveEncryptionKey(key, filename = "encryption_key.key") {
  try {
    await fs.writeFile(filename, key);
    console.log(`Encryption key saved to ${filename}`);
    return true;
  } catch (e) {
    console.log(`Error saving encryption key: ${e.message}`);
    return false;
  }
}

async function loadEncryptionKey(filename = "encryption_key.key") {
  try {
    const key = await fs.readFile(filename);
    console.log(`Encryption key loaded from ${filename}`);
    return key;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log("No existing key found. Generating new key.");
    } else {
      console.log(`Error loading encryption key: ${e.message}`);
    }
    return null;
  }
}

// Initialize encryption with persistent key
let KEY = null;
let cipherAlgorithm = 'aes-256-cbc';

async function initializeCrypto() {
  KEY = await loadEncryptionKey();
  if (!KEY) {
    KEY = generateKey();
    await saveEncryptionKey(KEY);
  }
}

function encryptData(data) {
  if (typeof data !== 'string') {
    data = String(data);
  }

  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(cipherAlgorithm, KEY, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV + encrypted data combined (IV is needed for decryption)
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.log(`Encryption error: ${e.message}`);
    return `[ENCRYPTION_ERROR: ${e.message}]`;
  }
}

function decryptData(encryptedData) {
  try {
    // Split into IV and encrypted text
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(cipherAlgorithm, KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (e) {
    console.log(`Decryption error: ${e.message}`);
    return `[DECRYPTION_ERROR: ${e.message}]`;
  }
}

// =================================================================
// 3. Text Processing Module
// =================================================================

async function processText(text, detectionResults, action = "keep") {
  if (action === "keep") {
    return { processedText: text, encryptionLog: [] }; // No changes needed
  }

  if (!detectionResults) {
    console.log("Warning: No detection results available. Returning original text.");
    return { processedText: text, encryptionLog: [] };
  }

  let processedText = text;
  const encryptionLog = [];

  // Process sensitive information first, starting with the longest items
  const sensitiveInfo = detectionResults.sensitive_info || {};

  // Collect all sensitive items with their categories
  const allSensitiveItems = [];
  for (const [category, items] of Object.entries(sensitiveInfo)) {
    if (!items || !items.length) {
      continue;
    }

    for (const item of items) {
      if (item && typeof item === 'string' && item.trim()) {
        allSensitiveItems.push([category, item]);
      }
    }
  }

  // Sort by length (descending) to avoid substring replacement issues
  allSensitiveItems.sort((a, b) => b[1].length - a[1].length);

  // Process each sensitive item
  for (const [category, item] of allSensitiveItems) {
    if (action === "remove") {
      processedText = processedText.replace(item, `[REDACTED ${category.toUpperCase()}]`);
    } else if (action === "encrypt") {
      const encrypted = encryptData(item);
      const replacement = `[ENCRYPTED ${category.toUpperCase()}]`;
      processedText = processedText.replace(item, replacement);
      encryptionLog.push({
        'type': 'sensitive',
        'category': category,
        'original': item,
        'encrypted': encrypted,
        'position': processedText.indexOf(replacement)
      });
    }
  }

  // Handle flagged words
  const flaggedWords = detectionResults.flagged_words || [];
  if (flaggedWords.length > 0 && action !== "keep") {
    // Sort by length (descending) to avoid substring replacement issues
    flaggedWords.sort((a, b) => b.length - a.length);

    for (const word of flaggedWords) {
      if (!word || typeof word !== 'string' || !word.trim()) {
        continue;
      }

      if (action === "remove") {
        processedText = processedText.replace(word, '*'.repeat(word.length));
      } else if (action === "encrypt") {
        const encrypted = encryptData(word);
        const replacement = `[ENCRYPTED WORD]`;
        processedText = processedText.replace(word, replacement);
        encryptionLog.push({
          'type': 'flagged_word',
          'category': 'profanity',
          'original': word,
          'encrypted': encrypted,
          'position': processedText.indexOf(replacement)
        });
      }
    }
  }

  // Handle flagged sentences
  const flaggedSentences = detectionResults.flagged_sentences || [];
  if (flaggedSentences.length > 0 && action !== "keep") {
    // Sort by length (descending) to avoid substring replacement issues
    flaggedSentences.sort((a, b) => b.length - a.length);

    for (const sentence of flaggedSentences) {
      if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
        continue;
      }

      if (action === "remove") {
        processedText = processedText.replace(
          sentence,
          "[SENTENCE REMOVED DUE TO POLICY VIOLATION]"
        );
      } else if (action === "encrypt") {
        const encrypted = encryptData(sentence);
        const replacement = `[ENCRYPTED SENTENCE]`;
        processedText = processedText.replace(sentence, replacement);
        encryptionLog.push({
          'type': 'flagged_sentence',
          'category': detectionResults.hate_speech ? 'hate_speech' : 'profanity',
          'original': sentence,
          'encrypted': encrypted,
          'position': processedText.indexOf(replacement)
        });
      }
    }
  }

  // If hate speech is detected and removal is requested, offer complete removal
  if (detectionResults.hate_speech && action === "remove") {
    // In Node.js we need readline to get user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question("\nHate speech detected. Remove entire text? (y/n): ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() === 'y') {
      processedText = "[ENTIRE TEXT REMOVED DUE TO HATE SPEECH POLICY VIOLATION]";
      // Clear encryption log since entire text is removed
      encryptionLog.length = 0;
    }
  }

  return { processedText, encryptionLog };
}

// =================================================================
// 4. Logging and Tracking Module
// =================================================================

async function saveProcessingLog(originalText, processedText, detectionResults, encryptionLog, action) {
  const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
  const logFilename = `processing_log_${timestamp}.json`;

  // Create log entry
  const logEntry = {
    "timestamp": new Date().toISOString(),
    "action": action,
    "text_length": originalText.length,
    "detection_summary": {
      "hate_speech": detectionResults.hate_speech || false,
      "profanity": detectionResults.profanity || false,
      "flagged_words_count": (detectionResults.flagged_words || []).length,
      "flagged_sentences_count": (detectionResults.flagged_sentences || []).length,
      "sensitive_info_detected": Object.values(detectionResults.sensitive_info || {})
        .some(arr => arr && arr.length > 0)
    },
    "changes_made": originalText.length !== processedText.length,
    "encryption_records": encryptionLog.length
  };

  // Save encryption details separately if needed for recovery
  if (encryptionLog.length > 0) {
    const encryptionFilename = `encryption_data_${timestamp}.json`;
    try {
      await fs.writeFile(
        encryptionFilename,
        JSON.stringify(encryptionLog, null, 2),
        'utf8'
      );
      logEntry.encryption_file = encryptionFilename;
    } catch (e) {
      console.log(`Error saving encryption data: ${e.message}`);
    }
  }

  // Save the log
  try {
    await fs.writeFile(
      logFilename,
      JSON.stringify(logEntry, null, 2),
      'utf8'
    );
    console.log(`Processing log saved to ${logFilename}`);
    return logFilename;
  } catch (e) {
    console.log(`Error saving processing log: ${e.message}`);
    return null;
  }
}

// =================================================================
// 5. Recovery Module
// =================================================================

function recoverEncryptedText(processedText, encryptionLog) {
  if (!encryptionLog || !encryptionLog.length) {
    console.log("No encryption log provided. Cannot recover text.");
    return processedText;
  }

  let recoveredText = processedText;

  // Sort the encryption log by position in reverse order
  // This prevents issues with position shifting during replacement
  try {
    const sortedLog = [...encryptionLog].sort((a, b) =>
      (b.position || 0) - (a.position || 0)
    );

    for (const entry of sortedLog) {
      const encryptedData = entry.encrypted;
      if (!encryptedData) {
        continue;
      }

      let replacement = null;

      if (entry.type === 'sensitive') {
        replacement = `[ENCRYPTED ${entry.category.toUpperCase()}]`;
      } else if (entry.type === 'flagged_word') {
        replacement = "[ENCRYPTED WORD]";
      } else if (entry.type === 'flagged_sentence') {
        replacement = "[ENCRYPTED SENTENCE]";
      }

      if (replacement && recoveredText.includes(replacement)) {
        try {
          const original = decryptData(encryptedData);
          recoveredText = recoveredText.replace(replacement, original);
        } catch (e) {
          console.log(`Error decrypting entry: ${e.message}`);
          continue;
        }
      }
    }
  } catch (e) {
    console.log(`Error during recovery process: ${e.message}`);
  }

  return recoveredText;
}

async function loadEncryptionLog(filename) {
  try {
    const data = await fs.readFile(filename, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.log(`Error loading encryption log: ${e.message}`);
    return null;
  }
}

// =================================================================
// 6. Main Function and Command Line Interface
// =================================================================

async function main() {
  console.log("\n===== Text Content Processing System =====\n");

  // Initialize crypto
  await initializeCrypto();

  // Check for Google Cloud project ID
  let projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    projectId = await new Promise(resolve => {
      rl.question("Enter your Google Cloud project ID (or press Enter to set via environment variable): ", resolve);
    });

    if (projectId) {
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
    }

    rl.close();
  }

  // Get Vertex AI location and model name
  const location = process.env.VERTEX_AI_LOCATION || "us-central1";
  const modelName = process.env.VERTEX_AI_MODEL || "gemini-1.5-flash-001";

  // Get input text
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const inputMethod = await new Promise(resolve => {
    rl.question("Choose input method (1: Console, 2: File): ", resolve);
  });

  let text = "";

  if (inputMethod === "2") {
    const filename = await new Promise(resolve => {
      rl.question("Enter filename: ", resolve);
    });

    try {
      text = await fs.readFile(filename, 'utf8');
      console.log(`Loaded ${text.length} characters from ${filename}`);
    } catch (e) {
      console.log(`Error loading file: ${e.message}`);
      rl.close();
      return;
    }
  } else {
    console.log("Enter text (type 'END' on a new line when finished):");

    let line;
    while (true) {
      line = await new Promise(resolve => {
        rl.question("", resolve);
      });

      if (line.trim() === "END") {
        break;
      }

      text += line + "\n";
    }
  }

  if (!text.trim()) {
    console.log("No text provided. Exiting.");
    rl.close();
    return;
  }

  // Analyze content
  const detectionResults = await detectContent(text, projectId, location, modelName);

  if (!detectionResults) {
    console.log("Content analysis failed. Using basic pattern detection.");
    detectionResults = regexPatternDetection(text);
  }

  // Display detection results
  console.log("\n===== Content Analysis Results =====");
  console.log(`Hate Speech Detected: ${detectionResults.hate_speech || false}`);
  console.log(`Profanity Detected: ${detectionResults.profanity || false}`);

  const flaggedWords = detectionResults.flagged_words || [];
  if (flaggedWords.length > 0) {
    const displayWords = flaggedWords.slice(0, 5).join(', ');
    console.log(`Flagged Words: ${displayWords}${flaggedWords.length > 5 ? ` and ${flaggedWords.length - 5} more` : ''
      }`);
  }

  // Display sensitive information statistics
  const sensitiveInfo = detectionResults.sensitive_info || {};
  if (Object.values(sensitiveInfo).some(items => items && items.length > 0)) {
    console.log("\nSensitive Information Detected:");
    for (const [category, items] of Object.entries(sensitiveInfo)) {
      if (items && items.length > 0) {
        console.log(`- ${category.replace(/_/g, ' ').replace(
          /\b\w/g, c => c.toUpperCase()
        )}: ${items.length} found`);
      }
    }
  }

  // Choose action
  console.log("\n===== Choose Action =====");
  console.log("1: Keep original text");
  console.log("2: Remove sensitive/problematic content");
  console.log("3: Encrypt sensitive/problematic content");
  console.log("4: Recover previously encrypted text");

  const actionChoice = await new Promise(resolve => {
    rl.question("Choose action (1/2/3/4): ", resolve);
  });

  if (actionChoice === "4") {
    // Recovery mode
    const encryptionFile = await new Promise(resolve => {
      rl.question("Enter encryption data filename: ", resolve);
    });

    const encryptionLog = await loadEncryptionLog(encryptionFile);

    if (!encryptionLog) {
      console.log("Could not load encryption data. Exiting.");
      rl.close();
      return;
    }

    const recoveredText = recoverEncryptedText(text, encryptionLog);
    const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
    const recoveryFilename = `recovered_text_${timestamp}.txt`;

    try {
      await fs.writeFile(recoveryFilename, recoveredText, 'utf8');
      console.log(`Recovered text saved to ${recoveryFilename}`);
    } catch (e) {
      console.log(`Error saving recovered text: ${e.message}`);
    }

    rl.close();
    return;
  }

  // Process text based on chosen action
  let action = "keep";
  if (actionChoice === "2") {
    action = "remove";
  } else if (actionChoice === "3") {
    action = "encrypt";
  }

  // Process text
  const { processedText, encryptionLog } = await processText(text, detectionResults, action);

  // Save results
  console.log("\n===== Saving Results =====");
  const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
  const outputFilename = `processed_text_${timestamp}.txt`;

  try {
    await fs.writeFile(outputFilename, processedText, 'utf8');
    console.log(`Processed text saved to ${outputFilename}`);
  } catch (e) {
    console.log(`Error saving processed text: ${e.message}`);
    try {
      await fs.writeFile("emergency_output.txt", processedText, 'utf8');
      console.log("Emergency backup saved to emergency_output.txt");
    } catch (error) {
      console.log(`Could not save emergency backup: ${error.message}`);
    }
  }

  // Log processing details
  const logFilename = await saveProcessingLog(
    text, processedText, detectionResults, encryptionLog, action
  );

  // Offer recovery if encrypted
  if (action === "encrypt" && encryptionLog.length > 0) {
    console.log("\n===== Recovery Options =====");
    const recoverNow = await new Promise(resolve => {
      rl.question("Recover original text now? (y/n): ", resolve);
    });

    if (recoverNow.toLowerCase() === 'y') {
      const recoveredText = recoverEncryptedText(processedText, encryptionLog);
      const recoveryFilename = `recovered_text_${timestamp}.txt`;

      try {
        await fs.writeFile(recoveryFilename, recoveredText, 'utf8');
        console.log(`Recovered text saved to ${recoveryFilename}`);
      } catch (e) {
        console.log(`Error saving recovered text: ${e.message}`);
      }
    }
  }

  rl.close();
}

// Export functions for other modules to use
module.exports = {
  detectContent,
  processText,
  encryptData,
  decryptData,
  recoverEncryptedText,
  regexPatternDetection
};

// Run the main function if this script is executed directly
if (require.main === module) {
  main().catch(err => console.error("Error in main function:", err));
}