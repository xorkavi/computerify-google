/**
 * AI agent integration -- OpenAI only.
 *
 * callAgent(text) -- single text block, single API call
 */

// -- Public API --

function callAgent(text, context) {
  Logger.log('callAgent: input length=' + text.length);
  var safe = sanitizeUserText_(text);

  if (!getOpenAIKey_()) {
    throw new Error('OpenAI API key not configured. Contact your admin.');
  }

  Logger.log('callAgent: using OpenAI');
  var result = callOpenAI(safe, context);
  Logger.log('callAgent: success, output length=' + result.length);
  return result;
}

// -- Diagnostic --

function testAgent() {
  var testText = 'We leverage our AI technology to help users optimize their workflow and drive synergies across the organization.';
  Logger.log('=== AGENT DIAGNOSTIC ===');
  Logger.log('OpenAI key set: ' + (!!getOpenAIKey_()));
  try {
    var result = callAgent(testText);
    Logger.log('Changed: ' + (result !== testText));
    Logger.log('Output length: ' + result.length);
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
  }
}

// -- Input sanitization --

function sanitizeUserText_(text) {
  return text
    .replace(/---\s*(BEGIN|END)\s*TEXT\s*TO\s*EDIT\s*---/gi, '')
    .replace(/---{3,}/g, '--');
}

// =============================================================
// DevRev backend (STALE -- not in use, kept for future reference)
// =============================================================

/*
var AGENT_ID = 'don:core:dvrv-us-1:devo/787:ai_agent/1082';
var API_URL = 'https://api.dev.devrev-eng.ai/internal/ai-agents.events.execute-sync';

var OUTPUT_RULE = 'Reply with only the edited text. No preamble, no commentary. Keep the output roughly the same length as the input -- do not add extra paragraphs or expand significantly.';

var SAFETY_PHRASES = [
  'ensure safety and consistency',
  'can only respond to requests within the supported guidelines',
  'could you reframe your request',
  'i cannot assist with',
  'i\'m unable to help with',
  'outside my supported guidelines'
];

function callDevRevAgent_(message, _retried) {
  var pat = getPat();
  if (!pat) throw new Error('No PAT token. Open Settings to add it.');

  var sessionId = getSessionId();
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

  if (code !== 200) {
    var body = response.getContentText().substring(0, 500);
    if (!_retried && (
      (code === 400 && body.indexOf('waiting_for_skill_call') !== -1) ||
      code === 504
    )) {
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
    throw new Error('No message in agent response. Try starting a new session.');
  }
  return cleanAgentResponse(parsed);
}

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

function isSafetyResponse_(text) {
  if (!text) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < SAFETY_PHRASES.length; i++) {
    if (lower.indexOf(SAFETY_PHRASES[i]) !== -1) return true;
  }
  return false;
}

function cleanAgentResponse(raw) {
  var text = raw.trim();
  text = text.replace(/\s*\[<don:core:[^\]]*>\]/g, '');
  text = text.replace(/<don:core:[^>]*>/g, '');
  text = text.replace(/^\s*---+\s* /gm, '\n');
  text = text.replace(/\*\*(.+?)\*\* /g, '$1');
  text = text.replace(/\*(.+?)\* /g, '$1');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/---\s*BEGIN TEXT TO EDIT\s*---/g, '');
  text = text.replace(/---\s*END TEXT TO EDIT\s*---/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
*/
