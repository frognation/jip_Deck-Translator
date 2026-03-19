// jip Translator - Figma Plugin (Sandbox Code)
// This runs in Figma's sandbox environment

figma.showUI(__html__, { width: 480, height: 760, themeColors: true });

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
  targetLang?: string;
}

interface SlideDraftTarget {
  slideId: string;
  slideName: string;
  slideIndex: number;
  text: string;
}

let cachedAvailableFonts: Font[] | null = null;
const LOCAL_DEEPL_PROXY_URL = 'http://localhost:8787/translate/deepl';

async function callDeepLFromSandbox(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  isFree: boolean,
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(LOCAL_DEEPL_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts,
        sourceLang,
        targetLang,
        apiKey,
        isFree,
      }),
    });
  } catch (e: any) {
    throw new Error(
      `DeepL proxy network error (${LOCAL_DEEPL_PROXY_URL}). ` +
      `Start the local proxy server and make sure Figma can reach localhost. ` +
      `Original error: ${e?.message || 'Failed to fetch'}`
    );
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepL proxy/API error (${response.status}): ${err || response.statusText}`);
  }

  const data = await response.json();
  return data.translations.map((t: any) => t.text);
}

async function getTextNodeById(nodeId: string): Promise<TextNode | null> {
  const node = await figma.getNodeByIdAsync(nodeId);
  return node && node.type === 'TEXT' ? node as TextNode : null;
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

function findAncestorSlide(node: BaseNode | null): SlideNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'SLIDE') {
      return current as SlideNode;
    }
    current = current.parent;
  }
  return null;
}

function getSlideDraftTargets(selection: readonly SceneNode[]): SlideDraftTarget[] {
  const slides: SlideNode[] = [];
  const seen = new Set<string>();

  for (const node of selection) {
    const slide = node.type === 'SLIDE'
      ? node as SlideNode
      : findAncestorSlide(node);

    if (slide && !seen.has(slide.id)) {
      seen.add(slide.id);
      slides.push(slide);
    }
  }

  return slides.map((slide, index) => {
    const textNodes = collectTextNodes(slide)
      .filter((textNode) => textNode.characters.trim() !== '');

    textNodes.sort((a, b) => {
      const ay = a.absoluteTransform[1][2];
      const by = b.absoluteTransform[1][2];
      if (Math.abs(ay - by) > 5) return ay - by;
      return a.absoluteTransform[0][2] - b.absoluteTransform[0][2];
    });

    return {
      slideId: slide.id,
      slideName: slide.name || `Slide ${index + 1}`,
      slideIndex: index,
      text: textNodes.map((textNode) => textNode.characters).join('\n\n'),
    };
  });
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

async function getAvailableFonts(): Promise<Font[]> {
  if (!cachedAvailableFonts) {
    cachedAvailableFonts = await figma.listAvailableFontsAsync();
  }
  return cachedAvailableFonts;
}

function detectScriptSample(text: string, targetLang?: string): string {
  if (targetLang === 'ko' || /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (targetLang === 'ja' || /[\u3040-\u30FF]/.test(text)) return 'ja';
  if (targetLang === 'zh-CN' || /[\u4E00-\u9FFF]/.test(text)) return 'zh-CN';
  if (targetLang === 'zh-TW') return 'zh-TW';
  if (targetLang === 'ar' || /[\u0600-\u06FF]/.test(text)) return 'ar';
  if (targetLang === 'he' || /[\u0590-\u05FF]/.test(text)) return 'he';
  if (targetLang === 'hi' || /[\u0900-\u097F]/.test(text)) return 'hi';
  if (targetLang === 'th' || /[\u0E00-\u0E7F]/.test(text)) return 'th';
  if (targetLang === 'ru' || targetLang === 'uk' || targetLang === 'bg' || /[\u0400-\u04FF]/.test(text)) return 'cyrillic';
  return 'latin';
}

function getPreferredFamilies(script: string): string[] {
  switch (script) {
    case 'ko':
      return ['Noto Sans CJK KR', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Pretendard', 'Inter', 'Arial Unicode MS', 'Arial'];
    case 'ja':
      return ['Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', 'Inter', 'Arial Unicode MS', 'Arial'];
    case 'zh-CN':
      return ['Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'Inter', 'Arial Unicode MS', 'Arial'];
    case 'zh-TW':
      return ['Noto Sans TC', 'Noto Sans CJK TC', 'PingFang TC', 'Microsoft JhengHei', 'Inter', 'Arial Unicode MS', 'Arial'];
    case 'ar':
      return ['Noto Sans Arabic', 'Geeza Pro', 'Arial', 'Arial Unicode MS', 'Inter'];
    case 'he':
      return ['Noto Sans Hebrew', 'Arial Hebrew', 'Arial', 'Arial Unicode MS', 'Inter'];
    case 'hi':
      return ['Noto Sans Devanagari', 'Kohinoor Devanagari', 'Arial Unicode MS', 'Inter', 'Arial'];
    case 'th':
      return ['Noto Sans Thai', 'Thonburi', 'Arial Unicode MS', 'Inter', 'Arial'];
    case 'cyrillic':
      return ['Inter', 'Noto Sans', 'Arial', 'Arial Unicode MS'];
    default:
      return ['Inter', 'Noto Sans', 'Arial', 'Arial Unicode MS'];
  }
}

async function findUsableFallbackFonts(preferredStyle: string, translatedText: string, targetLang?: string): Promise<FontName[]> {
  const availableFonts = await getAvailableFonts();
  const script = detectScriptSample(translatedText, targetLang);
  const preferredFamilies = getPreferredFamilies(script);
  const candidates: FontName[] = [];
  const seen = new Set<string>();

  function pushCandidate(fontName: FontName) {
    const key = `${fontName.family}::${fontName.style}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(fontName);
    }
  }

  for (const family of preferredFamilies) {
    const exactStyle = availableFonts.find((font) => (
      font.fontName.family === family &&
      font.fontName.style === preferredStyle
    ));
    if (exactStyle) {
      pushCandidate(exactStyle.fontName);
    }

    const regular = availableFonts.find((font) => (
      font.fontName.family === family &&
      font.fontName.style === 'Regular'
    ));
    if (regular) {
      pushCandidate(regular.fontName);
    }

    const anyStyle = availableFonts.find((font) => font.fontName.family === family);
    if (anyStyle) {
      pushCandidate(anyStyle.fontName);
    }
  }

  for (const font of availableFonts) {
    pushCandidate(font.fontName);
  }

  return candidates;
}

async function setCharactersWithFallback(
  textNode: TextNode,
  translatedText: string,
  primaryFont: FontName | null,
  targetLang?: string,
): Promise<void> {
  try {
    textNode.characters = translatedText;
    return;
  } catch (e) {
    console.warn('Direct character replacement failed, trying fallback font:', e);
  }

  const fallbackFonts = await findUsableFallbackFonts(primaryFont?.style || 'Regular', translatedText, targetLang);
  const triedFamilies: string[] = [];

  for (const fallbackFont of fallbackFonts) {
    try {
      await figma.loadFontAsync(fallbackFont);
      textNode.fontName = fallbackFont;
      textNode.characters = translatedText;
      return;
    } catch (fallbackError) {
      triedFamilies.push(`${fallbackFont.family} ${fallbackFont.style}`);
      console.warn('Fallback font failed:', fallbackFont, fallbackError);
    }
  }

  if (triedFamilies.length === 0) {
    throw new Error('No fallback fonts are available in this file for the translated text.');
  }

  throw new Error(`No fallback font could render this translation. Tried: ${triedFamilies.slice(0, 6).join(', ')}`);
}

// ─── Output Modes ───────────────────────────────────────────────────────

async function applyReplace(result: TranslatedResult): Promise<void> {
  const textNode = await getTextNodeById(result.nodeId);
  if (!textNode) return;

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

  await setCharactersWithFallback(textNode, result.translated, primaryFont, result.targetLang);
}

async function applyAppend(result: TranslatedResult): Promise<void> {
  const textNode = await getTextNodeById(result.nodeId);
  if (!textNode) return;

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

  var separator = '\n';
  await setCharactersWithFallback(textNode, result.original + separator + result.translated, primaryFont, result.targetLang);
}

async function applyDuplicate(
  result: TranslatedResult,
  layoutMode: 'vertical-wrap' | 'vertical' | 'horizontal' | 'horizontal-wrap'
): Promise<void> {
  const textNode = await getTextNodeById(result.nodeId);
  if (!textNode) return;

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
  await setCharactersWithFallback(clonedNode, result.translated, primaryFont, result.targetLang);

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

  if (layoutMode === 'horizontal-wrap') {
    wrapper.layoutWrap = 'WRAP';
  } else {
    wrapper.layoutWrap = 'NO_WRAP';
  }

  wrapper.itemSpacing = 8;
  wrapper.counterAxisSpacing = 8;
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';

  if (wrapper.layoutMode === 'VERTICAL') {
    textNode.layoutAlign = 'STRETCH';
    clonedNode.layoutAlign = 'STRETCH';
  }

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

    if (msg.type === 'get-slide-draft-targets') {
      if (figma.editorType !== 'slides') {
        figma.ui.postMessage({
          type: 'slide-draft-selection-result',
          count: 0,
          targets: [],
          error: 'Slide notes draft mode is available in Figma Slides only.',
        });
        return;
      }

      const selection = figma.currentPage.selection;
      const targets = getSlideDraftTargets(selection);
      figma.ui.postMessage({
        type: 'slide-draft-selection-result',
        count: targets.length,
        targets,
        slideCount: targets.length,
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
          const node = await figma.getNodeByIdAsync(result.nodeId);
          const nodeLabel = node && 'name' in node && node.name
            ? `${node.name} (${result.nodeId})`
            : result.nodeId;
          console.error('Failed to apply translation for ' + nodeLabel + ':', e);
          errors.push(`Node ${nodeLabel}: ${errMsg}`);
          failed++;
        }
      }

      const errorSummary = errors.length > 0
        ? errors.slice(0, 3).join(' | ')
        : '';

      figma.ui.postMessage({
        type: 'apply-complete',
        applied: applied,
        failed: failed,
        errors: errors,
        errorSummary: errorSummary,
      });

      figma.notify(`Translation complete: ${applied} texts translated${failed > 0 ? `, ${failed} failed` : ''}`);
      if (errorSummary) {
        figma.notify(`Apply errors: ${errorSummary}`, { timeout: 7000 });
      }
    }

    if (msg.type === 'translate-deepl') {
      try {
        const translations = await callDeepLFromSandbox(
          msg.texts || [],
          msg.sourceLang,
          msg.targetLang,
          msg.apiKey,
          !!msg.isFree,
        );

        figma.ui.postMessage({
          type: 'deepl-result',
          requestId: msg.requestId,
          translations,
        });
      } catch (e: any) {
        figma.ui.postMessage({
          type: 'deepl-result',
          requestId: msg.requestId,
          error: e?.message || 'DeepL request failed',
        });
      }
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

    if (figma.editorType === 'slides') {
      const targets = selection.length > 0 ? getSlideDraftTargets(selection) : [];
      figma.ui.postMessage({
        type: 'slide-draft-selection-changed',
        count: targets.length,
        targets,
        slideCount: targets.length,
      });
    }
  } catch (err: any) {
    console.error('Selection change error:', err);
  }
});
