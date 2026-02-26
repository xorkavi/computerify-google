/**
 * Constants and storage — ported from chrome extension background.js
 */

var AGENT_ID = 'don:core:dvrv-us-1:devo/0:ai_agent/198';
var API_URL = 'https://api.devrev.ai/internal/ai-agents.events.execute-sync';

var DEFAULT_PROMPT =
  'You\u2019re an expert copywriter, trained in Computer\u2019s \u201Cbrand and tone of voice guidelines\u201D ' +
  '\u2013 which are in ART-23791 in your knowledge base, and also here if that\u2019s easier to access:\n' +
  '\u2013 https://docs.google.com/presentation/d/1SzdGGIzGoyj6gVAd5Y5MZY4i-1hQKZGaSNuGMOM3LbQ/edit\n\n\n\n' +
  'Your job:\n\n' +
  'Help me edit this instructional copy so that it\u2019s on-brand for Computer, and really precise ' +
  'and easy to understand. e.g. break it down into clear steps, and bold the really important points:';

function getPat() {
  return PropertiesService.getUserProperties().getProperty('pat') || '';
}

function savePat(token) {
  PropertiesService.getUserProperties().setProperty('pat', token || '');
}

function getCustomPrompt() {
  return PropertiesService.getUserProperties().getProperty('customPrompt') || '';
}

function saveCustomPrompt(prompt) {
  PropertiesService.getUserProperties().setProperty('customPrompt', prompt || '');
  resetSessionId();
}

function getSessionId() {
  var props = PropertiesService.getUserProperties();
  var id = props.getProperty('sessionId');
  if (!id) {
    id = newUuid_();
    props.setProperty('sessionId', id);
  }
  return id;
}

function resetSessionId() {
  var id = newUuid_();
  PropertiesService.getUserProperties().setProperty('sessionId', id);
  return id;
}

function newUuid_() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
