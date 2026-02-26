/**
 * DevRev AI agent integration.
 *
 * callAgent(text)        — single text, single call
 * callAgentBatch(texts)  — multiple texts, single call with === separators
 */

// ── Public API ──

var OUTPUT_RULE = 'Reply with only the edited text. No preamble, no commentary.';

function callAgent(text) {
  var prompt = getCustomPrompt() || DEFAULT_PROMPT;
  var message = OUTPUT_RULE + '\n\n' + prompt + '\n\n' + text;
  return callDevRevAgent_(message);
}

function callAgentBatch(texts) {
  if (texts.length === 1) return [callAgent(texts[0])];

  var prompt = getCustomPrompt() || DEFAULT_PROMPT;
  var combined = texts.join('\n\n===\n\n');
  var message = OUTPUT_RULE + '\n' +
    'The text has multiple sections separated by ===. Edit each section independently and keep the === separators.\n\n' +
    prompt + '\n\n' + combined;

  var result = callDevRevAgent_(message);

  var parts = result.split(/\s*===\s*/);
  var cleaned = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p) cleaned.push(p);
  }
  return cleaned;
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

  if (response.getResponseCode() !== 200) {
    var errText = response.getContentText().substring(0, 200);
    throw new Error('API ' + response.getResponseCode() + ': ' + errText);
  }

  var raw = response.getContentText();
  var parsed = parseSSEResponse(raw);
  if (!parsed) throw new Error('No message in agent response');
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

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
