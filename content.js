// ─────────────────────────────────────────────
// QuickSnip — Content Script
// Detects shortcut typing, expands snippets,
// and shows tab picker when multiple tabs match
// ─────────────────────────────────────────────

(function () {
  'use strict';

  let snippets = [];

  // ── Load & sync snippets ──
  function loadSnippets() {
    chrome.storage.local.get('snippets', (data) => {
      snippets = data.snippets || [];
    });
  }

  loadSnippets();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.snippets) {
      snippets = changes.snippets.newValue || [];
    }
  });

  // ── Inspector Mode ──
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'INJECT_INSPECTOR') {
      startInspector();
    } else if (message.type === 'STOP_INSPECTOR') {
      stopInspector();
    }
  });

  let banner = null;
  let highlight = null;
  let tooltip = null;

  function startInspector() {
    if (document.getElementById('quicksnip-inspector-overlay')) return;

    // 1. Injetar Banner superior APENAS na top window (para não repetir em iframes)
    if (window === window.top) {
      banner = document.createElement('div');
      banner.id = 'quicksnip-inspector-banner';
      Object.assign(banner.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        background: '#1D1D1F',
        color: '#FFFFFF',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: '2147483647',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      });

      const info = document.createElement('div');
      info.textContent = 'Clique no elemento que contém a informação desejada (Esc para cancelar)';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar';
      Object.assign(cancelBtn.style, {
        background: '#FF3B30',
        color: '#FFF',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 12px',
        cursor: 'pointer',
        fontWeight: '500'
      });
      cancelBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_INSPECTOR' });
      };

      banner.appendChild(info);
      banner.appendChild(cancelBtn);
      document.body.appendChild(banner);
    }

    // 2. Injetar Highlight box em todos os frames
    highlight = document.createElement('div');
    highlight.id = 'quicksnip-inspector-overlay';
    Object.assign(highlight.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      background: 'rgba(0, 113, 227, 0.08)',
      border: '2px solid #0071E3',
      borderRadius: '4px',
      transition: 'all 50ms linear',
      display: 'none'
    });

    tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'absolute',
      bottom: '100%',
      left: '-2px',
      marginBottom: '4px',
      background: '#0071E3',
      color: '#FFF',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap',
      maxWidth: '300px',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
    highlight.appendChild(tooltip);
    document.body.appendChild(highlight);

    // Attach events globally
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);

    // Force crosshair
    document.body.style.cursor = 'crosshair';
  }

  let lastEl = null;

  function handleMouseMove(e) {
    if (!highlight || !tooltip) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === lastEl || el.id.startsWith('quicksnip-')) return;
    
    lastEl = el;
    const rect = el.getBoundingClientRect();
    
    Object.assign(highlight.style, {
      display: 'block',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });

    // Preview value
    let val = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') val = el.value;
    else if (el.dataset && el.dataset.value) val = el.dataset.value;
    else val = el.innerText;

    tooltip.textContent = (val || '').trim().substring(0, 50) || '<vazio>';
  }

  function handleClick(e) {
    if (e.target.id && e.target.id.startsWith('quicksnip-')) return;
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    const selector = gerarSeletor(el);
    
    let val = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') val = el.value;
    else if (el.dataset && el.dataset.value) val = el.dataset.value;
    else val = el.innerText;

    chrome.runtime.sendMessage({
      type: 'INSPECTOR_RESULT',
      selector: selector,
      preview: (val || '').trim()
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({ type: 'CANCEL_INSPECTOR' });
    }
  }

  function stopInspector() {
    if (banner) {
      banner.remove();
      banner = null;
    }
    if (highlight) {
      highlight.remove();
      highlight = null;
    }
    tooltip = null;
    lastEl = null;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.body.style.cursor = 'default';
  }

  function gerarSeletor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/).filter(Boolean).map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        const seletor = `${el.tagName.toLowerCase()}${classes}`;
        try {
          if (document.querySelectorAll(seletor).length === 1) return seletor;
        } catch(e) {}
      }
    }

    const partes = [];
    let atual = el;
    while (atual && atual !== document.body && atual !== document.documentElement) {
      let parte = atual.tagName.toLowerCase();
      if (atual.id) {
        partes.unshift(`#${CSS.escape(atual.id)}`);
        break;
      }
      if (atual.className && typeof atual.className === 'string') {
        const cls = atual.className.split(/\s+/).filter(Boolean).map(c => `.${CSS.escape(c)}`).join('');
        if (cls) parte += cls;
      }
      partes.unshift(parte);
      atual = atual.parentElement;
    }
    return partes.join(' > ');
  }

  // ── Input listener ──
  document.addEventListener('input', handleInput, true);

  function handleInput(e) {
    // Suporte para Web Components / Shadow DOM
    const el = e.composedPath && e.composedPath().length > 0 ? e.composedPath()[0] : e.target;
    if (!isEditable(el)) return;

    if (el.isContentEditable) {
      handleContentEditable(el);
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      handleInputField(el);
    }
  }

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      // Permitir praticamente tudo onde o usuário digita texto
      const invalidTypes = ['radio', 'checkbox', 'submit', 'button', 'hidden', 'color', 'file', 'image', 'range', 'reset', 'date', 'month', 'week', 'time', 'datetime-local'];
      return !invalidTypes.includes(type);
    }
    return el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  // ── Input/Textarea handling ──
  function handleInputField(el) {
    const value = el.value;
    const cursorPos = el.selectionStart;
    if (cursorPos === null || cursorPos === undefined) return;
    
    const textBeforeCursor = value.substring(0, cursorPos);

    for (const snippet of snippets) {
      if (textBeforeCursor.endsWith(snippet.shortcut)) {
        requestExpansion(snippet, {
          type: 'input',
          element: el,
          shortcut: snippet.shortcut,
          cursorPos
        });
        return;
      }
    }
  }

  // ── ContentEditable handling ──
  function handleContentEditable(el) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    const offset = range.startOffset;
    const textBeforeCursor = text.substring(0, offset);

    for (const snippet of snippets) {
      if (textBeforeCursor.endsWith(snippet.shortcut)) {
        requestExpansion(snippet, {
          type: 'contentEditable',
          node,
          element: el,
          shortcut: snippet.shortcut,
          offset
        });
        return;
      }
    }
  }

  // ── Expansion request (with tab selection support) ──
  function requestExpansion(snippet, context) {
    chrome.runtime.sendMessage(
      { type: 'EXPAND_SNIPPET', snippet },
      (response) => {
        if (!response) return;

        if (response.needsSelection) {
          // Multiple tabs match — show picker
          handleTabSelection(snippet, context, response.pendingVars);
        } else if (response.expandedText) {
          // Direct expansion
          performReplacement(context, response.expandedText);
        }
      }
    );
  }

  // ── Tab selection flow ──
  function handleTabSelection(snippet, context, pendingVars) {
    const tabSelections = {};
    let currentIndex = 0;

    function processNext() {
      if (currentIndex >= pendingVars.length) {
        // All selections done — expand with chosen tabs
        chrome.runtime.sendMessage(
          { type: 'EXPAND_WITH_SELECTIONS', snippet, tabSelections },
          (response) => {
            if (response && response.expandedText) {
              performReplacement(context, response.expandedText);
            }
          }
        );
        return;
      }

      const pending = pendingVars[currentIndex];
      showTabPicker(pending.varName, pending.tabs, (selectedTabId) => {
        if (selectedTabId === null) {
          // User cancelled — don't expand
          return;
        }
        tabSelections[pending.varName] = selectedTabId;
        currentIndex++;
        processNext();
      });
    }

    processNext();
  }

  // ── Hack to set value for React/Vue ──
  function setNativeValue(element, value) {
    try {
      const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }
    } catch (e) {
      element.value = value;
    }
  }

  // ── Replacement logic ──
  function performReplacement(context, expandedText) {
    if (context.type === 'input') {
      replaceInInput(context.element, expandedText, context.shortcut, context.cursorPos);
    } else if (context.type === 'contentEditable') {
      replaceInContentEditable(context.node, context.element, expandedText, context.shortcut, context.offset);
    }
  }

  function replaceInInput(el, expandedText, shortcut, cursorPos) {
    const value = el.value;
    const start = cursorPos - shortcut.length;
    const before = value.substring(0, start);
    const after = value.substring(cursorPos);

    el.focus();
    el.setSelectionRange(start, cursorPos);

    if (!document.execCommand('insertText', false, expandedText)) {
      // Fallback robusto para frameworks
      setNativeValue(el, before + expandedText + after);
      el.setSelectionRange(start + expandedText.length, start + expandedText.length);
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
  }

  function replaceInContentEditable(node, el, expandedText, shortcut, offset) {
    const start = offset - shortcut.length;

    // Tentar execCommand primeiro (mais seguro para rich text editors)
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, offset);
    selection.removeAllRanges();
    selection.addRange(range);

    if (!document.execCommand('insertText', false, expandedText)) {
      // Fallback
      const text = node.textContent;
      node.textContent = text.substring(0, start) + expandedText + text.substring(offset);

      const newRange = document.createRange();
      newRange.setStart(node, start + expandedText.length);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  // ═══════════════════════════════════════════════
  // TAB PICKER UI — injected into the page
  // All styles inline for maximum compatibility
  // ═══════════════════════════════════════════════

  const PICKER_ID = 'quicksnip-tab-picker';
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  function removePicker() {
    const existing = document.getElementById(PICKER_ID);
    if (existing) existing.remove();
  }

  function showTabPicker(varName, tabs, onSelect) {
    removePicker();

    let filteredTabs = [...tabs];

    // ── Overlay ──
    const overlay = document.createElement('div');
    overlay.id = PICKER_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0, 0, 0, 0.35)',
      backdropFilter: 'blur(6px)',
      webkitBackdropFilter: 'blur(6px)',
      zIndex: '2147483647',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: FONT,
      animation: 'quicksnip-fade-in 120ms ease'
    });

    // ── Inject animation keyframes ──
    const styleTag = document.createElement('style');
    styleTag.textContent = `
      @keyframes quicksnip-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes quicksnip-slide-up {
        from { opacity: 0; transform: translateY(12px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    overlay.appendChild(styleTag);

    // ── Card ──
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#FFFFFF',
      borderRadius: '16px',
      width: '380px',
      maxHeight: '440px',
      boxShadow: '0 16px 56px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      animation: 'quicksnip-slide-up 150ms ease',
      fontFamily: FONT
    });

    // ── Header ──
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '18px 20px 14px',
      borderBottom: '1px solid #E5E5EA',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: '0'
    });

    const titleWrap = document.createElement('div');

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: '16px',
      fontWeight: '600',
      color: '#1D1D1F',
      fontFamily: FONT
    });
    title.textContent = 'Selecionar aba';

    const subtitle = document.createElement('div');
    Object.assign(subtitle.style, {
      fontSize: '12px',
      color: '#6E6E73',
      marginTop: '3px',
      fontFamily: FONT
    });
    subtitle.textContent = `Variável: {{${varName}}}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      width: '28px',
      height: '28px',
      border: 'none',
      background: '#F5F5F7',
      borderRadius: '50%',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#6E6E73',
      fontSize: '16px',
      fontFamily: FONT,
      lineHeight: '1',
      transition: 'background 150ms ease'
    });
    closeBtn.innerHTML = '&#10005;';
    closeBtn.onmouseenter = () => { closeBtn.style.background = '#E8E8ED'; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = '#F5F5F7'; };
    closeBtn.onclick = () => {
      removePicker();
      onSelect(null);
    };

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // ── Search ──
    const searchWrap = document.createElement('div');
    Object.assign(searchWrap.style, {
      padding: '12px 20px 8px',
      flexShrink: '0'
    });

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Buscar aba...';
    Object.assign(searchInput.style, {
      width: '100%',
      padding: '10px 14px',
      fontSize: '13px',
      fontFamily: FONT,
      border: '1px solid #D2D2D7',
      borderRadius: '10px',
      outline: 'none',
      background: '#F5F5F7',
      color: '#1D1D1F',
      boxSizing: 'border-box',
      transition: 'border-color 150ms ease, box-shadow 150ms ease, background 150ms ease'
    });
    searchInput.onfocus = () => {
      searchInput.style.borderColor = '#0071E3';
      searchInput.style.boxShadow = '0 0 0 3px rgba(0,113,227,0.12)';
      searchInput.style.background = '#FFFFFF';
    };
    searchInput.onblur = () => {
      searchInput.style.borderColor = '#D2D2D7';
      searchInput.style.boxShadow = 'none';
      searchInput.style.background = '#F5F5F7';
    };

    searchWrap.appendChild(searchInput);

    // ── Tab list ──
    const listWrap = document.createElement('div');
    Object.assign(listWrap.style, {
      flex: '1',
      overflowY: 'auto',
      padding: '4px 20px 12px'
    });

    function renderList(filter = '') {
      listWrap.innerHTML = '';
      const query = filter.toLowerCase();
      const visible = tabs.filter(t => !query || t.title.toLowerCase().includes(query));

      if (visible.length === 0) {
        const empty = document.createElement('div');
        Object.assign(empty.style, {
          textAlign: 'center',
          padding: '24px',
          color: '#6E6E73',
          fontSize: '13px',
          fontFamily: FONT
        });
        empty.textContent = 'Nenhuma aba encontrada';
        listWrap.appendChild(empty);
        return;
      }

      visible.forEach(tab => {
        const item = document.createElement('div');
        Object.assign(item.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          borderRadius: '10px',
          cursor: 'pointer',
          transition: 'background 150ms ease',
          marginBottom: '4px',
          border: '1px solid transparent'
        });
        item.onmouseenter = () => {
          item.style.background = '#F5F5F7';
          item.style.borderColor = '#E5E5EA';
        };
        item.onmouseleave = () => {
          item.style.background = 'transparent';
          item.style.borderColor = 'transparent';
        };
        item.onclick = () => {
          removePicker();
          onSelect(tab.id);
        };

        // Favicon
        const favicon = document.createElement('img');
        favicon.src = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236E6E73" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="7" cy="6" r="0.5"/><circle cx="10" cy="6" r="0.5"/></svg>';
        favicon.onerror = () => {
          favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236E6E73" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
        };
        Object.assign(favicon.style, {
          width: '20px',
          height: '20px',
          borderRadius: '4px',
          flexShrink: '0',
          objectFit: 'contain'
        });

        // Title
        const titleEl = document.createElement('div');
        Object.assign(titleEl.style, {
          flex: '1',
          fontSize: '13px',
          fontWeight: '500',
          color: '#1D1D1F',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: FONT
        });
        titleEl.textContent = tab.title;

        // Arrow
        const arrow = document.createElement('div');
        Object.assign(arrow.style, {
          color: '#C7C7CC',
          fontSize: '14px',
          flexShrink: '0'
        });
        arrow.textContent = '›';

        item.appendChild(favicon);
        item.appendChild(titleEl);
        item.appendChild(arrow);
        listWrap.appendChild(item);
      });
    }

    searchInput.addEventListener('input', () => {
      renderList(searchInput.value.trim());
    });

    renderList();

    // ── Footer ──
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '12px 20px 16px',
      borderTop: '1px solid #E5E5EA',
      display: 'flex',
      justifyContent: 'flex-end',
      flexShrink: '0'
    });

    const cancelBtn = document.createElement('button');
    Object.assign(cancelBtn.style, {
      padding: '8px 18px',
      fontSize: '13px',
      fontWeight: '500',
      fontFamily: FONT,
      border: 'none',
      borderRadius: '8px',
      background: '#F5F5F7',
      color: '#1D1D1F',
      cursor: 'pointer',
      transition: 'background 150ms ease'
    });
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#E8E8ED'; };
    cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#F5F5F7'; };
    cancelBtn.onclick = () => {
      removePicker();
      onSelect(null);
    };

    footer.appendChild(cancelBtn);

    // ── Assemble ──
    card.appendChild(header);
    card.appendChild(searchWrap);
    card.appendChild(listWrap);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Focus search
    setTimeout(() => searchInput.focus(), 50);

    // Escape to close
    function handleEsc(e) {
      if (e.key === 'Escape') {
        removePicker();
        onSelect(null);
        document.removeEventListener('keydown', handleEsc, true);
      }
    }
    document.addEventListener('keydown', handleEsc, true);

    // Click overlay to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        removePicker();
        onSelect(null);
      }
    });
  }

})();
