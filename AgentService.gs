/**
 * DevRev AI agent integration.
 *
 * callAgent(text) — single text block, single API call
 */

// ── Public API ──

var OUTPUT_RULE = 'Reply with only the edited text. No preamble, no commentary. Keep the output roughly the same length as the input \u2013 do not add extra paragraphs or expand significantly.';

var SAFETY_PHRASES = [
  'ensure safety and consistency',
  'can only respond to requests within the supported guidelines',
  'could you reframe your request',
  'i cannot assist with',
  'i\'m unable to help with',
  'outside my supported guidelines'
];

function callAgent(text) {
  Logger.log('callAgent: input length=' + text.length);
  var safe = sanitizeUserText_(text);

  // Route to OpenAI by default; fall back to DevRev if PAT is set and OpenAI is not configured
  if (getOpenAIKey_()) {
    Logger.log('callAgent: using OpenAI');
    return callOpenAI(safe);
  }

  Logger.log('callAgent: using DevRev agent');
  var prompt = getPrompt();
  var message = OUTPUT_RULE + '\n\n' + prompt +
    '\n\n--- BEGIN TEXT TO EDIT ---\n' + safe + '\n--- END TEXT TO EDIT ---';
  var result = callDevRevAgent_(message);

  if (isSafetyResponse_(result)) {
    Logger.log('callAgent: safety response detected, retrying with fresh session');
    resetSessionId();
    result = callDevRevAgent_(message);
    if (isSafetyResponse_(result)) {
      throw new Error('Agent declined to process this text. Try simplifying the selection or editing the prompt.');
    }
  }

  Logger.log('callAgent: success, output length=' + result.length);
  return result;
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

function callDevRevAgent_(message, _retried) {
  var pat = getPat();
  if (!pat) throw new Error('No PAT token. Open Settings to add it.');

  var sessionId = getSessionId();
  Logger.log('callDevRevAgent_: session=' + sessionId.substring(0, 8) + '… retry=' + !!_retried);

  var start = Date.now();
  var response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': pat },
    payload: JSON.stringify({
      agent: AGENT_ID,
      event: { input_message: { message: message } },
      session_object: sessionId
    }),
    muteHttpExceptions: true
  });
  var elapsed = ((Date.now() - start) / 1000).toFixed(1);

  var code = response.getResponseCode();
  Logger.log('callDevRevAgent_: status=' + code + ' time=' + elapsed + 's');

  if (code !== 200) {
    var body = response.getContentText().substring(0, 500);
    Logger.log('callDevRevAgent_: error body=' + body);

    // Stale/stuck session — reset and retry once
    if (!_retried && (
      (code === 400 && body.indexOf('waiting_for_skill_call') !== -1) ||
      code === 504
    )) {
      Logger.log('callDevRevAgent_: stale session (code=' + code + '), resetting');
      resetSessionId();
      return callDevRevAgent_(message, true);
    }

    if (code === 401 || code === 403) {
      throw new Error('Authentication failed. Check your PAT token in Settings.');
    } else if (code === 429) {
      throw new Error('Rate limit reached. Wait a moment and try again.');
    } else {
      throw new Error('AI service error ' + code + '. Try again or start a new session.');
    }
  }

  var raw = response.getContentText();
  var parsed = parseSSEResponse(raw);
  if (!parsed) {
    Logger.log('callDevRevAgent_: empty parse from response length=' + raw.length);
    throw new Error('No message in agent response. Try starting a new session.');
  }
  return cleanAgentResponse(parsed);
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
