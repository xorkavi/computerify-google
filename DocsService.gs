/**
 * Google Docs text extraction and replacement.
 *
 * Smart formatting preservation: extracts styled segments, annotates with
 * {N}...{/N} markers, sends to AI, parses response, reapplies styles.
 */

function getDocsSelection() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) return { found: false };

  var sel = doc.getSelection();
  if (sel) {
    var elements = sel.getRangeElements();
    if (elements && elements.length > 0) {
      var text = extractRangeText_(elements);
      if (text) return { found: true, text: text, mode: 'selection' };
    }
  }

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

  var sel = doc.getSelection();
  if (sel) {
    var elements = sel.getRangeElements();
    if (elements && elements.length > 0) {
      replaceRange_(elements, newText);
      return;
    }
  }

  var cursor = doc.getCursor();
  if (cursor) {
    var el = cursor.getElement();
    while (el) {
      var type = el.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH ||
          type === DocumentApp.ElementType.LIST_ITEM) {
        if (el.editAsText) smartReplace_(el.editAsText(), newText);
        return;
      }
      if (type === DocumentApp.ElementType.TEXT) {
        var parent = el.getParent();
        if (parent && parent.editAsText) smartReplace_(parent.editAsText(), newText);
        else smartReplace_(el, newText);
        return;
      }
      el = el.getParent();
    }
  }

  throw new Error('Could not find text to replace.');
}

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

// =============================================
// SMART FORMATTING — same approach as Figma plugin
// =============================================

/**
 * Build styled segments from a text element.
 * Each segment has: { start, end, chars, attrs, key }
 */
function buildSegments_(textEl) {
  var text = textEl.getText();
  if (!text || text.length === 0) return [];

  var segments = [];
  var currentAttrs = textEl.getAttributes(0);
  var currentKey = attrsKey_(currentAttrs);
  var segStart = 0;

  for (var i = 1; i < text.length; i++) {
    var attrs = textEl.getAttributes(i);
    var key = attrsKey_(attrs);
    if (key !== currentKey) {
      segments.push({ start: segStart, end: i, chars: text.substring(segStart, i), attrs: currentAttrs, key: currentKey });
      currentAttrs = attrs;
      currentKey = key;
      segStart = i;
    }
  }
  segments.push({ start: segStart, end: text.length, chars: text.substring(segStart), attrs: currentAttrs, key: currentKey });

  return segments;
}

/**
 * Create a unique key from a character's attributes to identify distinct styles.
 */
function attrsKey_(attrs) {
  if (!attrs) return 'null';
  var parts = [];
  var keys = [
    DocumentApp.Attribute.BOLD,
    DocumentApp.Attribute.ITALIC,
    DocumentApp.Attribute.UNDERLINE,
    DocumentApp.Attribute.STRIKETHROUGH,
    DocumentApp.Attribute.FONT_FAMILY,
    DocumentApp.Attribute.FONT_SIZE,
    DocumentApp.Attribute.FOREGROUND_COLOR,
    DocumentApp.Attribute.BACKGROUND_COLOR
  ];
  for (var i = 0; i < keys.length; i++) {
    parts.push(String(attrs[keys[i]] || ''));
  }
  return parts.join('\0');
}

/**
 * Find the base (dominant) style — the one covering the most characters.
 */
function findBaseStyle_(segments) {
  var coverage = {};
  var examples = {};
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var len = seg.end - seg.start;
    coverage[seg.key] = (coverage[seg.key] || 0) + len;
    if (!examples[seg.key]) examples[seg.key] = seg.attrs;
  }

  var baseKey = '';
  var maxCov = 0;
  for (var key in coverage) {
    if (coverage[key] > maxCov) {
      maxCov = coverage[key];
      baseKey = key;
    }
  }

  return { baseKey: baseKey, baseAttrs: examples[baseKey], allKeys: coverage, examples: examples };
}

/**
 * Convert text + segments into annotated text with {N}...{/N} markers.
 * Returns { annotated, hasFormatting, styleMap, styleDesc }
 */
function getAnnotatedText_(textEl) {
  var segments = buildSegments_(textEl);
  if (segments.length <= 1) {
    return { annotated: textEl.getText(), hasFormatting: false, styleMap: null, styleDesc: '' };
  }

  var info = findBaseStyle_(segments);
  var alternateKeys = [];
  for (var key in info.allKeys) {
    if (key !== info.baseKey) alternateKeys.push(key);
  }

  if (alternateKeys.length === 0) {
    return { annotated: textEl.getText(), hasFormatting: false, styleMap: null, styleDesc: '' };
  }

  // Assign numbers to alternate styles
  var keyToNum = {};
  for (var i = 0; i < alternateKeys.length; i++) {
    keyToNum[alternateKeys[i]] = i + 1;
  }

  // Build annotated text
  var annotated = '';
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var num = keyToNum[seg.key];
    if (num !== undefined) {
      annotated += '{' + num + '}' + seg.chars + '{/' + num + '}';
    } else {
      annotated += seg.chars;
    }
  }

  // Build style description for AI context
  var styleDesc = '';
  for (var i = 0; i < alternateKeys.length; i++) {
    var attrs = info.examples[alternateKeys[i]];
    var num = i + 1;
    var desc = '{' + num + '} = ';
    var parts = [];
    if (attrs[DocumentApp.Attribute.BOLD]) parts.push('bold');
    if (attrs[DocumentApp.Attribute.ITALIC]) parts.push('italic');
    if (attrs[DocumentApp.Attribute.UNDERLINE]) parts.push('underline');
    if (attrs[DocumentApp.Attribute.STRIKETHROUGH]) parts.push('strikethrough');
    if (attrs[DocumentApp.Attribute.FONT_FAMILY]) parts.push(attrs[DocumentApp.Attribute.FONT_FAMILY]);
    if (attrs[DocumentApp.Attribute.FONT_SIZE]) parts.push(attrs[DocumentApp.Attribute.FONT_SIZE] + 'pt');
    if (attrs[DocumentApp.Attribute.FOREGROUND_COLOR] && attrs[DocumentApp.Attribute.FOREGROUND_COLOR] !== '#000000') {
      parts.push('color:' + attrs[DocumentApp.Attribute.FOREGROUND_COLOR]);
    }
    desc += parts.join(', ') || 'alternate style';
    styleDesc += desc + '; ';
  }

  return {
    annotated: annotated,
    hasFormatting: true,
    styleMap: { baseKey: info.baseKey, baseAttrs: info.baseAttrs, keyToNum: keyToNum, examples: info.examples, alternateKeys: alternateKeys },
    styleDesc: styleDesc
  };
}

/**
 * Parse {N}...{/N} markers from AI response.
 * Returns { plain, ranges: [{ start, end, num }] }
 */
function parseMarkers_(text) {
  var ranges = [];
  var plain = '';
  var i = 0;
  var openStack = [];

  while (i < text.length) {
    if (text[i] === '{') {
      var closeIdx = text.indexOf('}', i);
      if (closeIdx !== -1 && closeIdx - i <= 4) {
        var inner = text.substring(i + 1, closeIdx);
        if (inner.match(/^\d+$/)) {
          var num = parseInt(inner, 10);
          openStack.push({ num: num, start: plain.length });
          i = closeIdx + 1;
          continue;
        }
        if (inner.match(/^\/\d+$/)) {
          var num = parseInt(inner.substring(1), 10);
          for (var s = openStack.length - 1; s >= 0; s--) {
            if (openStack[s].num === num) {
              ranges.push({ start: openStack[s].start, end: plain.length, num: num });
              openStack.splice(s, 1);
              break;
            }
          }
          i = closeIdx + 1;
          continue;
        }
      }
    }
    // Also handle **bold** as fallback (AI sometimes uses markdown)
    if (text[i] === '*' && text[i + 1] === '*') {
      var closeIdx = text.indexOf('**', i + 2);
      if (closeIdx !== -1) {
        var boldText = text.substring(i + 2, closeIdx);
        var start = plain.length;
        plain += boldText;
        ranges.push({ start: start, end: plain.length, num: -1 }); // -1 = markdown bold
        i = closeIdx + 2;
        continue;
      }
    }
    plain += text[i];
    i++;
  }

  return { plain: plain, ranges: ranges };
}

/**
 * Smart replace: annotate → send to AI → parse → reapply styles.
 * Used for single text elements (cursor paragraph, fix-all paragraphs).
 */
function smartReplace_(textEl, newText) {
  var parsed = parseMarkers_(newText);
  var text = textEl.getText();
  var segments = buildSegments_(textEl);
  var info = findBaseStyle_(segments);

  // Build number → attrs lookup from the original
  var alternateKeys = [];
  for (var key in info.allKeys) {
    if (key !== info.baseKey) alternateKeys.push(key);
  }
  var numToAttrs = {};
  for (var i = 0; i < alternateKeys.length; i++) {
    numToAttrs[i + 1] = info.examples[alternateKeys[i]];
  }

  // Set plain text
  textEl.setText(parsed.plain);

  // Apply base style to everything
  if (parsed.plain.length > 0 && info.baseAttrs) {
    try {
      var baseClean = cleanAttrs_(info.baseAttrs);
      textEl.setAttributes(0, parsed.plain.length - 1, baseClean);
    } catch (e) {
      Logger.log('smartReplace_ base style: ' + e.message);
    }
  }

  // Apply alternate styles to marked ranges
  for (var i = 0; i < parsed.ranges.length; i++) {
    var range = parsed.ranges[i];
    if (range.start >= range.end || range.end > parsed.plain.length) continue;

    if (range.num === -1) {
      // Markdown bold fallback — just apply bold
      try {
        textEl.setBold(range.start, range.end - 1, true);
      } catch (e) {}
    } else if (numToAttrs[range.num]) {
      try {
        var altClean = cleanAttrs_(numToAttrs[range.num]);
        textEl.setAttributes(range.start, range.end - 1, altClean);
      } catch (e) {
        Logger.log('smartReplace_ alt style ' + range.num + ': ' + e.message);
      }
    }
  }
}

function cleanAttrs_(attrs) {
  if (!attrs) return {};
  var cleaned = {};
  for (var key in attrs) {
    if (attrs[key] !== null && key !== DocumentApp.Attribute.LINK_URL) {
      cleaned[key] = attrs[key];
    }
  }
  return cleaned;
}

/**
 * Get annotated text for a docs selection (for sending to AI).
 * Returns { text, hasFormatting, styleDesc }
 */
function getDocsAnnotatedSelection() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) return null;

  var sel = doc.getSelection();
  if (sel) {
    var elements = sel.getRangeElements();
    if (elements && elements.length > 0) {
      // For multi-element selections, get first text element's formatting
      for (var i = 0; i < elements.length; i++) {
        var re = elements[i];
        var el = re.getElement();
        var textEl = (el.getType() === DocumentApp.ElementType.TEXT)
          ? el : (el.editAsText ? el.editAsText() : null);
        if (textEl && textEl.getText().trim()) {
          return getAnnotatedText_(textEl);
        }
      }
    }
  }

  var cursor = doc.getCursor();
  if (cursor) {
    var el = cursor.getElement();
    while (el) {
      var type = el.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH ||
          type === DocumentApp.ElementType.LIST_ITEM) {
        if (el.editAsText) return getAnnotatedText_(el.editAsText());
        break;
      }
      if (type === DocumentApp.ElementType.TEXT) {
        return getAnnotatedText_(el);
      }
      el = el.getParent();
    }
  }

  return null;
}

// ── Legacy helpers (still used by replaceRange_) ──

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
        var startOff = re.getStartOffset();
        var segments = buildSegments_(textEl);
        var info = findBaseStyle_(segments);
        var parsed = parseMarkers_(newText);

        textEl.deleteText(startOff, re.getEndOffsetInclusive());
        textEl.insertText(startOff, parsed.plain);

        // Apply base style
        if (parsed.plain.length > 0 && info.baseAttrs) {
          try {
            textEl.setAttributes(startOff, startOff + parsed.plain.length - 1, cleanAttrs_(info.baseAttrs));
          } catch (e) {}
        }

        // Build num → attrs from original segments
        var alternateKeys = [];
        for (var key in info.allKeys) {
          if (key !== info.baseKey) alternateKeys.push(key);
        }
        var numToAttrs = {};
        for (var k = 0; k < alternateKeys.length; k++) {
          numToAttrs[k + 1] = info.examples[alternateKeys[k]];
        }

        // Apply marked ranges
        for (var b = 0; b < parsed.ranges.length; b++) {
          var range = parsed.ranges[b];
          if (range.start >= range.end) continue;
          if (range.num === -1) {
            try { textEl.setBold(startOff + range.start, startOff + range.end - 1, true); } catch (e) {}
          } else if (numToAttrs[range.num]) {
            try { textEl.setAttributes(startOff + range.start, startOff + range.end - 1, cleanAttrs_(numToAttrs[range.num])); } catch (e) {}
          }
        }
      } else {
        smartReplace_(textEl, newText);
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

// Keep for backward compat with cardFixAll
function setTextPreserveStyle_(textEl, newText) {
  smartReplace_(textEl, newText);
}
