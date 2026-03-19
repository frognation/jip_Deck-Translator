// jip Translator - UI Logic
// This runs inside the plugin's iframe

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

interface SlideDraftResult {
  slideId: string;
  slideName: string;
  slideIndex: number;
  primaryLang: string;
  primaryDraft: string;
  secondaryLang?: string;
  secondaryDraft?: string;
}

// ─── State ──────────────────────────────────────────────────────────────
let currentEntries: TextEntry[] = [];
let currentSlideDraftTargets: SlideDraftTarget[] = [];
let currentSlideDraftResults: SlideDraftResult[] = [];
let isTranslating = false;
let currentMode: 'translate' | 'transform' | 'slide-notes' = 'translate';

// ─── Storage Helper (via Figma clientStorage) ───────────────────────────
// Figma plugin iframes can't use localStorage reliably.
// We proxy storage through the sandbox (code.ts) using figma.clientStorage.

function storageSet(key: string, value: string): void {
  parent.postMessage({ pluginMessage: { type: 'storage-set', key, value } }, '*');
}

function storageGet(key: string): void {
  parent.postMessage({ pluginMessage: { type: 'storage-get', key } }, '*');
}

// Storage callback queue
const storageCallbacks: Map<string, (value: string | null) => void> = new Map();
const deeplCallbacks: Map<string, { resolve: (value: string[]) => void; reject: (error: Error) => void }> = new Map();

function storageGetAsync(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    storageCallbacks.set(key, resolve);
    storageGet(key);
  });
}

function callDeepLViaSandbox(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  isFree: boolean,
): Promise<string[]> {
  const requestId = `deepl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    deeplCallbacks.set(requestId, { resolve, reject });
    parent.postMessage({
      pluginMessage: {
        type: 'translate-deepl',
        requestId,
        texts,
        sourceLang,
        targetLang,
        apiKey,
        isFree,
      },
    }, '*');
  });
}

// ─── Language Data ──────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', native: '자동 감지' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'fil', name: 'Filipino', native: 'Filipino' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
];

// ─── Template Data ──────────────────────────────────────────────────────
const TEMPLATES: Record<string, string> = {
  concise: `Translate concisely and clearly. Use short, direct sentences. Avoid redundancy. Prefer simple words over complex ones.`,
  slide: `This is a presentation/slide deck. Translate in a tone suitable for slides:
- Keep text brief and impactful
- Use bullet-point-friendly phrasing
- Maintain consistent terminology throughout
- Preserve the presenter's voice and intent`,
  detailed: `Translate thoroughly and accurately. Preserve all nuances, technical details, and subtleties of the original text. When ambiguous, prefer the more complete interpretation.`,
  polite: `Translate using polite, formal, and respectful language. Use honorifics and formal grammatical forms where appropriate. The tone should be professional and courteous.`,
  casual: `Translate in a casual, friendly, and conversational tone. Use informal language and natural expressions. Make it sound like a friend talking.`,
  technical: `This is technical/developer content. Translate accurately:
- Keep code terms, API names, and technical jargon in English
- Translate descriptions and explanations naturally
- Preserve formatting markers and variables
- Use established technical terminology in the target language`,
};

const TRANSFORM_TEMPLATES: Record<string, string> = {
  'remove-brand': `Remove labels like '(Draft)' and '(Internal)' wherever they appear. Keep the remaining text unchanged unless a minor grammar fix is needed.`,
  'formal-ko': `Rewrite all selected text in formal Korean using a clear and professional 합니다체 tone.`,
  shorten: `Shorten the selected text for presentation slides. Remove redundancy, keep the core meaning, and make each line concise and punchy.`,
  'replace-user': `Replace every occurrence of '고객' with '사용자'. Keep everything else unchanged unless needed for grammar.`,
};

// ─── DOM References ─────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;

const modelSelect = $('model-select') as HTMLSelectElement;
const apiKeyRow = $('api-key-row');
const apiKeyInput = $('api-key') as HTMLInputElement;
const btnToggleKey = $('btn-toggle-key');
const btnSaveKey = $('btn-save-key');

const translationLanguageSection = $('translation-language-section');
const transformSettingsSection = $('transform-settings-section');
const notesSettingsSection = $('notes-settings-section');
const translationOutputSection = $('translation-output-section');
const notesOutputSection = $('notes-output-section');
const btnCopyNotes = $('btn-copy-notes');
const notesOutputEmpty = $('notes-output-empty');
const notesOutputList = $('notes-output-list');

const sourceLangInput = $('source-lang-input') as HTMLInputElement;
const sourceLangDropdown = $('source-lang-dropdown');
const targetLangInput = $('target-lang-input') as HTMLInputElement;
const targetLangDropdown = $('target-lang-dropdown');
const notesPrimaryLangInput = $('notes-primary-lang-input') as HTMLInputElement;
const notesPrimaryLangDropdown = $('notes-primary-lang-dropdown');
const notesSecondaryLangInput = $('notes-secondary-lang-input') as HTMLInputElement;
const notesSecondaryLangDropdown = $('notes-secondary-lang-dropdown');
const notesSecondaryLangField = $('notes-secondary-lang-field');
const transformInstruction = $('transform-instruction') as HTMLTextAreaElement;
const transformChips = $('transform-chips');

const btnRefresh = $('btn-refresh');
const btnTranslate = $('btn-translate') as HTMLButtonElement;
const btnTranslateText = $('btn-translate-text');
const btnTranslateSpinner = $('btn-translate-spinner');
const progressBar = $('progress-bar');
const progressFill = $('progress-fill');
const progressText = $('progress-text');

const selectionStatus = $('selection-status');
const selectionText = $('selection-text');

const btnToggleGuidelines = $('btn-toggle-guidelines');
const guidelinesPanel = $('guidelines-panel');
const guidelineTextarea = $('guideline-text') as HTMLTextAreaElement;
const templateChips = $('template-chips');
const btnUploadMd = $('btn-upload-md');
const mdFileInput = $('md-file-input') as HTMLInputElement;
const mdFilename = $('md-filename');
const btnSaveGuideline = $('btn-save-guideline');
const btnLoadGuideline = $('btn-load-guideline');

const layoutOptions = $('layout-options');
const layoutDirection = $('layout-direction') as HTMLSelectElement;

const btnAbout = $('btn-about');
const aboutView = $('about-view');
const btnCloseAbout = $('btn-close-about');

// ─── Model → Provider Mapping ───────────────────────────────────────────
function getProvider(model: string): string {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('codex-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('deepl')) return 'deepl';
  return 'openai';
}

function needsApiKey(_model: string): boolean {
  // All models require an API key, including DeepL Free (free plan, but key needed)
  return true;
}

function getStorageKeyName(model: string): string {
  const provider = getProvider(model);
  return `jip-translator-apikey-${provider}`;
}

// ─── Initialization ─────────────────────────────────────────────────────

async function init() {
  // Request initial selection
  parent.postMessage({ pluginMessage: { type: 'get-selection' } }, '*');
  parent.postMessage({ pluginMessage: { type: 'get-slide-draft-targets' } }, '*');

  // Source lang default
  sourceLangInput.value = 'Auto-detect';
  sourceLangInput.dataset.code = 'auto';
  notesPrimaryLangInput.value = '한국어 (Korean)';
  notesPrimaryLangInput.dataset.code = 'ko';
  notesSecondaryLangInput.value = 'English (English)';
  notesSecondaryLangInput.dataset.code = 'en';

  // Setup dropdowns first (no async needed)
  setupSearchableDropdown(sourceLangInput, sourceLangDropdown, LANGUAGES);
  setupSearchableDropdown(targetLangInput, targetLangDropdown, LANGUAGES.filter(l => l.code !== 'auto'));
  setupSearchableDropdown(notesPrimaryLangInput, notesPrimaryLangDropdown, LANGUAGES.filter(l => l.code !== 'auto'));
  setupSearchableDropdown(notesSecondaryLangInput, notesSecondaryLangDropdown, LANGUAGES.filter(l => l.code !== 'auto'));

  // Load saved preferences via clientStorage
  const savedModel = await storageGetAsync('jip-translator-model');
  if (savedModel) {
    modelSelect.value = savedModel;
  }

  const savedTarget = await storageGetAsync('jip-translator-target-lang');
  if (savedTarget) {
    const lang = LANGUAGES.find(l => l.code === savedTarget);
    if (lang) {
      targetLangInput.value = `${lang.native} (${lang.name})`;
      targetLangInput.dataset.code = lang.code;
    }
  }

  updateApiKeyVisibility();
  updateModeUI();
  await loadSavedApiKey();
}

// ─── API Key Handling ───────────────────────────────────────────────────

function updateApiKeyVisibility() {
  if (needsApiKey(modelSelect.value)) {
    apiKeyRow.classList.remove('hidden');
  } else {
    apiKeyRow.classList.add('hidden');
  }
}

async function loadSavedApiKey() {
  const key = await storageGetAsync(getStorageKeyName(modelSelect.value));
  if (key) {
    apiKeyInput.value = key;
  } else {
    apiKeyInput.value = '';
  }
}

modelSelect.addEventListener('change', async () => {
  updateApiKeyVisibility();
  storageSet('jip-translator-model', modelSelect.value);
  await loadSavedApiKey();
});

btnToggleKey.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    storageSet(getStorageKeyName(modelSelect.value), key);
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'API key saved.' } }, '*');
  }
});

// ─── Searchable Dropdown ────────────────────────────────────────────────

function setupSearchableDropdown(
  input: HTMLInputElement,
  dropdown: HTMLElement,
  languages: typeof LANGUAGES,
) {
  let isMouseDownOnDropdown = false;

  function selectLang(lang: typeof LANGUAGES[0]) {
    input.value = lang.code === 'auto' ? 'Auto-detect' : `${lang.native} (${lang.name})`;
    input.dataset.code = lang.code;
    hideDropdown();

    // Save target lang
    if (input === targetLangInput) {
      storageSet('jip-translator-target-lang', lang.code);
    }
  }

  function showDropdown() {
    dropdown.style.display = 'block';
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
  }

  function render(filter: string) {
    const q = filter.toLowerCase().trim();
    const filtered = q === ''
      ? languages
      : languages.filter(l =>
          l.name.toLowerCase().includes(q) ||
          l.native.toLowerCase().includes(q) ||
          l.code.toLowerCase().includes(q)
        );

    dropdown.innerHTML = '';
    for (const lang of filtered) {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      if (input.dataset.code === lang.code) item.classList.add('selected');
      item.textContent = lang.code === 'auto'
        ? `🔍 Auto-detect (자동 감지)`
        : `${lang.native} (${lang.name})`;

      // Use mousedown + preventDefault to prevent input blur
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectLang(lang);
        input.blur();
      });

      dropdown.appendChild(item);
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-item';
      empty.textContent = 'No matching language';
      empty.style.color = 'var(--text-secondary)';
      empty.style.cursor = 'default';
      dropdown.appendChild(empty);
    }
  }

  // Prevent blur when clicking inside dropdown
  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isMouseDownOnDropdown = true;
  });

  dropdown.addEventListener('mouseup', () => {
    isMouseDownOnDropdown = false;
  });

  input.addEventListener('focus', () => {
    // Clear input to show all options when focused
    const currentCode = input.dataset.code;
    if (currentCode && currentCode !== '') {
      input.value = '';
    }
    render('');
    showDropdown();
  });

  input.addEventListener('input', () => {
    render(input.value);
    showDropdown();
  });

  input.addEventListener('blur', () => {
    // Small delay to allow mousedown on dropdown to fire
    setTimeout(() => {
      if (!isMouseDownOnDropdown) {
        hideDropdown();
        // Restore display value if user didn't select
        const code = input.dataset.code;
        if (code) {
          const lang = languages.find(l => l.code === code);
          if (lang) {
            input.value = lang.code === 'auto' ? 'Auto-detect' : `${lang.native} (${lang.name})`;
          }
        }
      }
    }, 200);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.dropdown-item') as NodeListOf<HTMLElement>;
    if (items.length === 0) return;

    const highlighted = dropdown.querySelector('.dropdown-item.highlighted') as HTMLElement | null;
    let idx = highlighted ? Array.from(items).indexOf(highlighted) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = idx < items.length - 1 ? idx + 1 : 0;
      items.forEach(i => i.classList.remove('highlighted'));
      items[idx]?.classList.add('highlighted');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = idx > 0 ? idx - 1 : items.length - 1;
      items.forEach(i => i.classList.remove('highlighted'));
      items[idx]?.classList.add('highlighted');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted && highlighted.dataset.code !== undefined) {
        // Find the lang object by the dropdown item's text content
        const code = languages.find(l => {
          const label = l.code === 'auto'
            ? `🔍 Auto-detect (자동 감지)`
            : `${l.native} (${l.name})`;
          return highlighted.textContent === label;
        });
        if (code) selectLang(code);
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
      input.blur();
    }
  });

  // Initialize: hide dropdown
  hideDropdown();
}

function getSelectedFeatureMode(): 'translate' | 'transform' | 'slide-notes' {
  return (document.querySelector('input[name="feature-mode"]:checked') as HTMLInputElement)?.value as 'translate' | 'transform' | 'slide-notes' || 'translate';
}

function getSelectedNotesLanguageMode(): 'single' | 'bilingual' {
  return (document.querySelector('input[name="notes-language-mode"]:checked') as HTMLInputElement)?.value as 'single' | 'bilingual' || 'bilingual';
}

function getSelectedNotesStyle(): 'speaker' | 'executive' | 'detailed' {
  return (document.querySelector('input[name="notes-style"]:checked') as HTMLInputElement)?.value as 'speaker' | 'executive' | 'detailed' || 'speaker';
}

function getSelectedNotesLength(): 'short' | 'medium' | 'long' {
  return (document.querySelector('input[name="notes-length"]:checked') as HTMLInputElement)?.value as 'short' | 'medium' | 'long' || 'short';
}

function updateSelectionStatus() {
  if (currentMode === 'slide-notes') {
    const count = currentSlideDraftTargets.length;
    if (count > 0) {
      selectionText.textContent = `${count} slide(s) ready for notes draft`;
      selectionStatus.classList.add('ready');
      selectionStatus.querySelector('.status-icon')!.textContent = '\u2705';
      btnTranslate.disabled = false;
    } else {
      selectionText.textContent = 'Select one or more slides in Figma Slides';
      selectionStatus.classList.remove('ready');
      selectionStatus.querySelector('.status-icon')!.textContent = '\u2610';
      btnTranslate.disabled = true;
    }
    return;
  }

  const count = currentEntries.length;
  const frameCount = new Set(currentEntries.map((entry) => entry.frameIndex)).size;
  if (count > 0) {
    selectionText.textContent = `${count} text(s) found in ${frameCount} frame(s)`;
    selectionStatus.classList.add('ready');
    selectionStatus.querySelector('.status-icon')!.textContent = '\u2705';
    btnTranslate.disabled = false;
  } else {
    selectionText.textContent = 'No text found in selection';
    selectionStatus.classList.remove('ready');
    selectionStatus.querySelector('.status-icon')!.textContent = '\u2610';
    btnTranslate.disabled = true;
  }
}

function updateModeUI() {
  currentMode = getSelectedFeatureMode();

  const notesMode = currentMode === 'slide-notes';
  const transformMode = currentMode === 'transform';
  translationLanguageSection.classList.toggle('hidden', notesMode || transformMode);
  transformSettingsSection.classList.toggle('hidden', !transformMode);
  translationOutputSection.classList.toggle('hidden', notesMode);
  notesSettingsSection.classList.toggle('hidden', !notesMode);
  notesOutputSection.classList.toggle('hidden', !notesMode);
  notesSecondaryLangField.classList.toggle('hidden', getSelectedNotesLanguageMode() === 'single');
  btnTranslateText.textContent = notesMode ? 'Generate Notes Draft' : (transformMode ? 'Apply Transform' : 'Translate');

  if (!notesMode) {
    progressText.textContent = '';
  }

  if (notesMode && currentSlideDraftResults.length === 0) {
    renderSlideDraftResults();
  }

  updateSelectionStatus();
}

function formatDraftForCopy(result: SlideDraftResult): string {
  const lines = [`[${result.slideName}]`];
  const primaryLabel = LANGUAGES.find((lang) => lang.code === result.primaryLang)?.name || result.primaryLang;
  lines.push(`${primaryLabel}\n${result.primaryDraft}`);

  if (result.secondaryLang && result.secondaryDraft) {
    const secondaryLabel = LANGUAGES.find((lang) => lang.code === result.secondaryLang)?.name || result.secondaryLang;
    lines.push(`${secondaryLabel}\n${result.secondaryDraft}`);
  }

  return lines.join('\n\n');
}

function renderSlideDraftResults() {
  notesOutputList.innerHTML = '';
  notesOutputEmpty.classList.toggle('hidden', currentSlideDraftResults.length > 0);

  for (const result of currentSlideDraftResults) {
    const card = document.createElement('div');
    card.className = 'notes-card';

    const header = document.createElement('div');
    header.className = 'notes-card-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'notes-card-title';
    title.textContent = result.slideName;
    const meta = document.createElement('div');
    meta.className = 'notes-card-meta';
    meta.textContent = result.secondaryLang ? `${result.primaryLang} / ${result.secondaryLang}` : result.primaryLang;
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(formatDraftForCopy(result));
      parent.postMessage({ pluginMessage: { type: 'notify', message: `${result.slideName} draft copied.` } }, '*');
    });

    header.appendChild(titleWrap);
    header.appendChild(copyBtn);

    const body = document.createElement('div');
    body.className = 'notes-card-body';
    const content = document.createElement('pre');
    content.textContent = formatDraftForCopy(result);
    body.appendChild(content);

    card.appendChild(header);
    card.appendChild(body);
    notesOutputList.appendChild(card);
  }
}

// ─── Output Mode ────────────────────────────────────────────────────────

document.querySelectorAll('input[name="feature-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    updateModeUI();
    if (currentMode === 'slide-notes') {
      parent.postMessage({ pluginMessage: { type: 'get-slide-draft-targets' } }, '*');
    } else {
      parent.postMessage({ pluginMessage: { type: 'get-selection' } }, '*');
    }
  });
});

document.querySelectorAll('input[name="notes-language-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    notesSecondaryLangField.classList.toggle('hidden', getSelectedNotesLanguageMode() === 'single');
  });
});

document.querySelectorAll('input[name="output-mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const val = (e.target as HTMLInputElement).value;
    if (val === 'duplicate') {
      layoutOptions.classList.remove('hidden');
    } else {
      layoutOptions.classList.add('hidden');
    }
  });
});

// ─── Guidelines ─────────────────────────────────────────────────────────

btnToggleGuidelines.addEventListener('click', () => {
  guidelinesPanel.classList.toggle('hidden');
  btnToggleGuidelines.classList.toggle('open');
});

// Template chips
templateChips.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('chip')) return;

  const template = target.dataset.template!;

  // Toggle active
  if (target.classList.contains('active')) {
    target.classList.remove('active');
    guidelineTextarea.value = '';
    return;
  }

  templateChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  target.classList.add('active');
  guidelineTextarea.value = TEMPLATES[template] || '';
});

transformChips.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('chip')) return;

  const template = target.dataset.transform!;

  if (target.classList.contains('active')) {
    target.classList.remove('active');
    transformInstruction.value = '';
    return;
  }

  transformChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  target.classList.add('active');
  transformInstruction.value = TRANSFORM_TEMPLATES[template] || '';
});

// MD file upload
btnUploadMd.addEventListener('click', () => mdFileInput.click());
mdFileInput.addEventListener('change', () => {
  const file = mdFileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    guidelineTextarea.value = reader.result as string;
    mdFilename.textContent = file.name;
    // Clear template selection
    templateChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  };
  reader.readAsText(file);
});

// Save/Load guidelines
btnSaveGuideline.addEventListener('click', () => {
  const text = guidelineTextarea.value.trim();
  if (text) {
    storageSet('jip-translator-guideline', text);
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Guideline saved.' } }, '*');
  }
});

btnLoadGuideline.addEventListener('click', async () => {
  const saved = await storageGetAsync('jip-translator-guideline');
  if (saved) {
    guidelineTextarea.value = saved;
    templateChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Guideline loaded.' } }, '*');
  } else {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'No saved guideline found.' } }, '*');
  }
});

// ─── About ──────────────────────────────────────────────────────────────

btnAbout.addEventListener('click', () => aboutView.classList.remove('hidden'));
btnCloseAbout.addEventListener('click', () => aboutView.classList.add('hidden'));

// ─── Selection Refresh ─────────────────────────────────────────────────

btnRefresh.addEventListener('click', () => {
  const type = currentMode === 'slide-notes' ? 'get-slide-draft-targets' : 'get-selection';
  parent.postMessage({ pluginMessage: { type } }, '*');
});

btnCopyNotes.addEventListener('click', async () => {
  if (currentSlideDraftResults.length === 0) return;
  const text = currentSlideDraftResults.map(formatDraftForCopy).join('\n\n--------------------\n\n');
  await navigator.clipboard.writeText(text);
  parent.postMessage({ pluginMessage: { type: 'notify', message: 'All note drafts copied.' } }, '*');
});

// ─── Translation API Calls ──────────────────────────────────────────────

function buildContextPrompt(entries: TextEntry[], sourceLang: string, targetLang: string, guideline: string): string {
  const sourceLabel = sourceLang === 'auto'
    ? 'Auto-detect the source language'
    : `Source language: ${LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang}`;
  const targetLabel = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang;

  const textsBlock = entries
    .map((e, i) => `[TEXT_${i}]\n${e.text}`)
    .join('\n\n');

  return `You are a professional translator. Translate the following texts into ${targetLabel}.

${sourceLabel}.

IMPORTANT INSTRUCTIONS:
- These texts are from a presentation/document. Read ALL texts first to understand the full context and flow.
- Translate coherently — each piece should make sense in the context of the whole document.
- Maintain consistent terminology throughout all translations.
- Preserve any formatting, line breaks, bullet points, numbers, and special characters.
- Do NOT translate brand names, proper nouns, code, URLs, or technical identifiers unless appropriate.
- Return ONLY the translations in the exact same order, using the format [TEXT_0], [TEXT_1], etc.

${guideline ? `ADDITIONAL GUIDELINES:\n${guideline}\n` : ''}
Here are the texts to translate:

${textsBlock}

Return format (one per text, keep the markers):
[TEXT_0]
translated text here

[TEXT_1]
translated text here

... and so on for all texts.`;
}

function parseTranslationResponse(response: string, count: number): string[] {
  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    const marker = `[TEXT_${i}]`;
    const nextMarker = `[TEXT_${i + 1}]`;

    const start = response.indexOf(marker);
    if (start === -1) {
      results.push('');
      continue;
    }

    const contentStart = start + marker.length;
    const end = i < count - 1
      ? response.indexOf(nextMarker, contentStart)
      : response.length;

    const text = response.substring(contentStart, end === -1 ? undefined : end).trim();
    results.push(text);
  }

  return results;
}

function buildTransformPrompt(entries: TextEntry[], instruction: string, guideline: string): string {
  const textsBlock = entries
    .map((entry, index) => `[TEXT_${index}]\n${entry.text}`)
    .join('\n\n');

  return `You are editing text content from a Figma document.

Apply the user's instruction to each selected text item.

USER INSTRUCTION:
${instruction}

IMPORTANT INSTRUCTIONS:
- Read all selected texts first to understand context and terminology.
- Apply the instruction consistently across all texts.
- Preserve line breaks, bullets, numbering, placeholders, URLs, and formatting markers unless the instruction explicitly asks to change them.
- If a text item does not need any change, return it unchanged.
- Return ONLY the edited texts in the exact same order and marker format.

${guideline ? `ADDITIONAL GUIDELINES:\n${guideline}\n` : ''}Selected texts:

${textsBlock}

Return format:
[TEXT_0]
edited text here

[TEXT_1]
edited text here`;
}

function buildSlideDraftPrompt(
  targets: SlideDraftTarget[],
  primaryLang: string,
  secondaryLang: string | null,
  style: 'speaker' | 'executive' | 'detailed',
  length: 'short' | 'medium' | 'long',
  guideline: string,
): string {
  const primaryLabel = LANGUAGES.find((lang) => lang.code === primaryLang)?.name || primaryLang;
  const secondaryLabel = secondaryLang
    ? (LANGUAGES.find((lang) => lang.code === secondaryLang)?.name || secondaryLang)
    : null;

  const slidesBlock = targets.map((target, index) => {
    const content = target.text.trim() || '(No visible text on slide)';
    return `[SLIDE_${index}]
TITLE: ${target.slideName}
CONTENT:
${content}`;
  }).join('\n\n');

  const bilingualInstruction = secondaryLabel
    ? `For each slide, write two concise speaker-note drafts: first in ${primaryLabel}, then in ${secondaryLabel}.`
    : `For each slide, write one concise speaker-note draft in ${primaryLabel}.`;

  const styleInstruction = style === 'executive'
    ? 'Use a polished executive tone. Prioritize clarity, confidence, and brevity.'
    : style === 'detailed'
      ? 'Write a more complete talk track with helpful connective phrasing and implied context from the slide.'
      : 'Write like a natural presenter speaking through the slide.';

  const lengthInstruction = length === 'long'
    ? 'Aim for roughly 6-10 spoken lines per slide.'
    : length === 'medium'
      ? 'Aim for roughly 4-7 spoken lines per slide.'
      : 'Aim for roughly 2-4 spoken lines per slide.';

  const returnFormat = secondaryLabel
    ? `[SLIDE_0]
<PRIMARY>
draft in ${primaryLabel}
</PRIMARY>
<SECONDARY>
draft in ${secondaryLabel}
</SECONDARY>`
    : `[SLIDE_0]
<PRIMARY>
draft in ${primaryLabel}
</PRIMARY>`;

  return `You are helping prepare speaker notes for a presentation in Figma Slides.

Read the content of each selected slide and write a presenter-friendly draft that helps the speaker explain the slide naturally.

IMPORTANT INSTRUCTIONS:
- Treat each slide independently.
- Infer the likely intent and narrative of the slide from its visible text.
- Keep the notes concise, natural, and easy to speak out loud.
- Expand bullet points into a spoken explanation, but do not invent facts that are not reasonably implied by the slide.
- If a slide has very little text, write a short supporting script rather than repeating the slide verbatim.
- Preserve key terms, product names, and numbers when needed.
- ${styleInstruction}
- ${lengthInstruction}
- ${bilingualInstruction}
- Return ONLY the results in the exact marker format below.

${guideline ? `ADDITIONAL GUIDELINES:\n${guideline}\n` : ''}Selected slides:

${slidesBlock}

Return format:
${returnFormat}

Repeat that structure for every slide marker in order.`;
}

function extractTaggedSection(block: string, tag: 'PRIMARY' | 'SECONDARY'): string {
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  const start = block.indexOf(startTag);
  const end = block.indexOf(endTag);
  if (start === -1 || end === -1 || end <= start) return '';
  return block.slice(start + startTag.length, end).trim();
}

function parseSlideDraftResponse(
  response: string,
  targets: SlideDraftTarget[],
  primaryLang: string,
  secondaryLang: string | null,
): SlideDraftResult[] {
  const results: SlideDraftResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const marker = `[SLIDE_${i}]`;
    const nextMarker = `[SLIDE_${i + 1}]`;
    const start = response.indexOf(marker);
    const end = i < targets.length - 1 ? response.indexOf(nextMarker, start + marker.length) : response.length;
    const block = start === -1
      ? ''
      : response.substring(start + marker.length, end === -1 ? undefined : end).trim();

    const primaryDraft = extractTaggedSection(block, 'PRIMARY') || block;
    const parsedSecondary = secondaryLang ? extractTaggedSection(block, 'SECONDARY') : '';

    results.push({
      slideId: targets[i].slideId,
      slideName: targets[i].slideName,
      slideIndex: targets[i].slideIndex,
      primaryLang,
      primaryDraft: primaryDraft || 'No draft returned.',
      secondaryLang: secondaryLang || undefined,
      secondaryDraft: secondaryLang ? (parsedSecondary || 'No secondary draft returned.') : undefined,
    });
  }

  return results;
}

async function callOpenAI(prompt: string, apiKey: string, model: string): Promise<string> {
  // Newer OpenAI models (o-series, gpt-4.1, gpt-5.x) use max_completion_tokens
  // Older models (gpt-4o, gpt-4o-mini) use max_tokens
  var useNewTokenParam = model.startsWith('gpt-4.1') ||
                         model.startsWith('gpt-5') ||
                         model.startsWith('codex-') ||
                         model.startsWith('o1') ||
                         model.startsWith('o3') ||
                         model.startsWith('o4');

  var body: any = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  };

  if (useNewTokenParam) {
    body.max_completion_tokens = 16000;
  } else {
    body.max_tokens = 16000;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(function() { return {}; });
    throw new Error('OpenAI API error: ' + ((err as any).error ? (err as any).error.message : response.statusText));
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error: ${(err as any).error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callGemini(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${(err as any).error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callModelPrompt(prompt: string, apiKey: string, model: string): Promise<string> {
  const provider = getProvider(model);
  if (provider === 'openai') {
    return callOpenAI(prompt, apiKey, model);
  }
  if (provider === 'anthropic') {
    return callAnthropic(prompt, apiKey, model);
  }
  if (provider === 'google') {
    return callGemini(prompt, apiKey, model);
  }
  throw new Error('This mode requires an AI text model, not DeepL.');
}

async function translate(
  entries: TextEntry[],
  sourceLang: string,
  targetLang: string,
  model: string,
  apiKey: string,
  guideline: string,
): Promise<TranslatedResult[]> {
  const provider = getProvider(model);

  if (provider === 'deepl') {
    const isFree = model === 'deepl-free';
    const texts = entries.map(e => e.text);
    const translated = await callDeepLViaSandbox(texts, sourceLang, targetLang, apiKey, isFree);

    return entries.map((e, i) => ({
      nodeId: e.nodeId,
      original: e.text,
      translated: translated[i] || e.text,
      targetLang,
    }));
  }

  // AI-based translation (batch all texts in one prompt for context)
  const prompt = buildContextPrompt(entries, sourceLang, targetLang, guideline);

  const response = await callModelPrompt(prompt, apiKey, model);

  const translations = parseTranslationResponse(response, entries.length);

  return entries.map((e, i) => ({
    nodeId: e.nodeId,
    original: e.text,
    translated: translations[i] || e.text,
    targetLang,
  }));
}

async function transformTextEntries(
  entries: TextEntry[],
  instruction: string,
  model: string,
  apiKey: string,
  guideline: string,
): Promise<TranslatedResult[]> {
  const prompt = buildTransformPrompt(entries, instruction, guideline);
  const response = await callModelPrompt(prompt, apiKey, model);
  const transformed = parseTranslationResponse(response, entries.length);

  return entries.map((entry, index) => ({
    nodeId: entry.nodeId,
    original: entry.text,
    translated: transformed[index] || entry.text,
  }));
}

async function generateSlideDrafts(
  targets: SlideDraftTarget[],
  primaryLang: string,
  secondaryLang: string | null,
  style: 'speaker' | 'executive' | 'detailed',
  length: 'short' | 'medium' | 'long',
  model: string,
  apiKey: string,
  guideline: string,
): Promise<SlideDraftResult[]> {
  const prompt = buildSlideDraftPrompt(targets, primaryLang, secondaryLang, style, length, guideline);
  const response = await callModelPrompt(prompt, apiKey, model);
  return parseSlideDraftResponse(response, targets, primaryLang, secondaryLang);
}

// ─── Translate Button Handler ───────────────────────────────────────────

btnTranslate.addEventListener('click', async () => {
  if (isTranslating) return;

  const model = modelSelect.value;
  const apiKey = apiKeyInput.value.trim();
  const sourceLang = sourceLangInput.dataset.code || 'auto';
  const targetLang = targetLangInput.dataset.code || '';
  const guideline = guidelineTextarea.value.trim();
  const outputMode = (document.querySelector('input[name="output-mode"]:checked') as HTMLInputElement)?.value || 'replace';
  const dupLayout = layoutDirection.value;
  const notesLanguageMode = getSelectedNotesLanguageMode();
  const notesPrimaryLang = notesPrimaryLangInput.dataset.code || '';
  const notesSecondaryLang = notesLanguageMode === 'bilingual'
    ? (notesSecondaryLangInput.dataset.code || '')
    : '';
  const notesStyle = getSelectedNotesStyle();
  const notesLength = getSelectedNotesLength();
  const transformCommand = transformInstruction.value.trim();

  if (currentMode === 'translate' && currentEntries.length === 0) return;
  if (currentMode === 'transform' && currentEntries.length === 0) return;
  if (currentMode === 'slide-notes' && currentSlideDraftTargets.length === 0) return;

  // Validation
  if (currentMode === 'translate' && !targetLang) {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Please select a target language.' } }, '*');
    return;
  }

  if (currentMode === 'slide-notes' && !notesPrimaryLang) {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Please select a primary draft language.' } }, '*');
    return;
  }

  if (currentMode === 'slide-notes' && notesLanguageMode === 'bilingual' && !notesSecondaryLang) {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Please select a secondary draft language.' } }, '*');
    return;
  }

  if (currentMode === 'transform' && !transformCommand) {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Please enter a transform instruction.' } }, '*');
    return;
  }

  if (needsApiKey(model) && !apiKey) {
    parent.postMessage({ pluginMessage: { type: 'notify', message: 'Please enter an API key for this model.' } }, '*');
    return;
  }

  if ((currentMode === 'slide-notes' || currentMode === 'transform') && getProvider(model) === 'deepl') {
    parent.postMessage({ pluginMessage: { type: 'notify', message: `${currentMode === 'slide-notes' ? 'Slide notes draft' : 'Text transform'} mode requires GPT, Claude, or Gemini.` } }, '*');
    return;
  }

  if (currentMode === 'translate' && model === 'deepl-free' && !apiKey.endsWith(':fx')) {
    parent.postMessage({
      pluginMessage: {
        type: 'notify',
        message: 'DeepL Free keys usually end with :fx. This looks like a Pro key or an invalid key.',
        timeout: 5000,
      },
    }, '*');
    return;
  }

  if (currentMode === 'translate' && model === 'deepl-pro' && apiKey.endsWith(':fx')) {
    parent.postMessage({
      pluginMessage: {
        type: 'notify',
        message: 'This looks like a DeepL Free key (:fx). Select DeepL Free instead of DeepL Pro.',
        timeout: 5000,
      },
    }, '*');
    return;
  }

  // Auto-save API key if entered
  if (apiKey && needsApiKey(model)) {
    storageSet(getStorageKeyName(model), apiKey);
  }

  // Start translation
  isTranslating = true;
  btnTranslate.disabled = true;
  btnTranslateText.textContent = currentMode === 'slide-notes'
    ? 'Generating...'
    : (currentMode === 'transform' ? 'Applying...' : 'Translating...');
  btnTranslateSpinner.classList.remove('hidden');
  progressBar.classList.remove('hidden');
  progressText.classList.remove('hidden');
  progressFill.style.width = '10%';
  progressText.textContent = currentMode === 'slide-notes'
    ? 'Analyzing selected slides...'
    : (currentMode === 'transform' ? 'Preparing text transformation...' : 'Sending to AI...');

  try {
    if (currentMode === 'transform') {
      const CHUNK_SIZE = 30;
      const allResults: TranslatedResult[] = [];
      const totalChunks = Math.ceil(currentEntries.length / CHUNK_SIZE);

      for (let i = 0; i < currentEntries.length; i += CHUNK_SIZE) {
        const chunk = currentEntries.slice(i, i + CHUNK_SIZE);
        const chunkIndex = Math.floor(i / CHUNK_SIZE);

        const pct = 10 + (chunkIndex / totalChunks) * 60;
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `Transforming batch ${chunkIndex + 1}/${totalChunks}...`;

        const results = await transformTextEntries(chunk, transformCommand, model, apiKey, guideline);
        allResults.push(...results);
      }

      progressFill.style.width = '80%';
      progressText.textContent = 'Applying transformed text to Figma...';

      parent.postMessage({
        pluginMessage: {
          type: 'apply-translations',
          results: allResults,
          entries: currentEntries,
          outputMode: 'replace',
          duplicateLayout: dupLayout,
        },
      }, '*');
      return;
    }

    if (currentMode === 'slide-notes') {
      const CHUNK_SIZE = 8;
      const allDrafts: SlideDraftResult[] = [];
      const totalChunks = Math.ceil(currentSlideDraftTargets.length / CHUNK_SIZE);

      for (let i = 0; i < currentSlideDraftTargets.length; i += CHUNK_SIZE) {
        const chunk = currentSlideDraftTargets.slice(i, i + CHUNK_SIZE);
        const chunkIndex = Math.floor(i / CHUNK_SIZE);

        const pct = 10 + (chunkIndex / totalChunks) * 70;
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `Generating notes ${chunkIndex + 1}/${totalChunks}...`;

        const results = await generateSlideDrafts(
          chunk,
          notesPrimaryLang,
          notesLanguageMode === 'bilingual' ? notesSecondaryLang : null,
          notesStyle,
          notesLength,
          model,
          apiKey,
          guideline,
        );
        allDrafts.push(...results);
      }

      currentSlideDraftResults = allDrafts;
      renderSlideDraftResults();
      progressFill.style.width = '100%';
      progressText.textContent = `Done! ${allDrafts.length} slide draft(s) generated.`;
      parent.postMessage({
        pluginMessage: {
          type: 'notify',
          message: `${allDrafts.length} slide note draft(s) generated.`,
        },
      }, '*');

      setTimeout(() => {
        progressBar.classList.add('hidden');
        progressFill.style.width = '0%';
        isTranslating = false;
        btnTranslate.disabled = currentSlideDraftTargets.length === 0;
        btnTranslateText.textContent = 'Generate Notes Draft';
        btnTranslateSpinner.classList.add('hidden');
      }, 1200);
      return;
    }

    // For large batches, chunk into groups to avoid token limits
    const CHUNK_SIZE = 30;
    const allResults: TranslatedResult[] = [];
    const totalChunks = Math.ceil(currentEntries.length / CHUNK_SIZE);

    for (let i = 0; i < currentEntries.length; i += CHUNK_SIZE) {
      const chunk = currentEntries.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);

      const pct = 10 + (chunkIndex / totalChunks) * 60;
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `Translating batch ${chunkIndex + 1}/${totalChunks}...`;

      const results = await translate(chunk, sourceLang, targetLang, model, apiKey, guideline);
      allResults.push(...results);
    }

    progressFill.style.width = '80%';
    progressText.textContent = 'Applying translations to Figma...';

    // Send results back to code.ts
    parent.postMessage({
      pluginMessage: {
        type: 'apply-translations',
        results: allResults,
        entries: currentEntries,
        outputMode,
        duplicateLayout: dupLayout,
      },
    }, '*');

  } catch (err: any) {
    progressFill.style.width = '0%';
    progressBar.classList.add('hidden');
    progressText.textContent = `Error: ${err.message}`;
    const failureLabel = currentMode === 'slide-notes'
      ? 'Notes draft failed'
      : (currentMode === 'transform' ? 'Text transform failed' : 'Translation failed');
    parent.postMessage({ pluginMessage: { type: 'notify', message: `${failureLabel}: ${err.message}` } }, '*');
    isTranslating = false;
    btnTranslate.disabled = currentMode === 'slide-notes'
      ? currentSlideDraftTargets.length === 0
      : currentEntries.length === 0;
    btnTranslateText.textContent = currentMode === 'slide-notes'
      ? 'Generate Notes Draft'
      : (currentMode === 'transform' ? 'Apply Transform' : 'Translate');
    btnTranslateSpinner.classList.add('hidden');
  }
});

// ─── Messages from Figma Sandbox ────────────────────────────────────────

window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  // Handle storage responses
  if (msg.type === 'storage-result') {
    const cb = storageCallbacks.get(msg.key);
    if (cb) {
      storageCallbacks.delete(msg.key);
      cb(msg.value);
    }
    return;
  }

  if (msg.type === 'deepl-result') {
    const cb = deeplCallbacks.get(msg.requestId);
    if (cb) {
      deeplCallbacks.delete(msg.requestId);
      if (msg.error) {
        cb.reject(new Error(msg.error));
      } else {
        cb.resolve(msg.translations || []);
      }
    }
    return;
  }

  if (msg.type === 'selection-result' || msg.type === 'selection-changed') {
    currentEntries = msg.entries || [];
    updateSelectionStatus();
    return;
  }

  if (msg.type === 'slide-draft-selection-result' || msg.type === 'slide-draft-selection-changed') {
    currentSlideDraftTargets = msg.targets || [];
    currentSlideDraftResults = [];
    renderSlideDraftResults();
    updateSelectionStatus();
    return;
  }

  if (msg.type === 'apply-complete') {
    progressFill.style.width = '100%';
    var doneMsg = 'Done! ' + msg.applied + ' translated';
    if (msg.failed > 0) {
      doneMsg += ', ' + msg.failed + ' failed';
      if (msg.errorSummary) {
        doneMsg += `\n${msg.errorSummary}`;
        parent.postMessage({
          pluginMessage: {
            type: 'notify',
            message: `Apply failed: ${msg.errorSummary}`,
            timeout: 7000,
          },
        }, '*');
      }
    }
    progressText.textContent = doneMsg;

    // Log detailed errors to console for debugging
    if (msg.errors && msg.errors.length > 0) {
      console.error('Translation apply errors:', msg.errors);
    }

    setTimeout(function() {
      progressBar.classList.add('hidden');
      progressFill.style.width = '0%';
      isTranslating = false;
      btnTranslate.disabled = currentEntries.length === 0;
      btnTranslateText.textContent = currentMode === 'slide-notes'
        ? 'Generate Notes Draft'
        : (currentMode === 'transform' ? 'Apply Transform' : 'Translate');
      btnTranslateSpinner.classList.add('hidden');
    }, 3000);
  }
};

// ─── Start ──────────────────────────────────────────────────────────────
init();
