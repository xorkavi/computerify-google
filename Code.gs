/**
 * Copy-that -- Google Workspace Add-on
 * Turn your writing into on-brand copy -- instantly
 *
 * Entry points:
 * 1. Extensions menu --> Fix copy (instant replacement)
 * 2. CardService sidebar icon --> opens HTML sidebar
 * 3. HTML sidebar --> full UI with preview, tone, fix-all
 */

var LOGO_URL = 'https://raw.githubusercontent.com/xorkavi/computerify-google/main/icons/icon128.png';

// =============================================
// EXTENSIONS MENU
// =============================================

function onOpen(e) {
  var ui = getUi_();
  if (ui) {
    ui.createAddonMenu()
      .addItem('Fix copy', 'menuFixCopy_')
      .addItem('Open sidebar', 'menuOpenSidebar_')
      .addToUi();
  }
}

function onInstall(e) { onOpen(e); }

function menuOpenSidebar_() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Copy-that');
  getUi_().showSidebar(html);
}

function menuFixCopy_(e) {
  var ui = getUi_();
  if (!getOpenAIKey_() && !getPat()) { ui.alert('Copy-that', 'Add-on not configured.\nContact your admin.', ui.ButtonSet.OK); return; }

  var editor = getEditorType_();
  try {
    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      if (shapes.length === 0) { ui.alert('Copy-that', 'No text selected.\nSelect text boxes first.', ui.ButtonSet.OK); return; }
      fixCopyShapes_(shapes);
      ui.alert('Copy-that', 'Done -- ' + shapes.length + ' text block' + (shapes.length > 1 ? 's' : '') + ' updated.', ui.ButtonSet.OK);
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      if (!sel.found) { ui.alert('Copy-that', 'No text selected.\nHighlight text first.', ui.ButtonSet.OK); return; }
      var result = callAgent(sel.text);
      replaceDocsSelection(result);
      ui.alert('Copy-that', 'Done -- text updated.', ui.ButtonSet.OK);
    } else {
      ui.alert('Copy-that', 'Could not detect editor type.', ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert('Copy-that', 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}

// =============================================
// CARDSERVICE -- minimal launcher card
// =============================================

function onDocsHomepage(e) {
  try { return buildLauncherCard_(); }
  catch (err) { return buildHomepageErrorCard_(err.message); }
}

function onSlidesHomepage(e) {
  try { return buildLauncherCard_(); }
  catch (err) { return buildHomepageErrorCard_(err.message); }
}

function buildLauncherCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Copy-that')
      .setSubtitle('Turn your writing into on-brand copy')
      .setImageUrl(LOGO_URL)
      .setImageStyle(CardService.ImageStyle.CIRCLE));

  var section = CardService.newCardSection();

  section.addWidget(CardService.newTextParagraph()
    .setText('Select text in your document, then use <b>Extensions \u203a Copy-that \u203a Fix copy</b> for a quick fix, or open the sidebar for more options.'));

  section.addWidget(CardService.newTextButton()
    .setText('Open sidebar')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#1A73E8')
    .setOnClickAction(CardService.newAction().setFunctionName('cardOpenSidebar')));

  card.addSection(section);
  return card.build();
}

function cardOpenSidebar(e) {
  menuOpenSidebar_();
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Sidebar opened'))
    .build();
}

function buildHomepageErrorCard_(message) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Copy-that')
      .setSubtitle('Something went wrong'));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph()
    .setText(escapeHtml_(message || 'Unknown error') + '\n\nTry closing and reopening the sidebar.'));
  card.addSection(section);
  return card.build();
}

// =============================================
// SERVER-SIDE HANDLERS (called from Sidebar.html)
// =============================================

function serverFixSelection(tone, instruction) {
  Logger.log('serverFixSelection: tone=' + tone + ' instruction=' + (instruction || '(none)'));
  var editor = getEditorType_();

  if (editor === 'docs') {
    var sel = getDocsSelection();
    if (!sel.found) return { found: false };
    var rewritten = callAgentWithContext_(sel.text, tone, instruction);
    return { found: true, original: sel.text, rewritten: rewritten };
  }

  if (editor === 'slides') {
    var shapes = getSelectedSlidesShapes();
    if (shapes.length === 0) return { found: false };
    var originals = [];
    var results = [];
    for (var i = 0; i < shapes.length; i++) {
      originals.push(shapes[i].text);
      results.push(callAgentWithContext_(shapes[i].text, tone, instruction));
    }
    // Store shapes for later apply
    CacheService.getUserCache().put('pendingShapes', JSON.stringify(
      shapes.map(function(s) { return s.text; })
    ), 300);
    return {
      found: true,
      original: originals.join('\n\n---\n\n'),
      rewritten: results.join('\n\n---\n\n'),
      count: shapes.length
    };
  }

  return { found: false };
}

function serverApplyRewrite(rewrittenText) {
  Logger.log('serverApplyRewrite: length=' + rewrittenText.length);
  var editor = getEditorType_();

  if (editor === 'docs') {
    replaceDocsSelection(rewrittenText);
    return;
  }

  if (editor === 'slides') {
    var parts = rewrittenText.split('\n\n---\n\n');
    var shapes = getSelectedSlidesShapes();
    for (var i = 0; i < shapes.length && i < parts.length; i++) {
      replaceShapeTextPreserveStyle_(shapes[i].shape, parts[i]);
    }
    return;
  }
}

function serverGetBlockCount() {
  var editor = getEditorType_();
  if (editor === 'docs') {
    var paras = getEntireDocParagraphs();
    // Store in cache for sequential processing
    var texts = paras.map(function(p) { return p.text; });
    CacheService.getUserCache().put('allBlocks', JSON.stringify(texts), 600);
    return texts.length;
  }
  if (editor === 'slides') {
    var shapes = getAllSlidesShapes();
    var texts = shapes.map(function(s) { return s.text; });
    CacheService.getUserCache().put('allBlocks', JSON.stringify(texts), 600);
    return texts.length;
  }
  return 0;
}

function serverFixBlock(index, tone, instruction) {
  Logger.log('serverFixBlock: index=' + index + ' tone=' + tone);
  var editor = getEditorType_();

  if (editor === 'docs') {
    var paras = getEntireDocParagraphs();
    if (index >= paras.length) return;
    var rewritten = callAgentWithContext_(paras[index].text, tone, instruction);
    if (paras[index].element && paras[index].element.editAsText) {
      paras[index].element.editAsText().setText(rewritten);
    }
    return;
  }

  if (editor === 'slides') {
    var shapes = getAllSlidesShapes();
    if (index >= shapes.length) return;
    var rewritten = callAgentWithContext_(shapes[index].text, tone, instruction);
    replaceShapeTextPreserveStyle_(shapes[index].shape, rewritten);
    return;
  }
}

// =============================================
// SHARED HELPERS
// =============================================

function callAgentWithContext_(text, tone, instruction) {
  var prefix = '';
  if (tone && tone !== 'auto') {
    var toneMap = {
      email: 'This is a customer email. Tone: warm, supportive, 4-6/10 on the smile-to-serious dial.',
      sales: 'This is a sales deck. Tone: confident, specific, proof points. 5-6/10.',
      slides: 'This is a slide. Tone: punchy, scannable, benefit-led. Keep it very short.',
      internal: 'This is an internal team message. Tone: friendly, professional. 5-7/10.',
      social: 'This is a social media post. Tone: energizing, excited, community-focused. 7-8/10.'
    };
    prefix += (toneMap[tone] || '') + '\n';
  }
  if (instruction) {
    prefix += 'Additional instruction: ' + instruction + '\n';
  }
  return callAgent(prefix + text);
}

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

function replaceShapeTextPreserveStyle_(shape, newText) {
  var textRange = shape.getText();
  var oldParagraphs = textRange.getParagraphs();

  var styles = [];
  for (var i = 0; i < oldParagraphs.length; i++) {
    var pRange = oldParagraphs[i].getRange();
    styles.push({
      paragraphStyle: pRange.getParagraphStyle(),
      textStyle: pRange.getTextStyle()
    });
  }

  if (styles.length <= 1) {
    textRange.setText(newText);
    return;
  }

  textRange.setText(newText);

  var newParagraphs = textRange.getParagraphs();
  for (var j = 0; j < newParagraphs.length; j++) {
    var styleIdx = Math.min(j, styles.length - 1);
    var src = styles[styleIdx];
    var dest = newParagraphs[j].getRange();
    try {
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
      Logger.log('replaceShapeTextPreserveStyle_: style copy failed for paragraph ' + j);
    }
  }
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

function escapeHtml_(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
