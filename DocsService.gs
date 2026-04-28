/**
 * Google Docs text extraction and replacement.
 *
 * When the sidebar has focus, getSelection() returns null.
 * Fallback: getCursor() to get the paragraph at cursor position.
 */

function getDocsSelection() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) return { found: false };

  // Try selection first
  var sel = doc.getSelection();
  if (sel) {
    var elements = sel.getRangeElements();
    if (elements && elements.length > 0) {
      var text = extractRangeText_(elements);
      if (text) return { found: true, text: text, mode: 'selection' };
    }
  }

  // Fallback: cursor paragraph
  var cursor = doc.getCursor();
  if (cursor) {
    var el = cursor.getElement();
    while (el) {
      var type = el.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH ||
          type === DocumentApp.ElementType.LIST_ITEM) {
        var t = el.editAsText ? el.editAsText().getText() : '';
        if (t.trim()) return { found: true, text: t.trim(), mode: 'cursor' };
        break;
      }
      if (type === DocumentApp.ElementType.TEXT) {
        var parent = el.getParent();
        var t = (parent && parent.editAsText) ? parent.editAsText().getText() : el.getText();
        if (t.trim()) return { found: true, text: t.trim(), mode: 'cursor' };
        break;
      }
      el = el.getParent();
    }
  }

  return { found: false };
}

function replaceDocsSelection(newText) {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error('No active document');

  // Try selection
  var sel = doc.getSelection();
  if (sel) {
    var elements = sel.getRangeElements();
    if (elements && elements.length > 0) {
      replaceRange_(elements, newText);
      return;
    }
  }

  // Fallback: cursor paragraph
  var cursor = doc.getCursor();
  if (cursor) {
    var el = cursor.getElement();
    while (el) {
      var type = el.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH ||
          type === DocumentApp.ElementType.LIST_ITEM) {
        if (el.editAsText) setTextPreserveStyle_(el.editAsText(), newText);
        return;
      }
      if (type === DocumentApp.ElementType.TEXT) {
        var parent = el.getParent();
        if (parent && parent.editAsText) setTextPreserveStyle_(parent.editAsText(), newText);
        else setTextPreserveStyle_(el, newText);
        return;
      }
      el = el.getParent();
    }
  }

  throw new Error('Could not find text to replace.');
}

/**
 * Return all text paragraphs in the document body as an array of
 * { element, text } objects. Skips empty paragraphs and non-text elements
 * (images, tables, etc.) so document structure is preserved.
 */
function getEntireDocParagraphs() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) return [];

  var body = doc.getBody();
  var numChildren = body.getNumChildren();
  var paragraphs = [];

  for (var i = 0; i < numChildren; i++) {
    var child = body.getChild(i);
    var type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH ||
        type === DocumentApp.ElementType.LIST_ITEM) {
      var text = child.editAsText().getText().trim();
      if (text) {
        paragraphs.push({ element: child, text: text });
      }
    }
  }

  return paragraphs;
}

// ── Private helpers ──

function captureTextStyle_(textEl) {
  var text = textEl.getText();
  if (!text || text.length === 0) return null;
  var attrs = textEl.getAttributes(0);
  if (attrs && attrs[DocumentApp.Attribute.LINK_URL] !== undefined) {
    delete attrs[DocumentApp.Attribute.LINK_URL];
  }
  return attrs;
}

function applyTextStyle_(textEl, attrs) {
  if (!attrs) return;
  var text = textEl.getText();
  if (!text || text.length === 0) return;
  try {
    textEl.setAttributes(0, text.length - 1, attrs);
  } catch (e) {
    Logger.log('applyTextStyle_: ' + e.message);
  }
}

function setTextPreserveStyle_(textEl, newText) {
  var attrs = captureTextStyle_(textEl);
  textEl.setText(newText);
  applyTextStyle_(textEl, attrs);
}

function extractRangeText_(elements) {
  var parts = [];
  for (var i = 0; i < elements.length; i++) {
    var re = elements[i];
    var el = re.getElement();
    var textEl = (el.getType() === DocumentApp.ElementType.TEXT)
      ? el : (el.editAsText ? el.editAsText() : null);
    if (!textEl) continue;

    var content = textEl.getText();
    if (!content) continue;

    var text = re.isPartial()
      ? content.substring(re.getStartOffset(), re.getEndOffsetInclusive() + 1)
      : content;
    if (text.trim()) parts.push(text);
  }
  return parts.join('\n').trim();
}

function replaceRange_(elements, newText) {
  var first = true;
  for (var i = 0; i < elements.length; i++) {
    var re = elements[i];
    var el = re.getElement();
    var textEl = (el.getType() === DocumentApp.ElementType.TEXT)
      ? el : (el.editAsText ? el.editAsText() : null);
    if (!textEl) continue;

    if (first) {
      if (re.isPartial()) {
        textEl.deleteText(re.getStartOffset(), re.getEndOffsetInclusive());
        textEl.insertText(re.getStartOffset(), newText);
      } else {
        setTextPreserveStyle_(textEl, newText);
      }
      first = false;
    } else {
      if (re.isPartial()) {
        textEl.deleteText(re.getStartOffset(), re.getEndOffsetInclusive());
      } else {
        textEl.setText('');
      }
    }
  }
}
