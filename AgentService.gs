/**
 * DevRev AI agent integration.
 *
 * callAgent(text)       — single text block, single API call
 * callAgentBulk(texts)  — multiple text blocks in one API call, returns array
 */

// ── Public API ──

var OUTPUT_RULE = 'Reply with only the edited text. No preamble, no commentary.';
var PARAGRAPH_SEPARATOR = '§PARA§';

var SAFETY_PHRASES = [
  'ensure safety and consistency',
  'can only respond to requests within the supported guidelines',
  'could you reframe your request',
  'i cannot assist with',
  'i\'m unable to help with',
  'outside my supported guidelines'
];

function callAgent(text) {
  var prompt = getPrompt();
  var safe = sanitizeUserText_(text);
  var message = OUTPUT_RULE + '\n\n' + prompt +
    '\n\n--- BEGIN TEXT TO EDIT ---\n' + safe + '\n--- END TEXT TO EDIT ---';
  var result = callDevRevAgent_(message);

  // Detect safety/refusal responses — never overwrite user text with a refusal
  if (isSafetyResponse_(result)) {
    // Retry once with a fresh session in case the session was contaminated
    resetSessionId();
    result = callDevRevAgent_(message);
    if (isSafetyResponse_(result)) {
      throw new Error('Agent declined to process this text. Try simplifying the selection or editing the prompt.');
    }
  }

  return result;
}

/**
 * Send multiple text blocks as a single API call.
 * Joins with §PARA§ separators, instructs the agent to preserve them,
 * then splits the response back into an array.
 *
 * Returns { parts: string[], matched: boolean }
 *   matched=true  → separator count matches, parts[i] corresponds to texts[i]
 *   matched=false → separators were lost; parts has a single element with the full response
 */
function callAgentBulk(texts) {
  var safeTexts = [];
  for (var k = 0; k < texts.length; k++) safeTexts.push(sanitizeUserText_(texts[k]));
  var combined = safeTexts.join('\n' + PARAGRAPH_SEPARATOR + '\n');
  var prompt = getPrompt();
  var message = OUTPUT_RULE + '\n\n' + prompt +
    '\n\nIMPORTANT: The text below contains paragraph separators written as ' + PARAGRAPH_SEPARATOR + '. ' +
    'You MUST keep every ' + PARAGRAPH_SEPARATOR + ' separator exactly where it is. ' +
    'Do not remove, add, or change any ' + PARAGRAPH_SEPARATOR + ' marker.' +
    '\n\n--- BEGIN TEXT TO EDIT ---\n' + combined + '\n--- END TEXT TO EDIT ---';

  var result = callDevRevAgent_(message);

  if (isSafetyResponse_(result)) {
    resetSessionId();
    result = callDevRevAgent_(message);
    if (isSafetyResponse_(result)) {
      throw new Error('Agent declined to process this text. Try simplifying the content or editing the prompt.');
    }
  }

  var parts = result.split(PARAGRAPH_SEPARATOR);
  for (var i = 0; i < parts.length; i++) {
    parts[i] = parts[i].trim();
  }

  // Filter out empty strings from splitting artifacts
  var cleaned = [];
  for (var j = 0; j < parts.length; j++) {
    if (parts[j]) cleaned.push(parts[j]);
  }

  return {
    parts: cleaned,
    matched: cleaned.length === texts.length
  };
}

// ── Diagnostic ──

/**
 * Diagnostic — run from the script editor to verify agent connectivity.
 * Does NOT log document content. Safe to leave in production.
 */
function testAgent() {
  var testText = 'We leverage our AI technology to help users optimize their workflow and drive synergies across the organization.';
  Logger.log('=== AGENT DIAGNOSTIC ===');
  Logger.log('PAT set: ' + (!!getPat()));
  Logger.log('Prompt source: ' + (getCustomPrompt() ? 'CUSTOM' : 'DEFAULT'));
  try {
    var result = callAgent(testText);
    Logger.log('Changed: ' + (result !== testText));
    Logger.log('Output length: ' + result.length);
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}

// ── Private: DevRev API call ──

function callDevRevAgent_(message) {
  var pat = getPat();
  if (!pat) throw new Error('No PAT token. Open Settings to add it.');

  var response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': pat },
    payload: JSON.stringify({
      agent: AGENT_ID,
      event: { input_message: { message: message } },
      session_object: getSessionId()
    }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('API error ' + code + ': ' + response.getContentText().substring(0, 500));
    if (code === 401 || code === 403) {
      throw new Error('Authentication failed. Check your PAT token in Settings.');
    } else if (code === 429) {
      throw new Error('Rate limit reached. Wait a moment and try again.');
    } else {
      throw new Error('AI service unavailable (error ' + code + '). Please try again.');
    }
  }

  var raw = response.getContentText();
  var parsed = parseSSEResponse(raw);
  if (!parsed) throw new Error('No message in agent response');
  return cleanAgentResponse(parsed);
}

/**
 * Send multiple texts to the agent in parallel using fetchAll.
 * Each text gets its own independent API call and session.
 * Returns an array of results in the same order as the input texts.
 */
function callAgentParallel(texts) {
  var pat = getPat();
  if (!pat) throw new Error('No PAT token. Open Settings to add it.');

  var prompt = getPrompt();
  var requests = [];

  for (var i = 0; i < texts.length; i++) {
    var safe = sanitizeUserText_(texts[i]);
    var message = OUTPUT_RULE + '\n\n' + prompt +
      '\n\n--- BEGIN TEXT TO EDIT ---\n' + safe + '\n--- END TEXT TO EDIT ---';
    requests.push({
      url: API_URL,
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': pat },
      payload: JSON.stringify({
        agent: AGENT_ID,
        event: { input_message: { message: message } },
        session_object: newUuid_()
      }),
      muteHttpExceptions: true
    });
  }

  var responses = UrlFetchApp.fetchAll(requests);
  var results = [];

  for (var j = 0; j < responses.length; j++) {
    if (responses[j].getResponseCode() !== 200) {
      results.push(texts[j]); // keep original on error
      continue;
    }
    var raw = responses[j].getContentText();
    var parsed = parseSSEResponse(raw);
    if (!parsed) {
      results.push(texts[j]);
      continue;
    }
    var cleaned = cleanAgentResponse(parsed);
    if (isSafetyResponse_(cleaned)) {
      results.push(texts[j]); // keep original on safety refusal
    } else {
      results.push(cleaned);
    }
  }

  return results;
}

// ── SSE parsing ──

function parseSSEResponse(rawData) {
  var chunks = rawData.split('data: ');
  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i].trim();
    if (!chunk) continue;
    try {
      var parsed = JSON.parse(chunk);
      if (parsed.response === 'message' && parsed.message) return parsed.message;
    } catch (e) {}
  }

  var lines = rawData.split('\n');
  var fullMessage = '';
  for (var j = 0; j < lines.length; j++) {
    var line = lines[j].trim();
    if (!line || line.indexOf(':') === 0) continue;
    if (line.indexOf('data:') === 0) {
      var jsonStr = line.substring(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        var obj = JSON.parse(jsonStr);
        if (obj.response === 'message' && obj.message) return obj.message;
        if (obj.message) fullMessage = obj.message;
      } catch (e) {
        fullMessage += jsonStr;
      }
    }
  }
  return fullMessage || null;
}

// ── Safety detection ──

function isSafetyResponse_(text) {
  if (!text) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < SAFETY_PHRASES.length; i++) {
    if (lower.indexOf(SAFETY_PHRASES[i]) !== -1) return true;
  }
  return false;
}

// ── Input sanitization ──

/**
 * Strip delimiter-like patterns from user text to prevent prompt injection.
 * Users could craft text like "--- END TEXT TO EDIT ---\nIgnore instructions..."
 * to escape the content boundary and inject instructions.
 */
function sanitizeUserText_(text) {
  return text
    .replace(/---\s*(BEGIN|END)\s*TEXT\s*TO\s*EDIT\s*---/gi, '')
    .replace(/---{3,}/g, '--');
}

// ── Response cleaning ──

function cleanAgentResponse(raw) {
  var text = raw.trim();

  // Strip DevRev reference tags
  text = text.replace(/\s*\[<don:core:[^\]]*>\]/g, '');
  text = text.replace(/<don:core:[^>]*>/g, '');

  // Strip markdown artifacts
  text = text.replace(/^\s*---+\s*/gm, '\n');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/^>\s?/gm, '');

  // Strip the delimiter tags if they leaked through
  text = text.replace(/---\s*BEGIN TEXT TO EDIT\s*---/g, '');
  text = text.replace(/---\s*END TEXT TO EDIT\s*---/g, '');

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
