// jip Translator - Figma Plugin (Sandbox Code)
// This runs in Figma's sandbox environment

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

// ─── Types ──────────────────────────────────────────────────────────────
interface TextEntry {
  nodeId: string;
  text: string;
  pageIndex: number;
  frameIndex: number;
  orderIndex: number;
}

interface TranslatedResult {
  nodeId: string;
  original: string;
  translated: string;
}

// ─── Text Collection ────────────────────────────────────────────────────

function collectTextNodes(node: SceneNode): TextNode[] {
  const texts: TextNode[] = [];
  if (node.type === 'TEXT') {
    texts.push(node);
  } else if ('children' in node) {
    for (const child of node.children) {
      texts.push(...collectTextNodes(child));
    }
  }
  return texts;
}

function getTextEntries(selection: readonly SceneNode[]): TextEntry[] {
  const entries: TextEntry[] = [];
  let globalOrder = 0;

  for (let fi = 0; fi < selection.length; fi++) {
    const frame = selection[fi];
    const textNodes = collectTextNodes(frame);

    // Sort text nodes by vertical then horizontal position (reading order)
    textNodes.sort((a, b) => {
      const ay = a.absoluteTransform[1][2];
      const by = b.absoluteTransform[1][2];
      if (Math.abs(ay - by) > 5) return ay - by;
      return a.absoluteTransform[0][2] - b.absoluteTransform[0][2];
    });

    for (const textNode of textNodes) {
      if (textNode.characters.trim() === '') continue;

      entries.push({
        nodeId: textNode.id,
        text: textNode.characters,
        pageIndex: 0,
        frameIndex: fi,
        orderIndex: globalOrder++,
      });
    }
  }

  return entries;
}

// ─── Font Loading ───────────────────────────────────────────────────────

async function loadFontsForNode(textNode: TextNode): Promise<FontName[]> {
  const len = textNode.characters.length;
  if (len === 0) return [];

  const loaded = new Set<string>();
  const fonts: FontName[] = [];

  for (let i = 0; i < len; i++) {
    const font = textNode.getRangeFontName(i, i + 1);
    if (font === figma.mixed) continue;
    const key = (font as FontName).family + '::' + (font as FontName).style;
    if (!loaded.has(key)) {
      loaded.add(key);
      try {
        await figma.loadFontAsync(font as FontName);
        fonts.push(font as FontName);
      } catch (e) {
        console.warn('Could not load font: ' + key, e);
      }
    }
  }
  return fonts;
}

// Get the primary (most-used) font for a text node
function getPrimaryFont(textNode: TextNode): FontName | null {
  const fontName = textNode.fontName;
  // If uniform font, use it directly
  if (fontName !== figma.mixed) {
    return fontName as FontName;
  }
  // If mixed, find the most common font by counting characters
  const fontCounts: Record<string, { font: FontName; count: number }> = {};
  const len = textNode.characters.length;
  for (let i = 0; i < len; i++) {
    const font = textNode.getRangeFontName(i, i + 1);
    if (font === figma.mixed) continue;
    const key = (font as FontName).family + '::' + (font as FontName).style;
    if (!fontCounts[key]) {
      fontCounts[key] = { font: font as FontName, count: 0 };
    }
    fontCounts[key].count++;
  }
  let best: { font: FontName; count: number } | null = null;
  for (var k in fontCounts) {
    if (!best || fontCounts[k].count > best.count) {
      best = fontCounts[k];
    }
  }
  return best ? best.font : null;
}

// ─── Output Modes ───────────────────────────────────────────────────────

async function applyReplace(result: TranslatedResult): Promise<void> {
  const node = figma.getNodeById(result.nodeId);
  if (!node || node.type !== 'TEXT') return;
  const textNode = node as TextNode;

  // Load all fonts used in the current text
  await loadFontsForNode(textNode);

  // Get the primary font BEFORE replacing text
  var primaryFont = getPrimaryFont(textNode);

  // If mixed fonts, unify to primary font first to avoid "missing font" errors on replacement
  if (textNode.fontName === figma.mixed && primaryFont) {
    try {
      textNode.fontName = primaryFont;
    } catch (e) {
      console.warn('Could not unify font before replace:', e);
    }
  }

  // Now replace text
  try {
    textNode.characters = result.translated;
  } catch (e: any) {
    // If setting characters fails (e.g., font doesn't support target glyphs),
    // try with a fallback approach: delete all, then insert
    console.warn('Direct character replacement failed, trying fallback:', e);
    textNode.characters = '';
    textNode.characters = result.translated;
  }
}

async function applyAppend(result: TranslatedResult): Promise<void> {
  const node = figma.getNodeById(result.nodeId);
  if (!node || node.type !== 'TEXT') return;
  const textNode = node as TextNode;

  // Load all fonts used in the current text
  await loadFontsForNode(textNode);

  // Get the primary font BEFORE modifying text
  var primaryFont = getPrimaryFont(textNode);

  // If mixed fonts, unify to primary font first
  if (textNode.fontName === figma.mixed && primaryFont) {
    try {
      textNode.fontName = primaryFont;
    } catch (e) {
      console.warn('Could not unify font before append:', e);
    }
  }

  var separator = '\n───\n';
  textNode.characters = result.original + separator + result.translated;
}

async function applyDuplicate(
  result: TranslatedResult,
  layoutMode: 'vertical-wrap' | 'vertical' | 'horizontal' | 'horizontal-wrap'
): Promise<void> {
  const originalNode = figma.getNodeById(result.nodeId);
  if (!originalNode || originalNode.type !== 'TEXT') return;
  const textNode = originalNode as TextNode;

  await loadFontsForNode(textNode);

  // Get primary font before cloning
  var primaryFont = getPrimaryFont(textNode);

  // Clone the text node
  const clonedNode = textNode.clone();
  await loadFontsForNode(clonedNode);

  // Unify font if mixed before setting translated text
  if (clonedNode.fontName === figma.mixed && primaryFont) {
    try {
      clonedNode.fontName = primaryFont;
    } catch (e) {
      console.warn('Could not unify font on clone:', e);
    }
  }
  clonedNode.characters = result.translated;

  // Create an auto-layout frame to hold both
  const nodeParent = textNode.parent;
  if (!nodeParent) return;

  const wrapper = figma.createFrame();
  const label = result.original.length > 30 ? result.original.slice(0, 30) + '...' : result.original;
  wrapper.name = `Translation: ${label}`;
  wrapper.fills = []; // transparent background

  // Set auto-layout
  if (layoutMode === 'horizontal' || layoutMode === 'horizontal-wrap') {
    wrapper.layoutMode = 'HORIZONTAL';
  } else {
    wrapper.layoutMode = 'VERTICAL';
  }

  if (layoutMode === 'vertical-wrap' || layoutMode === 'horizontal-wrap') {
    wrapper.layoutWrap = 'WRAP';
  } else {
    wrapper.layoutWrap = 'NO_WRAP';
  }

  wrapper.itemSpacing = 8;
  wrapper.counterAxisSpacing = 8;
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';

  // Position wrapper at original's location
  wrapper.x = textNode.x;
  wrapper.y = textNode.y;

  // Find index of original node in parent
  let idx = -1;
  const siblings = (nodeParent as any).children;
  if (siblings) {
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].id === textNode.id) {
        idx = i;
        break;
      }
    }
  }

  // Move original and clone into wrapper
  wrapper.appendChild(textNode);
  wrapper.appendChild(clonedNode);

  // Insert wrapper where original was
  if ('insertChild' in nodeParent && idx >= 0) {
    (nodeParent as any).insertChild(idx, wrapper);
  } else if ('appendChild' in nodeParent) {
    (nodeParent as any).appendChild(wrapper);
  }
}

// ─── Message Handler ────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: any) => {
  try {
    if (msg.type === 'get-selection') {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({
          type: 'selection-result',
          count: 0,
          entries: [],
          error: 'No frames selected. Please select one or more frames.',
        });
        return;
      }

      const entries = getTextEntries(selection);
      figma.ui.postMessage({
        type: 'selection-result',
        count: entries.length,
        entries,
        frameCount: selection.length,
      });
    }

    if (msg.type === 'apply-translations') {
      const results: TranslatedResult[] = msg.results;
      const outputMode: string = msg.outputMode;
      const duplicateLayout: string = msg.duplicateLayout;

      let applied = 0;
      let failed = 0;

      var errors: string[] = [];
      for (const result of results) {
        try {
          if (outputMode === 'replace') {
            await applyReplace(result);
          } else if (outputMode === 'append') {
            await applyAppend(result);
          } else if (outputMode === 'duplicate') {
            await applyDuplicate(result, duplicateLayout as any);
          }
          applied++;
        } catch (e: any) {
          var errMsg = e && e.message ? e.message : 'Unknown error';
          console.error('Failed to apply translation for ' + result.nodeId + ':', e);
          errors.push('Node ' + result.nodeId + ': ' + errMsg);
          failed++;
        }
      }

      figma.ui.postMessage({
        type: 'apply-complete',
        applied: applied,
        failed: failed,
        errors: errors,
      });

      figma.notify(`Translation complete: ${applied} texts translated${failed > 0 ? `, ${failed} failed` : ''}`);
    }

    // ─── Client Storage proxy ───────────────────────────────────────
    if (msg.type === 'storage-set') {
      await figma.clientStorage.setAsync(msg.key, msg.value);
    }

    if (msg.type === 'storage-get') {
      const value = await figma.clientStorage.getAsync(msg.key);
      figma.ui.postMessage({
        type: 'storage-result',
        key: msg.key,
        value: value !== undefined && value !== null ? value : null,
      });
    }

    if (msg.type === 'notify') {
      figma.notify(msg.message, { timeout: msg.timeout || 3000 });
    }

    if (msg.type === 'resize') {
      figma.ui.resize(msg.width, msg.height);
    }

    if (msg.type === 'cancel') {
      figma.closePlugin();
    }
  } catch (err: any) {
    console.error('Plugin error:', err);
    figma.notify(`Error: ${err.message || 'Unknown error'}`, { timeout: 5000 });
  }
};

// Listen for selection changes
figma.on('selectionchange', () => {
  try {
    const selection = figma.currentPage.selection;
    const entries = selection.length > 0 ? getTextEntries(selection) : [];
    figma.ui.postMessage({
      type: 'selection-changed',
      count: entries.length,
      entries,
      frameCount: selection.length,
    });
  } catch (err: any) {
    console.error('Selection change error:', err);
  }
});
