/**
 * Computerify — Google Workspace Add-on
 *
 * Two entry points:
 * 1. Extensions menu → instant text replacement
 * 2. CardService sidebar → full UI with settings
 */

// Icon: Deploy this script as a web app (Publish → Deploy as web app),
// then replace this URL with your web app URL + "?icon=1"

var LOGO_URL = 'https://raw.githubusercontent.com/xorkavi/computerify-google/main/icons/icon128.png';

// Serves the SVG icon when deployed as a web app.
// Deploy once, then set LOGO_URL to your web app URL + "?icon=1"
function doGet(e) {
  var svg =
    '<svg width="48" height="48" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M8.40252 14H5.91945L5.42383 4.70325H8.61843L8.40496 14H8.40252Z" fill="#302E2F" fill-opacity="0.94"/>' +
    '<path d="M14.3809 4.70325H17.5755L17.0798 14H14.5968L14.3833 4.70325H14.3809Z" fill="#302E2F" fill-opacity="0.94"/>' +
    '</svg>';
  return ContentService.createTextOutput(svg).setMimeType(ContentService.MimeType.XML);
}

// ═══════════════════════════════════════════
// EXTENSIONS MENU
// ═══════════════════════════════════════════

function onOpen(e) {
  var ui = getUi_();
  if (ui) {
    ui.createAddonMenu()
      .addItem('Computerify selection', 'menuComputerify_')
      .addItem('New session', 'menuNewSession_')
      .addSeparator()
      .addItem('Edit prompt', 'menuEditPrompt_')
      .addItem('Reset prompt to default', 'menuResetPrompt_')
      .addSeparator()
      .addItem('Set PAT token', 'menuSetPat_')
      .addToUi();
  }
}

function onInstall(e) { onOpen(e); }

function menuComputerify_(e) {
  var ui = getUi_();
  if (!getPat()) { ui.alert('Computerify', 'No PAT token set.\nUse Extensions \u203a Computerify \u203a Set PAT token.', ui.ButtonSet.OK); return; }

  var editor = getEditorType_();

  try {
    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      if (shapes.length === 0) { ui.alert('Computerify', 'No text selected.\nSelect one or more text boxes, then try again.', ui.ButtonSet.OK); return; }
      computerifyShapes_(shapes);
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      if (!sel.found) { ui.alert('Computerify', 'No text selected.\nHighlight text first, then try again.', ui.ButtonSet.OK); return; }
      var result = callAgent(sel.text);
      replaceDocsSelection(result);
    } else {
      ui.alert('Computerify', 'Could not detect editor type.', ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert('Computerify', 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}

function menuEditPrompt_(e) {
  var current = getCustomPrompt() || DEFAULT_PROMPT;
  var html = HtmlService.createHtmlOutput(
    '<style>' +
      '* { box-sizing: border-box; margin: 0; font-family: "Google Sans", Roboto, sans-serif; }' +
      'body { padding: 16px; }' +
      'textarea { width: 100%; height: 200px; padding: 10px; font-size: 13px; line-height: 1.5; ' +
        'border: 1px solid #dadce0; border-radius: 8px; resize: vertical; }' +
      'textarea:focus { outline: none; border-color: #1A73E8; box-shadow: 0 0 0 1px #1A73E8; }' +
      '.bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }' +
      'button { padding: 8px 20px; border-radius: 20px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; }' +
      '.ok { background: #1A73E8; color: #fff; } .ok:hover { background: #1765CC; }' +
      '.no { background: #f1f3f4; color: #5f6368; } .no:hover { background: #e8eaed; }' +
    '</style>' +
    '<textarea id="p">' + escapeHtml_(current) + '</textarea>' +
    '<div class="bar">' +
      '<button class="no" onclick="google.script.host.close()">Cancel</button>' +
      '<button class="ok" onclick="save()">Save</button>' +
    '</div>' +
    '<script>' +
      'function save(){' +
        'var v=document.getElementById("p").value;' +
        'google.script.run.withSuccessHandler(function(){google.script.host.close()}).saveCustomPrompt(v);' +
      '}' +
    '</script>'
  ).setWidth(500).setHeight(320);
  getUi_().showModalDialog(html, 'Edit Prompt');
}

function menuNewSession_(e) {
  resetSessionId();
  getUi_().alert('Computerify', 'New session started.', getUi_().ButtonSet.OK);
}

function menuResetPrompt_(e) {
  var ui = getUi_();
  saveCustomPrompt('');
  ui.alert('Computerify', 'Prompt reset to default.', ui.ButtonSet.OK);
}

function menuSetPat_(e) {
  var ui = getUi_();
  var hasPat = !!getPat();
  var msg = hasPat
    ? 'Token is currently set. Enter a new one to replace it:'
    : 'Paste your DevRev Personal Access Token:';
  var resp = ui.prompt('Set PAT Token', msg, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() === ui.Button.OK) {
    var token = resp.getResponseText().trim();
    if (token) {
      savePat(token);
      ui.alert('Computerify', 'PAT token saved.', ui.ButtonSet.OK);
    }
  }
}

// ═══════════════════════════════════════════
// CARDSERVICE SIDEBAR
// ═══════════════════════════════════════════

function onDocsHomepage(e) { return buildHomepageCard_(); }
function onSlidesHomepage(e) { return buildHomepageCard_(); }

// ── Card: Homepage ──

function buildHomepageCard_() {
  var hasPat = !!getPat();

  var card = CardService.newCardBuilder();

  // Status
  var status = CardService.newCardSection();

  if (hasPat) {
    status.addWidget(CardService.newDecoratedText()
      .setText('<font color="#188038">Connected</font>')
      .setBottomLabel('DevRev agent ready')
      .setStartIcon(CardService.newIconImage()
        .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/check_circle/v11/gm_grey-24dp/2x/gm_check_circle_gm_grey_24dp.png')));
  } else {
    status.addWidget(CardService.newDecoratedText()
      .setText('<font color="#EA8600">Not configured</font>')
      .setBottomLabel('Add PAT token in Settings')
      .setStartIcon(CardService.newIconImage()
        .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/warning/v11/gm_grey-24dp/2x/gm_warning_gm_grey_24dp.png')));
  }

  card.addSection(status);

  // Action
  var action = CardService.newCardSection();

  action.addWidget(CardService.newTextParagraph()
    .setText('Select text in your document, then click below.'));

  action.addWidget(CardService.newTextButton()
    .setText('Computerify selection')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#1A73E8')
    .setOnClickAction(CardService.newAction().setFunctionName('cardComputerify'))
    .setDisabled(!hasPat));

  card.addSection(action);

  // Settings
  var footer = CardService.newCardSection();

  footer.addWidget(CardService.newDecoratedText()
    .setText('New session')
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/refresh/v11/gm_grey-24dp/2x/gm_refresh_gm_grey_24dp.png'))
    .setOnClickAction(CardService.newAction().setFunctionName('cardNewSession')));

  footer.addWidget(CardService.newDecoratedText()
    .setText('Settings')
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/settings/v17/gm_grey-24dp/2x/gm_settings_gm_grey_24dp.png'))
    .setOnClickAction(CardService.newAction().setFunctionName('cardShowSettings')));

  card.addSection(footer);

  return card.build();
}

// ── Card action: Computerify ──

function cardComputerify(e) {
  if (!getPat()) return cardNotify_('No PAT token. Open Settings first.');

  var editor = getEditorType_();

  try {
    var count = 0;

    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      if (shapes.length === 0) return cardNotify_('No text selected. Select text boxes first.');
      count = computerifyShapes_(shapes);
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      if (!sel.found) return cardNotify_('No text selected. Highlight text first.');
      var r = callAgent(sel.text);
      replaceDocsSelection(r);
      count = 1;
    } else {
      return cardNotify_('Could not detect editor type.');
    }

    return cardNotify_('Done \u2014 ' + count + ' text block' + (count > 1 ? 's' : '') + ' updated');

  } catch (err) {
    return cardNotify_('Error: ' + err.message);
  }
}

// ── Card: Result ──

function buildResultCard_(originals, results) {
  var count = results.length;
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Updated')
      .setSubtitle(count + ' text block' + (count > 1 ? 's' : '') + ' transformed')
      .setImageUrl(LOGO_URL)
      .setImageStyle(CardService.ImageStyle.CIRCLE));

  // Success banner
  var banner = CardService.newCardSection();
  banner.addWidget(CardService.newDecoratedText()
    .setText('<font color="#188038"><b>Text replaced in your document</b></font>')
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/check_circle/v11/gm_grey-24dp/2x/gm_check_circle_gm_grey_24dp.png')));
  card.addSection(banner);

  // Before/after for each block
  for (var i = 0; i < originals.length; i++) {
    var section = CardService.newCardSection();
    if (count > 1) section.setHeader('Block ' + (i + 1));

    section.addWidget(CardService.newDecoratedText()
      .setTopLabel('BEFORE')
      .setText('<font color="#80868B">' + escapeHtml_(truncate_(originals[i], 200)) + '</font>')
      .setWrapText(true));

    section.addWidget(CardService.newDecoratedText()
      .setTopLabel('AFTER')
      .setText(escapeHtml_(truncate_(results[i], 200)))
      .setWrapText(true));

    card.addSection(section);
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

// ── Card: Error ──

function buildErrorCard_(message) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Error'));

  var section = CardService.newCardSection();

  section.addWidget(CardService.newDecoratedText()
    .setText('<font color="#D93025"><b>Could not transform text</b></font>')
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/error/v11/gm_grey-24dp/2x/gm_error_gm_grey_24dp.png')));

  section.addWidget(CardService.newTextParagraph()
    .setText(escapeHtml_(message)));

  card.addSection(section);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

// ── Card: Settings ──

function cardNewSession(e) {
  resetSessionId();
  return cardNotify_('New session started');
}

function cardShowSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard_()))
    .build();
}

function buildSettingsCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Settings'));

  // PAT token
  var patSection = CardService.newCardSection().setHeader('Authentication');

  patSection.addWidget(CardService.newTextInput()
    .setFieldName('pat')
    .setTitle('DevRev PAT Token')
    .setHint('Stored securely in your Google account')
    .setValue(getPat()));

  card.addSection(patSection);

  // Prompt
  var promptSection = CardService.newCardSection().setHeader('Prompt');

  promptSection.addWidget(CardService.newTextInput()
    .setFieldName('prompt')
    .setTitle('Custom Prompt')
    .setHint('Leave blank to use default')
    .setMultiline(true)
    .setValue(getCustomPrompt() || DEFAULT_PROMPT));

  promptSection.addWidget(CardService.newDecoratedText()
    .setText('Reset to default')
    .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.INVITE))
    .setOnClickAction(CardService.newAction().setFunctionName('cardResetPrompt')));

  card.addSection(promptSection);

  // Save
  var actions = CardService.newCardSection();

  actions.addWidget(CardService.newTextButton()
    .setText('Save settings')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#1A73E8')
    .setOnClickAction(CardService.newAction().setFunctionName('cardSaveSettings')));

  card.addSection(actions);

  return card.build();
}

function cardSaveSettings(e) {
  var pat = (e.formInput && e.formInput.pat) ? e.formInput.pat.trim() : '';
  var prompt = (e.formInput && e.formInput.prompt) ? e.formInput.prompt.trim() : '';

  if (!pat) return cardNotify_('PAT token is required.');

  savePat(pat);
  saveCustomPrompt(prompt === DEFAULT_PROMPT ? '' : prompt);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildHomepageCard_()))
    .setNotification(CardService.newNotification().setText('Settings saved'))
    .build();
}

function cardResetPrompt(e) {
  saveCustomPrompt('');
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildSettingsCard_()))
    .setNotification(CardService.newNotification().setText('Prompt reset to default'))
    .build();
}

// ═══════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════

/**
 * Batch-transform multiple Slides shapes in a single agent call.
 * Sends all texts joined with === separators, splits the result back.
 */
function computerifyShapes_(shapes) {
  if (shapes.length === 1) {
    var r = callAgent(shapes[0].text);
    shapes[0].shape.getText().setText(r);
    return 1;
  }

  var texts = [];
  for (var i = 0; i < shapes.length; i++) texts.push(shapes[i].text);

  var results = callAgentBatch(texts);

  for (var j = 0; j < shapes.length; j++) {
    if (j < results.length) {
      shapes[j].shape.getText().setText(results[j]);
    }
  }
  return shapes.length;
}

function getSelection_() {
  var type = getEditorType_();
  if (type === 'docs') return getDocsSelection();
  if (type === 'slides') return getSlidesSelection();
  return { found: false };
}

function getEditorType_() {
  try { if (DocumentApp.getActiveDocument()) return 'docs'; } catch (e) {}
  try { if (SlidesApp.getActivePresentation()) return 'slides'; } catch (e) {}
  return 'unknown';
}

function getUi_() {
  try { return DocumentApp.getUi(); } catch (e) {}
  try { return SlidesApp.getUi(); } catch (e) {}
  return null;
}

function cardNotify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function truncate_(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len) + '\u2026';
}

function escapeHtml_(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
