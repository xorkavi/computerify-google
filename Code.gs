/**
 * Copy-that — Google Workspace Add-on
 * Turn your writing into on-brand copy – instantly
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
      .addItem('Fix copy', 'menuFixCopy_')
      .addToUi();
  }
}

function onInstall(e) { onOpen(e); }

function menuFixCopy_(e) {
  var ui = getUi_();
  if (!getOpenAIKey_() && !getPat()) { ui.alert('Copy-that', 'Add-on not configured.\nContact your admin to set up this add-on.', ui.ButtonSet.OK); return; }

  var editor = getEditorType_();

  try {
    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      if (shapes.length === 0) { ui.alert('Copy-that', 'No text selected.\nSelect one or more text boxes, then try again.', ui.ButtonSet.OK); return; }
      fixCopyShapes_(shapes);
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      if (!sel.found) { ui.alert('Copy-that', 'No text selected.\nHighlight text first, then try again.', ui.ButtonSet.OK); return; }
      var result = callAgent(sel.text);
      replaceDocsSelection(result);
    } else {
      ui.alert('Copy-that', 'Could not detect editor type.', ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert('Copy-that', 'Error: ' + err.message, ui.ButtonSet.OK);
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
  getUi_().alert('Copy-that', 'New session started.', getUi_().ButtonSet.OK);
}

function menuResetPrompt_(e) {
  var ui = getUi_();
  saveCustomPrompt('');
  ui.alert('Copy-that', 'Prompt reset to default.', ui.ButtonSet.OK);
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
      ui.alert('Copy-that', 'PAT token saved.', ui.ButtonSet.OK);
    }
  }
}

// ═══════════════════════════════════════════
// CARDSERVICE SIDEBAR
// ═══════════════════════════════════════════

function onDocsHomepage(e) {
  try {
    return buildHomepageCard_();
  } catch (err) {
    Logger.log('Homepage error: ' + err.message + '\n' + err.stack);
    return buildHomepageErrorCard_(err.message);
  }
}

function onSlidesHomepage(e) {
  try {
    return buildHomepageCard_();
  } catch (err) {
    Logger.log('Homepage error: ' + err.message + '\n' + err.stack);
    return buildHomepageErrorCard_(err.message);
  }
}

// ── Card: Homepage ──

function buildHomepageCard_() {
  Logger.log('buildHomepageCard_: building');
  var hasOpenAI = !!getOpenAIKey_();
  var hasPat = !!getPat();
  var isReady = hasOpenAI || hasPat;
  Logger.log('buildHomepageCard_: openai=' + hasOpenAI + ' devrev=' + hasPat);

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Copy-that')
      .setSubtitle('Turn your writing into on-brand copy')
      .setImageUrl(LOGO_URL)
      .setImageStyle(CardService.ImageStyle.CIRCLE));

  // Status pill
  var status = CardService.newCardSection();
  if (isReady) {
    status.addWidget(CardService.newDecoratedText()
      .setText('<font color="#188038"><b>Ready</b></font>')
      .setBottomLabel(hasOpenAI ? 'Powered by AI' : 'AI agent connected')
      .setStartIcon(CardService.newIconImage()
        .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/check_circle/v11/gm_grey-24dp/2x/gm_check_circle_gm_grey_24dp.png')));
  } else {
    status.addWidget(CardService.newDecoratedText()
      .setText('<font color="#D93025"><b>Not configured</b></font>')
      .setBottomLabel('Contact your admin to set up this add-on')
      .setStartIcon(CardService.newIconImage()
        .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/error/v11/gm_grey-24dp/2x/gm_error_gm_grey_24dp.png')));
  }
  card.addSection(status);

  // Main action
  var actions = CardService.newCardSection()
    .setHeader('Actions');

  actions.addWidget(CardService.newDecoratedText()
    .setText('<b>Fix copy</b>')
    .setBottomLabel('Rewrite selected text on-brand')
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/edit/v11/gm_grey-24dp/2x/gm_edit_gm_grey_24dp.png'))
    .setOnClickAction(CardService.newAction().setFunctionName('cardFixCopy')));

  card.addSection(actions);

  return card.build();
}

// ── Card action: Fix copy ──

function cardFixCopy(e) {
  Logger.log('cardFixCopy: start');
  if (!getOpenAIKey_() && !getPat()) {
    Logger.log('cardFixCopy: no backend configured');
    return buildErrorCard_('Add-on not configured. Contact your admin.');
  }

  var editor = getEditorType_();
  Logger.log('cardFixCopy: editor=' + editor);

  try {
    var count = 0;

    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      Logger.log('cardFixCopy: shapes found=' + shapes.length);
      if (shapes.length === 0) {
        return buildErrorCard_('No text selected.\n\nSelect one or more text boxes in your slide, then try again.');
      }
      count = fixCopyShapes_(shapes);
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      Logger.log('cardFixCopy: docs selection found=' + sel.found + ' mode=' + (sel.mode || 'none'));
      if (!sel.found) {
        return buildErrorCard_('No text selected.\n\nHighlight text in your document, then try again. Tip: click inside a paragraph if the sidebar took focus.');
      }
      var r = callAgent(sel.text);
      replaceDocsSelection(r);
      count = 1;
    } else {
      return buildErrorCard_('Could not detect editor type. Make sure you\'re in Google Docs or Slides.');
    }

    Logger.log('cardFixCopy: success, count=' + count);
    return cardNotify_('Done \u2014 ' + count + ' text block' + (count > 1 ? 's' : '') + ' updated');

  } catch (err) {
    Logger.log('cardFixCopy: ERROR ' + err.message + '\n' + err.stack);
    return buildErrorCard_(err.message);
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
  Logger.log('cardNewSession: resetting');
  resetSessionId();
  Logger.log('cardNewSession: done');
  return cardNotify_('New session started');
}

function cardEditPrompt(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildPromptCard_()))
    .build();
}

function buildPromptCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Edit prompt'));

  var section = CardService.newCardSection();

  section.addWidget(CardService.newTextParagraph()
    .setText('Customize the instructions sent to the AI agent. Leave blank to use the default.'));

  section.addWidget(CardService.newTextInput()
    .setFieldName('prompt')
    .setTitle('Prompt')
    .setMultiline(true)
    .setValue(getCustomPrompt() || DEFAULT_PROMPT));

  card.addSection(section);

  card.setFixedFooter(CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText('Save prompt')
      .setOnClickAction(CardService.newAction().setFunctionName('cardSavePrompt')))
    .setSecondaryButton(CardService.newTextButton()
      .setText('Reset to default')
      .setOnClickAction(CardService.newAction().setFunctionName('cardResetPrompt'))));

  return card.build();
}

function cardSavePrompt(e) {
  var prompt = (e.formInput && e.formInput.prompt) ? e.formInput.prompt.trim() : '';
  saveCustomPrompt(prompt === DEFAULT_PROMPT ? '' : prompt);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .setNotification(CardService.newNotification().setText('Prompt saved'))
    .build();
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

  var currentPat = getPat();
  if (currentPat) {
    patSection.addWidget(CardService.newDecoratedText()
      .setText('Token configured')
      .setBottomLabel('Ending in \u2026' + currentPat.slice(-6))
      .setStartIcon(CardService.newIconImage()
        .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/lock/v11/gm_grey-24dp/2x/gm_lock_gm_grey_24dp.png')));
  }
  patSection.addWidget(CardService.newTextInput()
    .setFieldName('pat')
    .setTitle(currentPat ? 'Replace token' : 'DevRev PAT Token')
    .setHint('Paste a new token to ' + (currentPat ? 'replace' : 'set up')));

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
  Logger.log('cardSaveSettings: saving');
  var pat = (e.formInput && e.formInput.pat) ? e.formInput.pat.trim() : '';
  var prompt = (e.formInput && e.formInput.prompt) ? e.formInput.prompt.trim() : '';

  if (!pat && !getPat()) return cardNotify_('PAT token is required.');

  if (pat) savePat(pat);
  saveCustomPrompt(prompt === DEFAULT_PROMPT ? '' : prompt);

  Logger.log('cardSaveSettings: done, pat=' + (pat ? 'updated' : 'unchanged'));
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
 * Transform each shape individually — one API call per shape.
 */
function fixCopyShapes_(shapes) {
  Logger.log('fixCopyShapes_: processing ' + shapes.length + ' shape(s)');
  var count = 0;
  for (var i = 0; i < shapes.length; i++) {
    Logger.log('fixCopyShapes_: shape ' + (i + 1) + '/' + shapes.length + ' len=' + shapes[i].text.length);
    var r = callAgent(shapes[i].text);
    replaceShapeTextPreserveStyle_(shapes[i].shape, r);
    count++;
  }
  Logger.log('fixCopyShapes_: done, count=' + count);
  return count;
}

/**
 * Replace shape text while preserving paragraph and text styles.
 * Maps new paragraphs to old ones by index — extra old paragraphs are cleared,
 * extra new paragraphs inherit the style of the last original paragraph.
 */
function replaceShapeTextPreserveStyle_(shape, newText) {
  var textRange = shape.getText();
  var oldParagraphs = textRange.getParagraphs();
  var newLines = newText.split('\n');

  // Snapshot styles from each original paragraph's first character
  var styles = [];
  for (var i = 0; i < oldParagraphs.length; i++) {
    var pRange = oldParagraphs[i].getRange();
    styles.push({
      paragraphStyle: pRange.getParagraphStyle(),
      textStyle: pRange.getTextStyle()
    });
  }

  // Fall back to simple setText if only one paragraph or snapshot failed
  if (styles.length <= 1) {
    textRange.setText(newText);
    return;
  }

  // Clear and rewrite
  textRange.setText(newText);

  // Re-apply styles to each new paragraph
  var newParagraphs = textRange.getParagraphs();
  for (var j = 0; j < newParagraphs.length; j++) {
    var styleIdx = Math.min(j, styles.length - 1);
    var src = styles[styleIdx];
    var dest = newParagraphs[j].getRange();

    try {
      // Preserve font size — the most visible style difference (heading vs body)
      var fontSize = src.textStyle.getFontSize();
      if (fontSize) dest.getTextStyle().setFontSize(fontSize);

      var bold = src.textStyle.isBold();
      if (bold !== null) dest.getTextStyle().setBold(bold);

      var fontFamily = src.textStyle.getFontFamily();
      if (fontFamily) dest.getTextStyle().setFontFamily(fontFamily);

      var color = src.textStyle.getForegroundColor();
      if (color) dest.getTextStyle().setForegroundColor(color);

      var spacing = src.paragraphStyle.getSpaceAbove();
      if (spacing !== null) dest.getParagraphStyle().setSpaceAbove(spacing);

      var spacingBelow = src.paragraphStyle.getSpaceBelow();
      if (spacingBelow !== null) dest.getParagraphStyle().setSpaceBelow(spacingBelow);
    } catch (e) {
      Logger.log('replaceShapeTextPreserveStyle_: style copy failed for paragraph ' + j + ': ' + e.message);
    }
  }
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

function buildHomepageErrorCard_(message) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Copy-that')
      .setSubtitle('Something went wrong'));

  var section = CardService.newCardSection();
  section.addWidget(CardService.newDecoratedText()
    .setText('<font color="#D93025"><b>Failed to load add-on</b></font>')
    .setWrapText(true));
  section.addWidget(CardService.newTextParagraph()
    .setText(escapeHtml_(message || 'Unknown error')));
  section.addWidget(CardService.newTextParagraph()
    .setText('<font color="#80868B">Try closing and reopening the sidebar. If the issue persists, reinstall the add-on.</font>'));
  card.addSection(section);

  return card.build();
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
