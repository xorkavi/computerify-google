/**
 * Copy-that -- Google Workspace Add-on
 * Turn your writing into on-brand copy -- instantly
 *
 * Two entry points:
 * 1. Extensions menu --> Fix copy (instant replacement)
 * 2. CardService sidebar --> full UI with tone, custom instructions, fix-all
 */

var LOGO_URL = 'https://raw.githubusercontent.com/xorkavi/computerify-google/main/icons/icon128.png';

var TONE_OPTIONS = [
  { key: 'auto',     label: 'Auto-detect' },
  { key: 'email',    label: 'Customer email' },
  { key: 'sales',    label: 'Sales deck' },
  { key: 'slides',   label: 'Slide bullets' },
  { key: 'internal', label: 'Internal comms' },
  { key: 'social',   label: 'Social post' }
];

var TONE_PROMPTS = {
  email:    'This is a customer email. Tone: warm, supportive, 4-6/10 on the smile-to-serious dial.',
  sales:    'This is a sales deck. Tone: confident, specific, proof points. 5-6/10.',
  slides:   'This is a slide. Tone: punchy, scannable, benefit-led. Keep it very short.',
  internal: 'This is an internal team message. Tone: friendly, professional. 5-7/10.',
  social:   'This is a social media post. Tone: energizing, excited, community-focused. 7-8/10.'
};

// =============================================
// EXTENSIONS MENU
// =============================================

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
  if (!getOpenAIKey_()) { ui.alert('Copy-that', 'Add-on not configured.\nContact your admin.', ui.ButtonSet.OK); return; }

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
// CARDSERVICE SIDEBAR
// =============================================

function onDocsHomepage(e) {
  try { return buildHomepageCard_(); }
  catch (err) { return buildHomepageErrorCard_(err.message); }
}

function onSlidesHomepage(e) {
  try { return buildHomepageCard_(); }
  catch (err) { return buildHomepageErrorCard_(err.message); }
}

function buildHomepageCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Copy-that')
      .setSubtitle('Turn your writing into on-brand copy')
      .setImageUrl(LOGO_URL)
      .setImageStyle(CardService.ImageStyle.SQUARE));

  // Tone selector
  var toneSection = CardService.newCardSection()
    .setHeader('Context');
  var toneDropdown = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Tone')
    .setFieldName('tone');
  for (var i = 0; i < TONE_OPTIONS.length; i++) {
    toneDropdown.addItem(TONE_OPTIONS[i].label, TONE_OPTIONS[i].key, i === 0);
  }
  toneSection.addWidget(toneDropdown);

  // Custom instruction
  toneSection.addWidget(CardService.newTextInput()
    .setFieldName('instruction')
    .setTitle('Extra instructions (optional)')
    .setHint('e.g. Make it shorter, More urgent, For C-level audience'));

  card.addSection(toneSection);

  // Actions
  var actions = CardService.newCardSection()
    .setHeader('Actions');

  actions.addWidget(CardService.newDecoratedText()
    .setText('<b>Fix selected text</b>')
    .setBottomLabel('Rewrite selected text on-brand')
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/edit/v11/gm_grey-24dp/2x/gm_edit_gm_grey_24dp.png'))
    .setOnClickAction(CardService.newAction().setFunctionName('cardFixCopy')));

  actions.addWidget(CardService.newDecoratedText()
    .setText('<b>Fix entire document</b>')
    .setBottomLabel('Rewrite all text blocks on-brand')
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage()
      .setIconUrl('https://fonts.gstatic.com/s/i/googlematerialicons/auto_fix_high/v11/gm_grey-24dp/2x/gm_auto_fix_high_gm_grey_24dp.png'))
    .setOnClickAction(CardService.newAction().setFunctionName('cardFixAll')));

  card.addSection(actions);

  return card.build();
}

// =============================================
// CARD ACTION: Fix selected text
// =============================================

function cardFixCopy(e) {
  if (!getOpenAIKey_()) {
    return buildErrorCard_('Add-on not configured. Contact your admin.');
  }

  var tone = (e && e.formInput && e.formInput.tone) || 'auto';
  var instruction = (e && e.formInput && e.formInput.instruction) || '';
  var editor = getEditorType_();

  try {
    var count = 0;

    if (editor === 'slides') {
      var shapes = getSelectedSlidesShapes();
      if (shapes.length === 0) {
        return buildErrorCard_('No text selected.\n\nSelect one or more text boxes in your slide, then try again.');
      }
      for (var i = 0; i < shapes.length; i++) {
        var r = callAgentWithContext_(shapes[i].text, tone, instruction);
        replaceShapeTextPreserveStyle_(shapes[i].shape, r);
        count++;
      }
    } else if (editor === 'docs') {
      var sel = getDocsSelection();
      if (!sel.found) {
        return buildErrorCard_('No text selected.\n\nHighlight text in your document, then try again.');
      }
      var r = callAgentWithContext_(sel.text, tone, instruction);
      replaceDocsSelection(r);
      count = 1;
    } else {
      return buildErrorCard_('Could not detect editor type.');
    }

    return cardNotify_('Done -- ' + count + ' text block' + (count > 1 ? 's' : '') + ' updated');

  } catch (err) {
    return buildErrorCard_(err.message);
  }
}

// =============================================
// CARD ACTION: Fix entire document
// =============================================

function cardFixAll(e) {
  if (!getOpenAIKey_()) {
    return buildErrorCard_('Add-on not configured. Contact your admin.');
  }

  var tone = (e && e.formInput && e.formInput.tone) || 'auto';
  var instruction = (e && e.formInput && e.formInput.instruction) || '';
  var editor = getEditorType_();

  try {
    var count = 0;

    if (editor === 'docs') {
      var paras = getEntireDocParagraphs();
      if (!paras || paras.length === 0) {
        return buildErrorCard_('No text found in the document.');
      }
      for (var i = 0; i < paras.length; i++) {
        if (!paras[i].text || paras[i].text.trim() === '') continue;
        var rewritten = callAgentWithContext_(paras[i].text, tone, instruction);
        if (paras[i].element && paras[i].element.editAsText) {
          paras[i].element.editAsText().setText(rewritten);
        }
        count++;
      }
    } else if (editor === 'slides') {
      var shapes = getAllSlidesShapes();
      if (!shapes || shapes.length === 0) {
        return buildErrorCard_('No text found in the presentation.');
      }
      for (var j = 0; j < shapes.length; j++) {
        if (!shapes[j].text || shapes[j].text.trim() === '') continue;
        var rewritten = callAgentWithContext_(shapes[j].text, tone, instruction);
        replaceShapeTextPreserveStyle_(shapes[j].shape, rewritten);
        count++;
      }
    } else {
      return buildErrorCard_('Could not detect editor type.');
    }

    return cardNotify_('Done -- ' + count + ' text block' + (count > 1 ? 's' : '') + ' updated');

  } catch (err) {
    return buildErrorCard_('Error during fix-all: ' + err.message);
  }
}

// =============================================
// CARD: Error
// =============================================

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

// =============================================
// SHARED HELPERS
// =============================================

function callAgentWithContext_(text, tone, instruction) {
  var prefix = '';
  if (tone && tone !== 'auto') {
    prefix += (TONE_PROMPTS[tone] || '') + '\n';
  }
  if (instruction) {
    prefix += 'Additional instruction: ' + instruction + '\n';
  }
  return callAgent(prefix + text);
}

function fixCopyShapes_(shapes) {
  var count = 0;
  for (var i = 0; i < shapes.length; i++) {
    var r = callAgent(shapes[i].text);
    replaceShapeTextPreserveStyle_(shapes[i].shape, r);
    count++;
  }
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

function cardNotify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
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
