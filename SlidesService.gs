/**
 * Google Slides text extraction and replacement.
 *
 * Unlike Docs, Slides maintains selection state when the sidebar has focus.
 */

function getSlidesSelection() {
  var pres = SlidesApp.getActivePresentation();
  if (!pres) return { found: false };

  var sel;
  try { sel = pres.getSelection(); } catch (e) { return { found: false }; }
  if (!sel) return { found: false };

  var type = sel.getSelectionType();

  // Text within a shape
  if (type === SlidesApp.SelectionType.TEXT) {
    try {
      var text = sel.getTextRange().asString().trim();
      if (text) return { found: true, text: text, mode: 'text' };
    } catch (e) {}
  }

  // Shape(s) selected
  if (type === SlidesApp.SelectionType.PAGE_ELEMENT) {
    try {
      var pes = sel.getPageElementRange().getPageElements();
      var texts = [];
      for (var i = 0; i < pes.length; i++) {
        var t = extractShapeText_(pes[i]);
        if (t) texts.push(t);
      }
      if (texts.length) return { found: true, text: texts.join('\n\n'), mode: 'shapes' };
    } catch (e) {}
  }

  // Entire slide
  if (type === SlidesApp.SelectionType.PAGE ||
      type === SlidesApp.SelectionType.CURRENT_PAGE) {
    try {
      var page = sel.getCurrentPage();
      if (page) {
        var slideText = extractPageText_(page);
        if (slideText) return { found: true, text: slideText, mode: 'slide' };
      }
    } catch (e) {}
  }

  // Last resort: current page
  try {
    var page = sel.getCurrentPage();
    if (page) {
      var text = extractPageText_(page);
      if (text) return { found: true, text: text, mode: 'slide' };
    }
  } catch (e) {}

  return { found: false };
}

function replaceSlidesSelection(newText) {
  var pres = SlidesApp.getActivePresentation();
  if (!pres) throw new Error('No active presentation');

  var sel;
  try { sel = pres.getSelection(); } catch (e) { throw new Error('Lost selection.'); }

  var type = sel.getSelectionType();

  // Text within a shape — replace shape text
  if (type === SlidesApp.SelectionType.TEXT) {
    try {
      var per = sel.getPageElementRange();
      if (per) {
        var pe = per.getPageElements()[0];
        if (pe && pe.getPageElementType() === SlidesApp.PageElementType.SHAPE) {
          pe.asShape().getText().setText(newText);
          return;
        }
      }
    } catch (e) {}
  }

  // Shape(s) selected
  if (type === SlidesApp.SelectionType.PAGE_ELEMENT) {
    var shapes = [];
    var pes = sel.getPageElementRange().getPageElements();
    for (var i = 0; i < pes.length; i++) collectShapes_(pes[i], shapes);

    if (shapes.length === 1) {
      shapes[0].getText().setText(newText);
      return;
    }
    if (shapes.length > 1) {
      var parts = newText.split('\n\n');
      for (var j = 0; j < shapes.length && j < parts.length; j++) {
        shapes[j].getText().setText(parts[j]);
      }
      return;
    }
  }

  // Entire slide
  if (type === SlidesApp.SelectionType.PAGE ||
      type === SlidesApp.SelectionType.CURRENT_PAGE) {
    var page = sel.getCurrentPage();
    if (page) {
      var shapes = [];
      var pes = page.getPageElements();
      for (var k = 0; k < pes.length; k++) collectShapes_(pes[k], shapes);

      if (shapes.length === 1) {
        shapes[0].getText().setText(newText);
        return;
      }
      if (shapes.length > 1) {
        var parts = newText.split('\n\n');
        for (var m = 0; m < shapes.length && m < parts.length; m++) {
          shapes[m].getText().setText(parts[m]);
        }
        return;
      }
    }
  }

  throw new Error('Could not replace text.');
}

/**
 * Get each selected shape individually with its text.
 * Used by menuComputerify_ to process each shape separately.
 */
function getSelectedSlidesShapes() {
  var pres = SlidesApp.getActivePresentation();
  if (!pres) return [];

  var sel;
  try { sel = pres.getSelection(); } catch (e) { return []; }
  if (!sel) return [];

  var type = sel.getSelectionType();
  var result = [];

  if (type === SlidesApp.SelectionType.TEXT) {
    try {
      var per = sel.getPageElementRange();
      if (per) {
        var pe = per.getPageElements()[0];
        if (pe && pe.getPageElementType() === SlidesApp.PageElementType.SHAPE) {
          var t = pe.asShape().getText().asString().trim();
          if (t) result.push({ shape: pe.asShape(), text: t });
        }
      }
    } catch (e) {}
  }

  if (type === SlidesApp.SelectionType.PAGE_ELEMENT) {
    var pes = sel.getPageElementRange().getPageElements();
    for (var i = 0; i < pes.length; i++) collectShapesWithText_(pes[i], result);
  }

  if (type === SlidesApp.SelectionType.PAGE ||
      type === SlidesApp.SelectionType.CURRENT_PAGE) {
    try {
      var page = sel.getCurrentPage();
      if (page) {
        var pes = page.getPageElements();
        for (var i = 0; i < pes.length; i++) collectShapesWithText_(pes[i], result);
      }
    } catch (e) {}
  }

  return result;
}

/**
 * Return every text shape across ALL slides in the presentation.
 * Used by "Computerify entire presentation" to process the full deck.
 */
function getAllSlidesShapes() {
  var pres = SlidesApp.getActivePresentation();
  if (!pres) return [];

  var slides = pres.getSlides();
  var result = [];

  for (var s = 0; s < slides.length; s++) {
    var pes = slides[s].getPageElements();
    for (var i = 0; i < pes.length; i++) {
      collectShapesWithText_(pes[i], result);
    }
  }

  return result;
}

// ── Private helpers ──

function collectShapesWithText_(pe, result) {
  var type = pe.getPageElementType();
  if (type === SlidesApp.PageElementType.SHAPE) {
    try {
      var t = pe.asShape().getText().asString().trim();
      if (t) result.push({ shape: pe.asShape(), text: t });
    } catch (e) {}
  }
  if (type === SlidesApp.PageElementType.GROUP) {
    try {
      var children = pe.asGroup().getChildren();
      for (var i = 0; i < children.length; i++) collectShapesWithText_(children[i], result);
    } catch (e) {}
  }
}

function extractShapeText_(pe) {
  var type = pe.getPageElementType();

  if (type === SlidesApp.PageElementType.SHAPE) {
    try {
      var t = pe.asShape().getText().asString().trim();
      if (t) return t;
    } catch (e) {}
  }

  if (type === SlidesApp.PageElementType.GROUP) {
    try {
      var children = pe.asGroup().getChildren();
      var texts = [];
      for (var i = 0; i < children.length; i++) {
        var t = extractShapeText_(children[i]);
        if (t) texts.push(t);
      }
      if (texts.length) return texts.join('\n');
    } catch (e) {}
  }

  if (type === SlidesApp.PageElementType.TABLE) {
    try {
      var table = pe.asTable();
      var cells = [];
      for (var r = 0; r < table.getNumRows(); r++) {
        for (var c = 0; c < table.getNumColumns(); c++) {
          try {
            var ct = table.getCell(r, c).getText().asString().trim();
            if (ct) cells.push(ct);
          } catch (e) {}
        }
      }
      if (cells.length) return cells.join(' | ');
    } catch (e) {}
  }

  return '';
}

function extractPageText_(page) {
  var pes = page.getPageElements();
  var texts = [];
  for (var i = 0; i < pes.length; i++) {
    var t = extractShapeText_(pes[i]);
    if (t) texts.push(t);
  }
  return texts.join('\n\n');
}

function collectShapes_(pe, result) {
  var type = pe.getPageElementType();
  if (type === SlidesApp.PageElementType.SHAPE) {
    try {
      var t = pe.asShape().getText().asString().trim();
      if (t) result.push(pe.asShape());
    } catch (e) {}
  }
  if (type === SlidesApp.PageElementType.GROUP) {
    try {
      var children = pe.asGroup().getChildren();
      for (var i = 0; i < children.length; i++) collectShapes_(children[i], result);
    } catch (e) {}
  }
}
