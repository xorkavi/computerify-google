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
        if (el.editAsText) el.editAsText().setText(newText);
        return;
      }
      if (type === DocumentApp.ElementType.TEXT) {
        var parent = el.getParent();
        if (parent && parent.editAsText) parent.editAsText().setText(newText);
        else el.setText(newText);
        return;
      }
      el = el.getParent();
    }
  }

  throw new Error('Could not find text to replace.');
}

// ── Private helpers ──

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
        textEl.setText(newText);
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
