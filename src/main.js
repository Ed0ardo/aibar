const { invoke } = window.__TAURI__.tauri;
const { appWindow } = window.__TAURI__.window;
const { open } = window.__TAURI__.shell;

let config = {};
let aiEngines = [];
let currentAi = 0; // Index of current Ai

// Function to update config and apply changes
function updateConfig(newConfig) {
  config = newConfig;
  console.log("Config updated:", config);

  // Apply theme to both document and body
  document.documentElement.setAttribute("data-theme", config.theme);
  document.body.setAttribute("data-theme", config.theme);

  // Update Ai engines
  if (config.aiEngines && config.aiEngines.length > 0) {
    aiEngines = config.aiEngines;
    currentAi = config.defaultAi || 0;
    updateCurrentAi();
  } else {
    aiEngines = [];
    currentAi = 0;
  }
}

// Update current Ai in the interface
function updateCurrentAi() {
  if (!aiEngines.length) return;

  const logo = document.getElementById("logo");
  const searchInput = document.getElementById("search-input");

  if (logo && aiEngines[currentAi]) {
    logo.src = aiEngines[currentAi].logo || "aibar_logo.png";
  }

  if (searchInput && aiEngines[currentAi]) {
    searchInput.placeholder = `Ask ${aiEngines[currentAi].name} anything...`;
  }
}

// Populate Ai dropdown
function populateAiDropdown() {
  const aiList = document.getElementById("ai-list");
  if (!aiList) return;

  aiList.innerHTML = "";

  aiEngines.forEach((ai, index) => {
    const aiItem = document.createElement("div");
    aiItem.className = `ai-item ${index === currentAi ? "selected" : ""}`;
    aiItem.innerHTML = `
      <img src="${ai.logo || "aibar_logo.png"}" alt="${ai.name}" />
      <span>${ai.name}</span>
    `;

    aiItem.addEventListener("click", () => {
      currentAi = index;
      updateCurrentAi();
      hideAiDropdown();
      updateAiDropdownSelection();
    });

    aiList.appendChild(aiItem);
  });
}

function updateAiDropdownSelection() {
  const aiItems = document.querySelectorAll(".ai-item");
  aiItems.forEach((item, index) => {
    item.classList.toggle("selected", index === currentAi);
  });
}

function showAiDropdown() {
  const dropdown = document.getElementById("ai-dropdown");
  if (dropdown) {
    populateAiDropdown();
    dropdown.classList.remove("hidden");
  }
}

function hideAiDropdown() {
  const dropdown = document.getElementById("ai-dropdown");
  if (dropdown) {
    dropdown.classList.add("hidden");
  }
}

// Make updateConfig available globally for Rust to call
window.updateConfig = updateConfig;

async function loadConfig() {
  try {
    config = await invoke("get_config");
    console.log("Config loaded:", config);
    updateConfig(config);

    // Populate settings if in settings window
    if (appWindow.label === "settings") {
      populateSettings();
    }
  } catch (error) {
    console.error("Failed to load config:", error);
  }
}

function populateSettings() {
  // Theme
  const themeRadio = document.querySelector(
    `input[name="theme"][value="${config.theme}"]`
  );
  if (themeRadio) themeRadio.checked = true;

  // Shortcut
  const shortcutInput = document.getElementById("shortcut-input");
  if (shortcutInput) shortcutInput.value = config.shortcut || "";

  // Autostart
  const autostartCheckbox = document.getElementById("autostart-checkbox");
  if (autostartCheckbox) autostartCheckbox.checked = config.autoStart || false;

  // Ai Engines
  populateAiEnginesList();
}

function populateAiEnginesList() {
  const aiEnginesList = document.getElementById("ai-engines-list");
  if (!aiEnginesList) return;

  aiEnginesList.innerHTML = "";

  aiEngines.forEach((ai, index) => {
    const aiItem = document.createElement("div");
    aiItem.className = "ai-engine-item";
    aiItem.draggable = true;
    aiItem.dataset.index = index;

    const isDefault = index === (config.defaultAi || 0);

    aiItem.innerHTML = `
      <div class="ai-engine-drag-handle" data-drag-handle="true">⋮⋮</div>
      <div class="ai-engine-info">
        <img src="${ai.logo || "aibar_logo.png"}" alt="${ai.name}" />
        <div class="ai-engine-details">
          <div class="ai-engine-name">${ai.name}</div>
          <div class="ai-engine-url">${ai.url}</div>
        </div>
      </div>
      <div class="ai-engine-actions">
        ${isDefault ? '<span class="default-badge">Default</span>' : ""}
        ${
          !isDefault
            ? `<button class="set-default-btn" onclick="setDefaultAi(${index})">Set Default</button>`
            : ""
        }
        <button class="delete-ai-btn" onclick="deleteAi(${index})">Delete</button>
      </div>
    `;

    // Add drag and drop event listeners
    aiItem.addEventListener("dragstart", handleDragStart);
    aiItem.addEventListener("dragover", handleDragOver);
    aiItem.addEventListener("dragenter", handleDragEnter);
    aiItem.addEventListener("dragleave", handleDragLeave);
    aiItem.addEventListener("drop", handleDrop);
    aiItem.addEventListener("dragend", handleDragEnd);

    // Only allow dragging when clicking on the drag handle
    const dragHandle = aiItem.querySelector(".ai-engine-drag-handle");
    if (dragHandle) {
      dragHandle.addEventListener("mousedown", (e) => {
        aiItem.draggable = true;
      });

      aiItem.addEventListener("mouseup", (e) => {
        if (!e.target.closest("[data-drag-handle]")) {
          aiItem.draggable = false;
        }
      });
    }

    aiEnginesList.appendChild(aiItem);
  });
}

let draggedElement = null;
let draggedIndex = -1;

function handleDragStart(e) {
  draggedElement = this;
  draggedIndex = parseInt(this.dataset.index);
  this.style.opacity = "0.4";
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", this.outerHTML);
}

function handleDragEnter(e) {
  this.classList.add("drag-over");
}

function handleDragLeave(e) {
  this.classList.remove("drag-over");
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }

  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  this.classList.remove("drag-over");

  if (draggedElement !== this) {
    const dropIndex = parseInt(this.dataset.index);

    if (draggedIndex !== dropIndex) {
      // Move the AI engine in the array
      const draggedAi = aiEngines[draggedIndex];
      aiEngines.splice(draggedIndex, 1);
      aiEngines.splice(dropIndex, 0, draggedAi);

      // Update default AI index if needed
      if (config.defaultAi === draggedIndex) {
        // The default AI was moved
        config.defaultAi = dropIndex;
      } else if (
        draggedIndex < config.defaultAi &&
        dropIndex >= config.defaultAi
      ) {
        // AI moved from before default to after default
        config.defaultAi--;
      } else if (
        draggedIndex > config.defaultAi &&
        dropIndex <= config.defaultAi
      ) {
        // AI moved from after default to before default
        config.defaultAi++;
      }

      // Update current AI index if needed
      if (currentAi === draggedIndex) {
        currentAi = dropIndex;
      } else if (draggedIndex < currentAi && dropIndex >= currentAi) {
        currentAi--;
      } else if (draggedIndex > currentAi && dropIndex <= currentAi) {
        currentAi++;
      }

      populateAiEnginesList();
    }
  }

  return false;
}

function handleDragEnd(e) {
  this.style.opacity = "";

  // Remove drag-over class from all items
  document.querySelectorAll(".ai-engine-item").forEach((item) => {
    item.classList.remove("drag-over");
    item.draggable = false; // Reset draggable state
  });

  draggedElement = null;
  draggedIndex = -1;
}

function setDefaultAi(index) {
  config.defaultAi = index;
  currentAi = index;
  populateAiEnginesList();
}

function deleteAi(index) {
  const aiName = aiEngines[index].name;
  showDeleteConfirmModal(aiName, () => {
    // This callback will be executed only if user confirms
    aiEngines.splice(index, 1);

    // Adjust defaultAi if necessary
    if (config.defaultAi >= index) {
      config.defaultAi = Math.max(0, config.defaultAi - 1);
    }
    currentAi = config.defaultAi;

    populateAiEnginesList();
  });
}

function showDeleteConfirmModal(aiName, onConfirm) {
  const modal = document.getElementById("delete-confirm-modal");
  const aiNameSpan = document.getElementById("delete-ai-name");
  const confirmBtn = document.getElementById("confirm-delete-btn");
  const cancelBtn = document.getElementById("cancel-delete-btn");

  if (!modal) {
    // Create modal if it doesn't exist
    createDeleteConfirmModal();
    return showDeleteConfirmModal(aiName, onConfirm);
  }

  if (aiNameSpan) {
    aiNameSpan.textContent = aiName;
  }

  // Remove any existing event listeners and add new ones
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);

  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newConfirmBtn.addEventListener("click", () => {
    onConfirm();
    hideDeleteConfirmModal();
  });

  newCancelBtn.addEventListener("click", () => {
    hideDeleteConfirmModal();
  });

  modal.classList.remove("hidden");
}

function hideDeleteConfirmModal() {
  const modal = document.getElementById("delete-confirm-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function createDeleteConfirmModal() {
  const modal = document.createElement("div");
  modal.id = "delete-confirm-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content delete-confirm-content">
      <div class="modal-header">
        <h3>Confirm Deletion</h3>
        <button class="close-modal" id="close-delete-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="delete-message">
          <div class="delete-icon">⚠️</div>
          <p class="delete-question">Are you sure you want to delete "<strong><span id="delete-ai-name"></span></strong>"?</p>
          <p class="delete-warning">This action cannot be undone.</p>
        </div>
      </div>
      <div class="modal-footer">
        <button id="cancel-delete-btn" class="cancel-button">Cancel</button>
        <button id="confirm-delete-btn" class="delete-button">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      hideDeleteConfirmModal();
    }
  });

  // Close modal with X button
  const closeBtn = modal.querySelector("#close-delete-modal");
  if (closeBtn) {
    closeBtn.addEventListener("click", hideDeleteConfirmModal);
  }
}

window.setDefaultAi = setDefaultAi;
window.deleteAi = deleteAi;

function initializeMainWindow() {
  const searchInput = document.getElementById("search-input");
  const logo = document.getElementById("logo");

  if (searchInput) {
    // Focus on input when window shows
    searchInput.focus();

    searchInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        const query = searchInput.value.trim();
        if (query && aiEngines[currentAi]) {
          const url = aiEngines[currentAi].url + encodeURIComponent(query);
          await open(url);
        }

        // Clear input and hide window
        searchInput.value = "";
        // Reset to default Ai
        currentAi = config.defaultAi || 0;
        updateCurrentAi();
        await appWindow.hide();
      }

      if (event.key === "Escape") {
        searchInput.value = "";
        // Reset to default Ai
        currentAi = config.defaultAi || 0;
        updateCurrentAi();
        hideAiDropdown(); // Close dropdown before hiding window
        await appWindow.hide();
      }
    });
  }

  // Logo click handler
  if (logo) {
    logo.addEventListener("click", (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById("ai-dropdown");
      if (dropdown.classList.contains("hidden")) {
        showAiDropdown();
      } else {
        hideAiDropdown();
      }
    });
  }

  // Click outside to close dropdown
  document.addEventListener("click", (e) => {
    const aiSelector = document.getElementById("ai-selector");
    if (!aiSelector.contains(e.target)) {
      hideAiDropdown();
    }
  });
}

function initializeSettingsWindow() {
  const saveButton = document.getElementById("save-button");
  const cancelButton = document.getElementById("cancel-button");
  const addAiButton = document.getElementById("add-ai-button");

  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      try {
        const shortcut = document.getElementById("shortcut-input").value.trim();
        const theme =
          document.querySelector('input[name="theme"]:checked')?.value ||
          "dark";
        const autoStart = document.getElementById("autostart-checkbox").checked;

        console.log("Saving config:", {
          shortcut,
          theme,
          autoStart,
          aiEngines,
          defaultAi: config.defaultAi || 0,
        });

        await invoke("save_config_command", {
          shortcut,
          theme,
          autoStart,
          aiEngines,
          defaultAi: config.defaultAi || 0,
        });

        console.log("Config saved successfully");
        await appWindow.hide();
      } catch (error) {
        console.error("Failed to save config:", error);
        alert("Failed to save settings: " + error);
      }
    });
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", async () => {
      // Reload config to revert any unsaved changes
      await loadConfig();
      await appWindow.hide();
    });
  }

  if (addAiButton) {
    addAiButton.addEventListener("click", () => {
      showAddAiModal();
    });
  }

  // Theme change preview
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const newTheme = e.target.value;
      document.documentElement.setAttribute("data-theme", newTheme);
      document.body.setAttribute("data-theme", newTheme);
    });
  });
}

function showAddAiModal() {
  const modal = document.getElementById("add-ai-modal");

  if (!modal) {
    // Create modal if it doesn't exist
    createAddAiModal();
    return showAddAiModal();
  }

  // Clear form
  document.getElementById("ai-name").value = "";
  document.getElementById("ai-url").value = "";
  document.getElementById("ai-logo").value = "";

  modal.classList.remove("hidden");
}

function hideAddAiModal() {
  const modal = document.getElementById("add-ai-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function createAddAiModal() {
  const modal = document.createElement("div");
  modal.id = "add-ai-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Add New AI Engine</h3>
        <button id="close-modal" class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="input-group">
          <label for="ai-name">AI Name</label>
          <input type="text" id="ai-name" placeholder="Custom AI Name" />
        </div>
        <div class="input-group">
          <label for="ai-url">Search URL</label>
          <input
            type="text"
            id="ai-url"
            placeholder="https://example.com/search?q="
          />
          <small>The search query will be appended to this URL</small>
        </div>
        <div class="input-group">
          <label for="ai-logo">Logo (optional)</label>
          <input type="file" id="ai-logo" accept="image/png" />
          <small>Upload a PNG. If not provided, a default logo will be used.</small>
        </div>
      </div>
      <div class="modal-footer">
        <button id="save-ai-button" class="save-button">Add AI</button>
        <button id="cancel-ai-button" class="cancel-button">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Initialize modal event listeners
  const closeModal = document.getElementById("close-modal");
  const cancelAiButton = document.getElementById("cancel-ai-button");
  const saveAiButton = document.getElementById("save-ai-button");

  if (closeModal) {
    closeModal.addEventListener("click", () => {
      hideAddAiModal();
    });
  }

  if (cancelAiButton) {
    cancelAiButton.addEventListener("click", () => {
      hideAddAiModal();
    });
  }

  if (saveAiButton) {
    saveAiButton.addEventListener("click", async () => {
      const name = document.getElementById("ai-name").value.trim();
      const url = document.getElementById("ai-url").value.trim();
      const logoFile = document.getElementById("ai-logo").files[0];

      if (!name || !url) {
        alert("Please fill in both name and URL fields.");
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        alert("Please enter a valid URL.");
        return;
      }

      let logoPath = "aibar_logo.png"; // Default logo

      // Handle logo file if provided
      if (logoFile) {
        try {
          // Convert file to base64 or handle file upload
          const reader = new FileReader();
          reader.onload = function (e) {
            logoPath = e.target.result; // This will be a data URL
            addNewAi(name, url, logoPath);
          };
          reader.readAsDataURL(logoFile);
        } catch (error) {
          console.error("Error reading logo file:", error);
          addNewAi(name, url, logoPath); // Use default logo
        }
      } else {
        addNewAi(name, url, logoPath);
      }
    });
  }

  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      hideAddAiModal();
    }
  });
}

function addNewAi(name, url, logo) {
  const newAi = {
    name: name,
    url: url,
    logo: logo,
  };

  aiEngines.push(newAi);
  populateAiEnginesList();
  hideAddAiModal();
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();

  // Show appropriate window content
  const searchWindow = document.getElementById("search-window");
  const settingsWindow = document.getElementById("settings-window");

  if (appWindow.label === "main") {
    if (searchWindow) {
      searchWindow.style.display = "block";
      searchWindow.classList.add("active");
    }
    if (settingsWindow) {
      settingsWindow.style.display = "none";
      settingsWindow.classList.remove("active");
    }
    initializeMainWindow();
  } else if (appWindow.label === "settings") {
    if (searchWindow) {
      searchWindow.style.display = "none";
      searchWindow.classList.remove("active");
    }
    if (settingsWindow) {
      settingsWindow.style.display = "block";
      settingsWindow.classList.add("active");
    }
    initializeSettingsWindow();
  }
});

// Handle window focus for main window
if (appWindow.label === "main") {
  appWindow.listen("tauri://focus", () => {
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      // Reset to default Ai when window opens
      currentAi = config.defaultAi || 0;
      updateCurrentAi();
      hideAiDropdown(); // Ensure dropdown is closed when window opens
      searchInput.focus();
      searchInput.select();
    }
  });

  // Handle window blur (when window loses focus)
  appWindow.listen("tauri://blur", () => {
    hideAiDropdown(); // Close dropdown when window loses focus
  });
}
