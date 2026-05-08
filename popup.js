// ─────────────────────────────────────────────
// QuickSnip — Popup Controller
// Manages snippets, variables, import/export
// ─────────────────────────────────────────────

(function () {
  'use strict';

  // ── State ──
  let snippets = [];
  let variables = [];

  // ── DOM References ──
  const $ = (id) => document.getElementById(id);
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  const snippetsList = $('snippets-list');
  const variablesList = $('variables-list');
  const emptySnippets = $('empty-snippets');
  const emptyVariables = $('empty-variables');
  const snippetCount = $('snippet-count');
  const searchInput = $('search-input');
  const searchBar = $('search-bar');

  // Snippet modal
  const snippetModal = $('snippet-modal');
  const snippetModalTitle = $('snippet-modal-title');
  const snippetEditId = $('snippet-edit-id');
  const snippetName = $('snippet-name');
  const snippetShortcut = $('snippet-shortcut');
  const snippetCategory = $('snippet-category');
  const snippetText = $('snippet-text');
  const categorySuggestions = $('category-suggestions');

  // Variable modal
  const variableModal = $('variable-modal');
  const variableModalTitle = $('variable-modal-title');
  const variableEditId = $('variable-edit-id');
  const variableName = $('variable-name');
  const variableUrl = $('variable-url');
  const variableSelector = $('variable-selector');

  const toast = $('toast');

  // ── Init ──
  loadData();

  // ── Tab Mode Detection ──
  const isTabMode = window.location.search.includes('tab=true');
  if (isTabMode) {
    document.documentElement.classList.add('tab-mode-html');
    document.body.classList.add('tab-mode');
    // Force override Chrome extension popup width constraints
    document.documentElement.style.cssText = 'width:100%!important;height:auto!important;';
    document.body.style.width = '100%';
  }

  // ── Open in Tab ──
  $('btn-open-tab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=true') });
    window.close();
  });

  // ── Tab Navigation ──
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      tabContents.forEach(tc => tc.classList.remove('active'));
      $(`tab-${target}`).classList.add('active');

      // Show/hide search bar (only for snippets tab)
      searchBar.style.display = target === 'snippets' ? 'block' : 'none';
    });
  });

  // ── Search ──
  searchInput.addEventListener('input', () => {
    renderSnippets(searchInput.value.trim().toLowerCase());
  });

  // ── Snippet CRUD ──
  $('btn-add-snippet').addEventListener('click', () => openSnippetModal());
  $('snippet-modal-close').addEventListener('click', () => closeSnippetModal());
  $('snippet-cancel').addEventListener('click', () => closeSnippetModal());
  $('snippet-save').addEventListener('click', saveSnippet);

  // Close modal on overlay click
  snippetModal.addEventListener('click', (e) => {
    if (e.target === snippetModal) closeSnippetModal();
  });

  function openSnippetModal(snippet = null) {
    if (snippet) {
      snippetModalTitle.textContent = 'Editar Snippet';
      snippetEditId.value = snippet.id;
      snippetName.value = snippet.name;
      snippetShortcut.value = snippet.shortcut;
      snippetCategory.value = snippet.category || '';
      snippetText.value = snippet.text;
    } else {
      snippetModalTitle.textContent = 'Novo Snippet';
      snippetEditId.value = '';
      snippetName.value = '';
      snippetShortcut.value = '';
      snippetCategory.value = '';
      snippetText.value = '';
    }
    updateCategorySuggestions();
    snippetModal.classList.add('active');
    snippetName.focus();
  }

  function closeSnippetModal() {
    snippetModal.classList.remove('active');
  }

  function saveSnippet() {
    const name = snippetName.value.trim();
    const shortcut = snippetShortcut.value.trim();
    const category = snippetCategory.value.trim() || 'Geral';
    const text = snippetText.value;

    if (!name || !shortcut || !text) {
      showToast('Preencha todos os campos obrigatórios');
      return;
    }

    // Check for duplicate shortcut
    const editId = snippetEditId.value;
    const duplicate = snippets.find(s => s.shortcut === shortcut && s.id !== editId);
    if (duplicate) {
      showToast('Este atalho já está em uso');
      return;
    }

    if (editId) {
      // Update existing
      const index = snippets.findIndex(s => s.id === editId);
      if (index !== -1) {
        snippets[index] = { ...snippets[index], name, shortcut, category, text };
      }
      showToast('Snippet atualizado');
    } else {
      // Create new
      snippets.push({
        id: generateId(),
        name,
        shortcut,
        category,
        text,
        createdAt: Date.now()
      });
      showToast('Snippet criado');
    }

    saveData();
    closeSnippetModal();
    renderSnippets();
  }

  function deleteSnippet(id) {
    snippets = snippets.filter(s => s.id !== id);
    saveData();
    renderSnippets();
    showToast('Snippet excluído');
  }

  // ── Variable CRUD ──
  $('btn-add-variable').addEventListener('click', () => openVariableModal());
  $('variable-modal-close').addEventListener('click', () => closeVariableModal());
  $('variable-cancel').addEventListener('click', () => closeVariableModal());
  $('variable-save').addEventListener('click', saveVariable);

  // Inspector button
  $('btn-inspect-element').addEventListener('click', async () => {
    // Save draft
    const draftVariable = {
      id: variableEditId.value,
      name: variableName.value,
      url: variableUrl.value
    };
    await chrome.storage.local.set({ draftVariable });

    // Inform background to inject inspector in active tab
    chrome.runtime.sendMessage({ type: 'START_INSPECTOR' });

    // Close the popup (or the tab if it's open in a tab)
    window.close();
  });

  variableModal.addEventListener('click', (e) => {
    if (e.target === variableModal) closeVariableModal();
  });

  function openVariableModal(variable = null) {
    const previewEl = $('variable-preview');
    if (previewEl) {
      previewEl.style.display = 'none';
      previewEl.textContent = '';
    }

    if (variable) {
      variableModalTitle.textContent = 'Editar Variável';
      variableEditId.value = variable.id;
      variableName.value = variable.name;
      variableUrl.value = variable.url;
      variableSelector.value = variable.selector;
    } else {
      variableModalTitle.textContent = 'Nova Variável';
      variableEditId.value = '';
      variableName.value = '';
      variableUrl.value = '';
      variableSelector.value = '';
    }
    variableModal.classList.add('active');
    variableName.focus();
  }

  function closeVariableModal() {
    variableModal.classList.remove('active');
  }

  function saveVariable() {
    const name = variableName.value.trim();
    const url = variableUrl.value.trim();
    const selector = variableSelector.value.trim();

    if (!name || !url || !selector) {
      showToast('Preencha todos os campos');
      return;
    }

    const editId = variableEditId.value;
    const duplicate = variables.find(v => v.name === name && v.id !== editId);
    if (duplicate) {
      showToast('Esta variável já existe');
      return;
    }

    if (editId) {
      const index = variables.findIndex(v => v.id === editId);
      if (index !== -1) {
        variables[index] = { ...variables[index], name, url, selector };
      }
      showToast('Variável atualizada');
    } else {
      variables.push({
        id: generateId(),
        name,
        url,
        selector,
        createdAt: Date.now()
      });
      showToast('Variável criada');
    }

    saveData();
    closeVariableModal();
    renderVariables();
  }

  function deleteVariable(id) {
    variables = variables.filter(v => v.id !== id);
    saveData();
    renderVariables();
    showToast('Variável excluída');
  }

  // ── Rendering ──
  function renderSnippets(filter = '') {
    let filtered = snippets;

    if (filter) {
      filtered = snippets.filter(s =>
        s.name.toLowerCase().includes(filter) ||
        s.shortcut.toLowerCase().includes(filter) ||
        (s.category && s.category.toLowerCase().includes(filter))
      );
    }

    // Group by category
    const groups = {};
    for (const s of filtered) {
      const cat = s.category || 'Geral';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }

    snippetsList.innerHTML = '';

    const sortedCategories = Object.keys(groups).sort();
    for (const cat of sortedCategories) {
      const group = document.createElement('div');
      group.className = 'category-group';

      const label = document.createElement('div');
      label.className = 'category-label';
      label.textContent = cat;
      group.appendChild(label);

      for (const s of groups[cat]) {
        group.appendChild(createSnippetCard(s));
      }

      snippetsList.appendChild(group);
    }

    // Update count and empty state
    snippetCount.textContent = `${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`;
    emptySnippets.style.display = filtered.length === 0 ? 'block' : 'none';
  }

  function createSnippetCard(s) {
    const card = document.createElement('div');
    card.className = 'snippet-card';

    const preview = s.text.replace(/\n/g, ' ').substring(0, 60);

    card.innerHTML = `
      <div class="snippet-card-header">
        <span class="snippet-name">${escapeHtml(s.name)}</span>
        <span class="snippet-shortcut">${escapeHtml(s.shortcut)}</span>
        <div class="snippet-actions">
          <button class="btn-icon edit-snippet" data-id="${s.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon danger delete-snippet" data-id="${s.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="snippet-preview">${escapeHtml(preview)}${s.text.length > 60 ? '…' : ''}</div>
    `;

    // Event delegation for edit/delete
    card.querySelector('.edit-snippet').addEventListener('click', (e) => {
      e.stopPropagation();
      openSnippetModal(s);
    });

    card.querySelector('.delete-snippet').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSnippet(s.id);
    });

    return card;
  }

  function renderVariables() {
    variablesList.innerHTML = '';

    for (const v of variables) {
      variablesList.appendChild(createVariableCard(v));
    }

    emptyVariables.style.display = variables.length === 0 ? 'block' : 'none';
  }

  function createVariableCard(v) {
    const card = document.createElement('div');
    card.className = 'variable-card';

    card.innerHTML = `
      <div class="variable-card-header">
        <span class="variable-name">{{${escapeHtml(v.name)}}}</span>
        <div class="variable-actions">
          <button class="btn-icon edit-variable" data-id="${v.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon danger delete-variable" data-id="${v.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="variable-meta">
        <span>URL: ${escapeHtml(v.url)}</span>
        <span>Seletor: ${escapeHtml(v.selector)}</span>
      </div>
    `;

    card.querySelector('.edit-variable').addEventListener('click', (e) => {
      e.stopPropagation();
      openVariableModal(v);
    });

    card.querySelector('.delete-variable').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteVariable(v.id);
    });

    return card;
  }

  // ── Category Suggestions ──
  function updateCategorySuggestions() {
    const cats = [...new Set(snippets.map(s => s.category).filter(Boolean))];
    categorySuggestions.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  // ── Export / Import ──
  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importData);

  function exportData() {
    const data = JSON.stringify({ snippets, variables }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `quicksnip-backup-${formatDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Backup exportado');
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        if (data.snippets && Array.isArray(data.snippets)) {
          snippets = data.snippets;
        }
        if (data.variables && Array.isArray(data.variables)) {
          variables = data.variables;
        }

        saveData();
        renderSnippets();
        renderVariables();
        showToast(`Importado: ${snippets.length} snippets, ${variables.length} variáveis`);
      } catch (err) {
        showToast('Erro ao importar arquivo');
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be re-imported
    e.target.value = '';
  }

  // ── Storage ──
  function loadData() {
    chrome.storage.local.get(['snippets', 'variables', 'draftVariable'], (data) => {
      snippets = data.snippets || [];
      variables = data.variables || [];
      renderSnippets();
      renderVariables();

      if (data.draftVariable) {
        // We have a pending variable from the inspector
        const draft = data.draftVariable;
        
        // Clear draft from storage
        chrome.storage.local.remove('draftVariable');

        // Open modal
        openVariableModal();
        
        // Restore fields
        variableEditId.value = draft.id || '';
        variableName.value = draft.name || '';
        variableUrl.value = draft.url || '';
        
        // Fill selector if captured
        if (draft.selector) {
          variableSelector.value = draft.selector;
        }

        // Show preview if captured
        const previewEl = $('variable-preview');
        if (draft.preview) {
          previewEl.textContent = 'Prévia: ' + draft.preview;
          previewEl.style.display = 'block';
        } else {
          previewEl.style.display = 'none';
          previewEl.textContent = '';
        }
      }
    });
  }

  function saveData() {
    chrome.storage.local.set({ snippets, variables });
  }

  // ── Helpers ──
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

})();
