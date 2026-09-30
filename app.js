/**
 * ==============================================================================
 * LICWEEKLY PLANNER - CONTROLADOR PRINCIPAL (app.js)
 * Arquitectura: Local-First / File-Driven con soporte de File System Access API,
 * IndexedDB, CRUD interactivo, motor de recordatorios (Web Notifications + Web Audio)
 * ==============================================================================
 */

/* --------------------------------------------------------------------------
   1. ESTADO GLOBAL DE LA APLICACIÓN
   -------------------------------------------------------------------------- */
let currentTasks = [];
let currentProfile = null;
let activeFileHandle = null;
let selectedModalTheme = 'lemon';
let currentFilterText = '';
let activeCategoryFilter = 'all';
let currentMobileDay = 'lunes';
let currentWeekOffset = 0;
let taskToDeleteId = null;
let currentWeeklyPlans = {};
let debounceSaveTimer = null;

// Registro de recordatorios disparados en la sesión para evitar duplicados
const firedReminders = new Set();


const DB_NAME = 'PlannerViewerDB';
const STORE_NAME = 'file_references';
const KEY_NAME = 'last_database_handle';
const LOCAL_STORAGE_KEY = 'planner_local_database';

function saveDataToLocalStorage(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('No se pudo guardar en localStorage:', err);
  }
}

function getDataFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('No se pudo leer de localStorage:', err);
    return null;
  }
}

const DAYS_OF_WEEK = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* --------------------------------------------------------------------------
   SISTEMA DE CÁLCULO DE FECHAS Y SEMANAS DEL CALENDARIO REAL
   -------------------------------------------------------------------------- */
function getActiveWeekDays(offset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 es Domingo, 1 es Lunes...
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + (offset * 7));
  monday.setHours(0, 0, 0, 0);

  return DAYS_OF_WEEK.map((dayName, idx) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + idx);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    return {
      dayName: dayName,
      dateObj: d,
      isoDate: `${year}-${month}-${dayNum}`,
      dayNumber: d.getDate(),
      formattedBadge: `${d.getDate()} ${MONTH_NAMES_ES[d.getMonth()]}`
    };
  });
}

function updateWeekUI() {
  const weekDays = getActiveWeekDays(currentWeekOffset);
  const firstDay = weekDays[0];
  const lastDay = weekDays[6];

  const weekLabelEl = document.getElementById('weekLabel');
  if (weekLabelEl) {
    if (currentWeekOffset === 0) {
      weekLabelEl.textContent = `Esta semana (${firstDay.dayNumber} ${MONTH_NAMES_ES[firstDay.dateObj.getMonth()]} - ${lastDay.dayNumber} ${MONTH_NAMES_ES[lastDay.dateObj.getMonth()]})`;
    } else {
      weekLabelEl.textContent = `Semana: ${firstDay.dayNumber} ${MONTH_NAMES_ES[firstDay.dateObj.getMonth()]} - ${lastDay.dayNumber} ${MONTH_NAMES_ES[lastDay.dateObj.getMonth()]}`;
    }
  }

  weekDays.forEach(d => {
    const dateEl = document.getElementById(`date-${d.dayName}`);
    if (dateEl) dateEl.textContent = d.formattedBadge;

    const tabNumEl = document.getElementById(`tabnum-${d.dayName}`);
    if (tabNumEl) tabNumEl.textContent = `${d.dayNumber}`;
  });
}

function getActiveWeekKey() {
  const weekDays = getActiveWeekDays(currentWeekOffset);
  return weekDays[0].isoDate;
}

function getCurrentWeekPlan() {
  const weekKey = getActiveWeekKey();
  if (!currentWeeklyPlans[weekKey]) {
    currentWeeklyPlans[weekKey] = {
      focus: '',
      notes: '',
      priorities: [],
      generalTasks: [],
      habits: []
    };
  }
  const plan = currentWeeklyPlans[weekKey];
  if (!Array.isArray(plan.priorities)) plan.priorities = [];
  if (!Array.isArray(plan.generalTasks)) plan.generalTasks = [];
  if (!Array.isArray(plan.habits)) plan.habits = [];
  if (typeof plan.focus !== 'string') plan.focus = '';
  if (typeof plan.notes !== 'string') plan.notes = '';
  return plan;
}

function triggerAutoSaveDebounced() {
  clearTimeout(debounceSaveTimer);
  debounceSaveTimer = setTimeout(async () => {
    await saveCurrentDataToFile();
  }, 600);
}


/* --------------------------------------------------------------------------
   2. SISTEMA DE AUDIO NATIVO (WEB AUDIO API - SINTETIZADOR DE TONOS SUAVES)
   -------------------------------------------------------------------------- */
function playReminderChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Primer tono (Nota Re5 / 587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Segundo tono armónico más agudo (Nota La5 / 880 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.12, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (e) {
    console.warn('No se pudo reproducir el tono de audio:', e);
  }
}

/* --------------------------------------------------------------------------
   3. AVISOS TOAST FLOTANTES EN PANTALLA
   -------------------------------------------------------------------------- */
function showToast(title, message, icon = '🔔', duration = 6000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-title">${icon} ${escapeHTML(title)}</span>
      <span class="toast-message">${escapeHTML(message)}</span>
    </div>
    <button class="btn-close-toast" aria-label="Cerrar aviso">✕</button>
  `;

  const closeBtn = toast.querySelector('.btn-close-toast');
  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  };

  closeBtn.addEventListener('click', removeToast);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
}

/* --------------------------------------------------------------------------
   4. INDEXEDDB NATIVO (PERSISTENCIA DEL PUNTERO AL ARCHIVO)
   -------------------------------------------------------------------------- */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFileHandleToIndexedDB(handle) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, KEY_NAME);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error al guardar el fileHandle en IndexedDB:', err);
  }
}

async function getFileHandleFromIndexedDB() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(KEY_NAME);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('No se pudo recuperar fileHandle de IndexedDB:', err);
    return null;
  }
}

/* --------------------------------------------------------------------------
   5. LECTURA, PERSISTENCIA Y AUTO-GUARDADO (FILE SYSTEM ACCESS API + LOCALSTORAGE)
   -------------------------------------------------------------------------- */
async function openAndReadFile() {
  if (!('showOpenFilePicker' in window)) {
    // Fallback para navegadores sin File System Access API (iPhone Safari, Firefox, Android)
    const fileInput = document.getElementById('fallbackFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'Archivos de Agenda Semanal (.json)',
        accept: { 'application/json': ['.json'] }
      }],
      multiple: false
    });

    activeFileHandle = handle;
    await saveFileHandleToIndexedDB(handle);
    await readFromHandle(handle);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      showToast('Error', 'No se pudo acceder al archivo seleccionado.', '⚠️');
    }
  }
}

function loadDataIntoState(parsed) {
  if (Array.isArray(parsed)) {
    currentTasks = parsed;
    currentProfile = null;
    currentWeeklyPlans = {};
  } else if (parsed && typeof parsed === 'object') {
    currentTasks = parsed.tasks || [];
    currentProfile = parsed.profile || null;
    currentWeeklyPlans = parsed.weeklyPlans || {};
  }

  if (currentProfile && currentProfile.theme) {
    setAppTheme(currentProfile.theme);
    const themeSelect = document.getElementById('quickThemeSelector');
    if (themeSelect) themeSelect.value = currentProfile.theme;
  } else {
    setAppTheme(document.documentElement.getAttribute('data-theme') || 'lemon');
  }

  renderPersonalizedHeader(currentProfile);
  updateWeekUI();
  renderWeeklyGrid();
  renderLeftPlannerPage();
  updateProgressBar();
}

async function readFromHandle(handle) {
  try {
    const file = await handle.getFile();
    const content = await file.text();
    const parsed = JSON.parse(content);

    loadDataIntoState(parsed);
    saveDataToLocalStorage({
      profile: currentProfile,
      tasks: currentTasks,
      weeklyPlans: currentWeeklyPlans
    });
    updateStatusConnected(handle.name);
    showToast('Agenda conectada', `Archivo sincronizado: ${handle.name}`, '📂', 3500);
  } catch (err) {
    console.error('Error al parsear archivo:', err);
    showToast('Archivo Inválido', 'El archivo no contiene un formato JSON válido.', '⚠️');
  }
}

// Auto-guardado de cambios hacia el archivo en disco o localStorage
async function saveCurrentDataToFile() {
  const data = {
    profile: currentProfile || {
      name: 'Usuario',
      birthdate: '',
      theme: document.documentElement.getAttribute('data-theme') || 'lemon',
      updatedAt: new Date().toISOString()
    },
    tasks: currentTasks,
    weeklyPlans: currentWeeklyPlans
  };

  // Guardado persistente inmediato en el almacenamiento local del navegador (ideal para iPhone/Safari)
  saveDataToLocalStorage(data);

  if (!activeFileHandle) {
    // Si no hay archivo vinculado en disco, actualizamos la UI y el estado de guardado local
    renderWeeklyGrid();
    renderLeftPlannerPage();
    updateProgressBar();
    updateStatusLocal('Almacenamiento Local');
    return;
  }

  try {
    // Comprobar y solicitar permiso de escritura
    const permission = await activeFileHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      showToast('Permiso Requerido', 'No se otorgó permiso de escritura para guardar los cambios.', '⚠️');
      return;
    }

    const writable = await activeFileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();

    renderWeeklyGrid();
    renderLeftPlannerPage();
    updateProgressBar();
    updateStatusConnected(activeFileHandle.name);
  } catch (err) {
    console.error('Error al guardar en el archivo:', err);
    showToast('Error al Guardar', 'No se pudieron escribir los cambios en el disco.', '⚠️');
  }
}

// Creación de nueva agenda en disco o almacenamiento local
async function handleCreateNewDatabase(name, birthdate, theme) {
  if (!('showSaveFilePicker' in window)) {
    // Modo de creación en memoria + persistencia local para iOS / Safari / navegadores móviles
    currentProfile = {
      name: name,
      birthdate: birthdate,
      theme: theme,
      createdAt: new Date().toISOString()
    };
    currentTasks = [
      {
        id: generateUniqueId(),
        title: "¡Bienvenido a tu agenda semanal!",
        description: "Haz clic en el checkbox para completarla o en el lápiz para editar.",
        day: "lunes",
        startTime: "09:00",
        endTime: "10:00",
        category: "personal",
        priority: "alta",
        reminderMinutes: 10,
        completed: false
      }
    ];
    currentWeeklyPlans = {};
    setAppTheme(theme);
    renderPersonalizedHeader(currentProfile);
    renderWeeklyGrid();
    renderLeftPlannerPage();
    updateProgressBar();
    closeDbModal();

    saveDataToLocalStorage({
      profile: currentProfile,
      tasks: currentTasks,
      weeklyPlans: currentWeeklyPlans
    });
    updateStatusLocal('Nuevo archivo local');
    downloadJsonBackup();
    showToast('Agenda Creada', 'Guardada en tu navegador y copia JSON descargada.', '✨', 4500);
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `agenda_${name.toLowerCase().replace(/\s+/g, '_')}.json`,
      types: [{
        description: 'Archivo de Agenda JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const initialData = {
      profile: {
        name: name,
        birthdate: birthdate,
        theme: theme,
        createdAt: new Date().toISOString()
      },
      tasks: [
        {
          id: generateUniqueId(),
          title: "¡Bienvenido a tu agenda semanal!",
          description: "Puedes editar o borrar esta tarea y agregar las tuyas con el botón +",
          day: "lunes",
          startTime: "09:00",
          endTime: "10:00",
          category: "personal",
          priority: "alta",
          reminderMinutes: 10,
          completed: false
        }
      ],
      weeklyPlans: {}
    };

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(initialData, null, 2));
    await writable.close();

    activeFileHandle = handle;
    await saveFileHandleToIndexedDB(handle);
    await readFromHandle(handle);
    closeDbModal();
    showToast('Agenda Creada', `Archivo guardado exitosamente: ${handle.name}`, '🎉');
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      showToast('Error', 'No se pudo guardar el nuevo archivo.', '⚠️');
    }
  }
}

// Comprobación de sesión previa al iniciar la app
async function checkPersistedFile() {
  const handle = await getFileHandleFromIndexedDB();
  if (handle) {
    activeFileHandle = handle;
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const btnReconnect = document.getElementById('btnReconnect');
    const btnDownloadBackup = document.getElementById('btnDownloadBackup');

    if (statusDot) statusDot.className = 'status-dot pending';
    if (statusText) {
      statusText.textContent = 'Requiere autorización';
      statusText.title = `Archivo previo detectado: ${handle.name}`;
    }
    if (btnReconnect) btnReconnect.style.display = 'inline-flex';
    if (btnDownloadBackup) btnDownloadBackup.style.display = 'inline-flex';

    btnReconnect.onclick = async () => {
      try {
        const status = await handle.requestPermission({ mode: 'readwrite' });
        if (status === 'granted') {
          await readFromHandle(handle);
        } else {
          showToast('Aviso', 'Permiso de lectura denegado.', '⚠️');
        }
      } catch (err) {
        console.error(err);
        showToast('Error', 'No se pudo verificar el permiso para leer el archivo.', '⚠️');
      }
    };
    return;
  }

  // Fallback para iPhone / Safari / Navegadores sin File System Access API
  const localData = getDataFromLocalStorage();
  if (localData && (localData.tasks?.length > 0 || localData.profile || Object.keys(localData.weeklyPlans || {}).length > 0)) {
    loadDataIntoState(localData);
    updateStatusLocal('Almacenamiento Local');
  }
}

function updateStatusConnected(fileName) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnReconnect = document.getElementById('btnReconnect');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDownloadBackup = document.getElementById('btnDownloadBackup');

  if (statusDot) {
    statusDot.className = 'status-dot connected';
  }
  if (statusText) {
    statusText.textContent = 'Conectado';
    statusText.title = `Archivo vinculado: ${fileName}`;
  }
  if (btnReconnect) btnReconnect.style.display = 'none';
  if (btnRefresh) btnRefresh.style.display = 'inline-flex';
  if (btnDownloadBackup) btnDownloadBackup.style.display = 'inline-flex';
}

function updateStatusLocal(origin = 'Navegador') {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnReconnect = document.getElementById('btnReconnect');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDownloadBackup = document.getElementById('btnDownloadBackup');

  if (statusDot) {
    statusDot.className = 'status-dot local';
  }
  if (statusText) {
    statusText.textContent = 'Guardado en dispositivo';
    statusText.title = `Datos guardados en la memoria de este navegador (${origin}).`;
  }
  if (btnReconnect) btnReconnect.style.display = 'none';
  if (btnRefresh) btnRefresh.style.display = 'none';
  if (btnDownloadBackup) btnDownloadBackup.style.display = 'inline-flex';
}

// Descargar copia JSON de respaldo
function downloadJsonBackup() {
  const data = {
    profile: currentProfile || {
      name: 'Usuario',
      birthdate: '',
      theme: document.documentElement.getAttribute('data-theme') || 'lemon',
      exportedAt: new Date().toISOString()
    },
    tasks: currentTasks,
    weeklyPlans: currentWeeklyPlans
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agenda_${(currentProfile?.name || 'semanal').toLowerCase().replace(/\s+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Copia Descargada', 'Se ha guardado un archivo JSON en tus descargas.', '💾');
}

/* --------------------------------------------------------------------------
   6. CRUD INTERACTIVO DE TAREAS
   -------------------------------------------------------------------------- */
function generateUniqueId() {
  return 'task_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

const CATEGORY_NAMES = {
  trabajo: 'Trabajo',
  estudio: 'Estudio',
  personal: 'Personal',
  salud: 'Salud'
};

const CATEGORY_ICONS = {
  trabajo: `<svg class="category-svg-icon cat-trabajo" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  estudio: `<svg class="category-svg-icon cat-estudio" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  personal: `<svg class="category-svg-icon cat-personal" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  salud: `<svg class="category-svg-icon cat-salud" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
};

function updateTaskCategoryDropdownUI(categoryName) {
  const valid = (categoryName && CATEGORY_NAMES[categoryName.toLowerCase()]) ? categoryName.toLowerCase() : 'trabajo';
  const name = CATEGORY_NAMES[valid];
  const iconSvg = CATEGORY_ICONS[valid];

  const currentIcon = document.getElementById('categoryCurrentIcon');
  if (currentIcon) currentIcon.innerHTML = iconSvg;

  const currentLabel = document.getElementById('categoryCurrentLabel');
  if (currentLabel) currentLabel.textContent = name;

  const hiddenSelect = document.getElementById('taskFormCategory');
  if (hiddenSelect && hiddenSelect.value !== valid) {
    hiddenSelect.value = valid;
  }

  const items = document.querySelectorAll('.category-dropdown-item');
  items.forEach(item => {
    const isSelected = item.dataset.category === valid;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

function setTaskFormCategory(categoryName) {
  updateTaskCategoryDropdownUI(categoryName);
}

function openTaskModalForNew(day = null) {
  const form = document.getElementById('taskForm');
  form.reset();
  document.getElementById('taskFormId').value = '';
  document.getElementById('modalTaskTitle').textContent = 'Nueva Tarea';
  document.getElementById('btnSubmitTask').textContent = 'Guardar Tarea';

  if (day && DAYS_OF_WEEK.includes(day)) {
    document.getElementById('taskFormDay').value = day;
  } else {
    document.getElementById('taskFormDay').value = currentMobileDay || 'lunes';
  }

  document.getElementById('taskFormReminder').value = '10';
  document.getElementById('taskFormPriority').value = 'media';
  setTaskFormCategory('trabajo');

  document.getElementById('taskModal').classList.add('open');
  document.getElementById('taskFormTitle').focus();
}

function openTaskModalForEdit(taskId) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('taskFormId').value = task.id;
  document.getElementById('taskFormTitle').value = task.title || '';
  document.getElementById('taskFormDescription').value = task.description || '';
  document.getElementById('taskFormDay').value = task.day || 'lunes';
  document.getElementById('taskFormStartTime').value = task.startTime || '';
  document.getElementById('taskFormEndTime').value = task.endTime || '';
  setTaskFormCategory(task.category || 'personal');
  document.getElementById('taskFormPriority').value = task.priority || 'media';
  document.getElementById('taskFormReminder').value = (task.reminderMinutes !== undefined) ? task.reminderMinutes.toString() : '10';

  document.getElementById('modalTaskTitle').textContent = 'Editar Tarea';
  document.getElementById('btnSubmitTask').textContent = 'Actualizar Tarea';

  document.getElementById('taskModal').classList.add('open');
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('open');
  const categoryDropdown = document.getElementById('categoryDropdown');
  if (categoryDropdown) {
    categoryDropdown.classList.remove('open');
    const trigger = document.getElementById('categoryDropdownTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  document.getElementById('taskForm').reset();
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('taskFormId').value;
  const title = document.getElementById('taskFormTitle').value.trim();
  const description = document.getElementById('taskFormDescription').value.trim();
  const day = document.getElementById('taskFormDay').value;
  const startTime = document.getElementById('taskFormStartTime').value;
  const endTime = document.getElementById('taskFormEndTime').value;
  const category = document.getElementById('taskFormCategory').value;
  const priority = document.getElementById('taskFormPriority').value;
  const reminderMinutes = parseInt(document.getElementById('taskFormReminder').value, 10);

  if (!title) return;

  if (id) {
    // Actualizar tarea existente
    const index = currentTasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const activeWeekDays = getActiveWeekDays(currentWeekOffset);
      const targetDayInfo = activeWeekDays.find(d => d.dayName === day);

      currentTasks[index] = {
        ...currentTasks[index],
        title,
        description,
        day,
        date: targetDayInfo ? targetDayInfo.isoDate : (currentTasks[index].date || ''),
        startTime,
        endTime,
        category,
        priority,
        reminderMinutes
      };
      showToast('Tarea Actualizada', `"${title}" ha sido actualizada.`, '✏️', 3000);
    }
  } else {
    // Crear nueva tarea asignada al día y fecha de la semana activa
    const activeWeekDays = getActiveWeekDays(currentWeekOffset);
    const targetDayInfo = activeWeekDays.find(d => d.dayName === day);

    const newTask = {
      id: generateUniqueId(),
      title,
      description,
      day,
      date: targetDayInfo ? targetDayInfo.isoDate : '',
      startTime,
      endTime,
      category,
      priority,
      reminderMinutes,
      completed: false
    };
    currentTasks.push(newTask);
    showToast('Tarea Creada', `"${title}" agregada a ${day}.`, '✅', 3000);
  }

  closeTaskModal();
  await saveCurrentDataToFile();
}

async function toggleTaskCompleted(taskId) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;

  task.completed = !task.completed;
  if (task.completed) {
    playReminderChime();
    showToast('Tarea Completada', `¡Buen trabajo! Has completado "${task.title}".`, '🎉', 3000);
  }

  await saveCurrentDataToFile();
}

function promptDeleteTask(taskId) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;

  taskToDeleteId = taskId;
  document.getElementById('deleteConfirmMessage').textContent = 
    `¿Estás seguro de que deseas eliminar la tarea "${task.title}"? Esta acción se guardará en tu archivo.`;
  document.getElementById('deleteConfirmModal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteConfirmModal').classList.remove('open');
  taskToDeleteId = null;
}

async function confirmDeleteTask() {
  if (!taskToDeleteId) return;

  const taskIndex = currentTasks.findIndex(t => t.id === taskToDeleteId);
  if (taskIndex !== -1) {
    const deleted = currentTasks.splice(taskIndex, 1)[0];
    showToast('Tarea Eliminada', `"${deleted.title}" fue eliminada.`, '🗑️', 3000);
    closeDeleteModal();
    await saveCurrentDataToFile();
  }
}

/* --------------------------------------------------------------------------
   7. MOTOR DE RECORDATORIOS Y NOTIFICACIONES
   -------------------------------------------------------------------------- */
async function setupNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('No Compatible', 'Este navegador no soporta notificaciones de escritorio. Se usarán avisos en pantalla.', 'ℹ️');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    updateNotificationButtonState();

    if (permission === 'granted') {
      playReminderChime();
      showToast('Recordatorios Activos', 'Las notificaciones del sistema están habilitadas.', '🔔');
      new Notification('🔔 Recordatorios Activados', {
        body: 'LICWeekly Planner te avisará antes del inicio de tus actividades programadas.'
      });
    } else {
      showToast('Aviso', 'Notificaciones bloqueadas por el usuario. Se mostrarán avisos en pantalla.', '⚠️');
    }
  } catch (err) {
    console.error('Error al pedir permiso de notificaciones:', err);
  }
}

const SVG_BELL = `<svg class="btn-icon-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const SVG_BELL_OFF = `<svg class="btn-icon-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function updateNotificationButtonState() {
  const btn = document.getElementById('btnToggleNotifications');
  const icon = document.getElementById('notifIcon');
  const text = document.getElementById('notifText');
  if (!btn || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    btn.classList.add('active');
    icon.innerHTML = SVG_BELL;
    text.textContent = 'Recordatorios ON';
  } else {
    btn.classList.remove('active');
    icon.innerHTML = SVG_BELL_OFF;
    text.textContent = 'Activar Avisos';
  }
}

// Verificación periódica de recordatorios próximos
function checkReminders() {
  const now = new Date();
  const currentDayIndex = now.getDay(); // 0 es Domingo
  // Mapeo a nuestro formato de días en español
  const daysMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const todayName = daysMap[currentDayIndex];
  const todayDateStr = now.toISOString().split('T')[0];

  const currentMinutesSinceMidnight = now.getHours() * 60 + now.getMinutes();

  currentTasks.forEach(task => {
    // Si la tarea está completada, no tiene hora de inicio o no tiene recordatorio, saltar
    if (task.completed || !task.startTime || !task.reminderMinutes || task.reminderMinutes <= 0) {
      return;
    }

    // Verificar si la tarea corresponde al día de hoy
    if ((task.day || '').toLowerCase() !== todayName) {
      return;
    }

    // Parsear startTime "HH:MM"
    const [startH, startM] = task.startTime.split(':').map(Number);
    if (isNaN(startH) || isNaN(startM)) return;

    const taskMinutesSinceMidnight = startH * 60 + startM;
    const alertMinutesSinceMidnight = taskMinutesSinceMidnight - task.reminderMinutes;

    // Llave única para registrar que ya se alertó hoy
    const reminderKey = `${task.id}_${todayDateStr}_${task.reminderMinutes}`;

    // Disparar si estamos en el minuto exacto (o hasta 1 minuto después) y no ha sonado hoy
    if (
      currentMinutesSinceMidnight >= alertMinutesSinceMidnight &&
      currentMinutesSinceMidnight <= alertMinutesSinceMidnight + 1 &&
      !firedReminders.has(reminderKey)
    ) {
      firedReminders.add(reminderKey);

      // 1. Reproducir sonido suave
      playReminderChime();

      // 2. Notificación en pantalla (Toast flotante)
      showToast(
        `Recordatorio: ${task.title}`,
        `Comienza en ${task.reminderMinutes} min (${task.startTime}). ${task.description || ''}`,
        '⏰',
        10000
      );

      // 3. Notificación nativa del sistema operativo
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`⏰ ${task.title}`, {
            body: `Tu actividad comienza a las ${task.startTime} (en ${task.reminderMinutes} minutos).\n${task.description || ''}`,
            tag: task.id
          });
        } catch (e) {
          console.warn('Error al disparar la notificación nativa:', e);
        }
      }
    }
  });
}

/* --------------------------------------------------------------------------
   8. RENDERIZADO VISUAL, PROGRESO, SEMANAS Y FILTROS
   -------------------------------------------------------------------------- */
function renderWeeklyGrid() {
  const activeWeekDays = getActiveWeekDays(currentWeekOffset);

  // Filtrado compuesto: Búsqueda de texto + Categoría
  const filtered = currentTasks.filter(t => {
    // 1. Filtro de búsqueda
    let matchesText = true;
    if (currentFilterText) {
      const q = currentFilterText.toLowerCase();
      matchesText = (t.title && t.title.toLowerCase().includes(q)) ||
                    (t.description && t.description.toLowerCase().includes(q)) ||
                    (t.category && t.category.toLowerCase().includes(q));
    }

    // 2. Filtro de categoría / completadas
    let matchesCategory = true;
    if (activeCategoryFilter === 'completed') {
      matchesCategory = !!t.completed;
    } else if (activeCategoryFilter !== 'all') {
      matchesCategory = (t.category || '').toLowerCase() === activeCategoryFilter.toLowerCase();
    }

    return matchesText && matchesCategory;
  });

  activeWeekDays.forEach(dayInfo => {
    const container = document.getElementById(`list-${dayInfo.dayName}`);
    const countEl = document.getElementById(`count-${dayInfo.dayName}`);
    if (!container || !countEl) return;

    container.innerHTML = '';

    // Filtrar tareas que correspondan a este día en la semana activa
    const dayTasks = filtered.filter(t => {
      if (t.date) {
        return t.date === dayInfo.isoDate;
      }
      return (t.day || '').toLowerCase() === dayInfo.dayName;
    });

    // Ordenar cronológicamente por hora de inicio
    dayTasks.sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));

    countEl.textContent = `${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}`;

    if (dayTasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>Sin actividades</span>
        </div>
      `;
      return;
    }

    dayTasks.forEach(task => {
      const card = document.createElement('div');
      card.className = `task-card ${task.completed ? 'completed' : ''}`;
      card.dataset.id = task.id;
      card.draggable = true;

      const hasTime = !!task.startTime;
      const hasReminder = task.reminderMinutes > 0;
      const showTimeRow = hasTime || hasReminder;

      card.innerHTML = `
        <div class="task-card-main">
          <div class="task-checkbox-wrap">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} 
                   title="${task.completed ? 'Marcar como pendiente' : 'Marcar como completada'}" 
                   aria-label="Completar tarea">
          </div>
          <div class="task-card-content">
            <span class="task-title">${escapeHTML(task.title)}</span>
            ${task.description ? `<p class="task-description">${escapeHTML(task.description)}</p>` : ''}
          </div>
        </div>

        ${showTimeRow ? `
          <div class="task-time-row">
            ${hasTime ? `
              <span class="task-time">
                <span class="task-time-icon" aria-hidden="true">
                  <svg class="card-icon-svg icon-clock" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"/>
                    <polyline points="12 7 12 12 15 15"/>
                  </svg>
                </span>
                <span>${task.startTime}${task.endTime ? ' - ' + task.endTime : ''}</span>
              </span>
            ` : '<span></span>'}
            ${hasReminder ? `
              <span class="reminder-badge" title="Recordatorio ${task.reminderMinutes} min antes">
                <svg class="reminder-icon-svg" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span>${task.reminderMinutes}m</span>
              </span>
            ` : ''}
          </div>
        ` : ''}

        <div class="task-footer-row">
          <div class="task-badge badge-${task.category || 'personal'}">
            <span class="priority-indicator priority-${task.priority || 'media'}" title="Prioridad ${task.priority || 'media'}"></span>
            <span>${task.category || 'personal'}</span>
          </div>
          <div class="task-actions">
            <button class="btn-card-action edit" title="Editar tarea" aria-label="Editar tarea">
              <svg class="card-action-svg icon-edit" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-card-action delete" title="Eliminar tarea" aria-label="Eliminar tarea">
              <svg class="card-action-svg icon-delete" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Eventos Drag & Drop en la tarjeta
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      // Eventos interactivos directos en la tarjeta
      const checkbox = card.querySelector('.task-checkbox');
      checkbox.addEventListener('change', () => toggleTaskCompleted(task.id));

      const editBtn = card.querySelector('.btn-card-action.edit');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTaskModalForEdit(task.id);
      });

      const deleteBtn = card.querySelector('.btn-card-action.delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptDeleteTask(task.id);
      });

      container.appendChild(card);
    });
  });
}

function updateProgressBar() {
  const total = currentTasks.length;
  const completed = currentTasks.filter(t => t.completed).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const fillEl = document.getElementById('progressBarFill');
  const textEl = document.getElementById('progressSummaryText');

  if (fillEl) fillEl.style.width = `${percent}%`;
  if (textEl) textEl.textContent = `${completed} de ${total} tareas completadas (${percent}%)`;
}

function renderPersonalizedHeader(profile) {
  const greetingEl = document.getElementById('userGreeting');
  const subtitleEl = document.getElementById('userSubtitle');
  const bdayBanner = document.getElementById('birthdayBanner');

  if (!profile || !profile.name) {
    greetingEl.textContent = '¡Hola! Bienvenido a LICWeekly Planner';
    subtitleEl.textContent = 'Crea una agenda o conecta tu archivo local para organizar tu semana.';
    bdayBanner.style.display = 'none';
    return;
  }

  // 1. Aplicar tema guardado en perfil
  if (profile.theme) {
    setAppTheme(profile.theme);
    const selector = document.getElementById('quickThemeSelector');
    if (selector) selector.value = profile.theme;
  }

  // 2. Comprobar cumpleaños
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  let isBirthday = false;
  if (profile.birthdate) {
    const parts = profile.birthdate.split('-');
    if (parts.length >= 3) {
      const birthMonth = parseInt(parts[1], 10);
      const birthDay = parseInt(parts[2], 10);
      if (birthMonth === currentMonth && birthDay === currentDay) {
        isBirthday = true;
      }
    }
  }

  if (isBirthday) {
    bdayBanner.style.display = 'block';
    greetingEl.textContent = `🎂 ¡Feliz Cumpleaños, ${profile.name}!`;
    subtitleEl.textContent = 'Que tengas una semana extraordinaria llena de metas cumplidas.';
  } else {
    bdayBanner.style.display = 'none';
    const hour = today.getHours();
    let prefix = 'Buenos días';
    if (hour >= 12 && hour < 20) prefix = 'Buenas tardes';
    else if (hour >= 20 || hour < 5) prefix = 'Buenas noches';
    
    greetingEl.textContent = `${prefix}, ${profile.name} 👋`;
    subtitleEl.textContent = 'Aquí está el resumen actualizado de tus actividades de la semana.';
  }
}

const THEME_NAMES = {
  nordic: 'Nordic Blue',
  forest: 'Forest & Moss',
  sunset: 'Sunset Coral',
  lavender: 'Lavender Mist',
  midnight: 'Midnight Dark',
  lemon: 'Lemon Ice-Cream'
};

const THEME_ICONS = {
  nordic: `<svg class="theme-svg-icon icon-nordic" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="2" x2="12" y2="22"/><line x1="20" y1="12" x2="4" y2="12"/><line x1="17.65" y1="6.35" x2="6.35" y2="17.65"/><line x1="17.65" y1="17.65" x2="6.35" y2="6.35"/></svg>`,
  forest: `<svg class="theme-svg-icon icon-forest" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2L4 12h5l-4 7h14l-4-7h5L12 2z"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  sunset: `<svg class="theme-svg-icon icon-sunset" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4z"/><line x1="12" y1="4" x2="12" y2="7"/><line x1="4.93" y1="7.93" x2="7.05" y2="10.05"/><line x1="19.07" y1="7.93" x2="16.95" y2="10.05"/><line x1="2" y1="18" x2="22" y2="18"/><line x1="4" y1="21" x2="20" y2="21"/></svg>`,
  lavender: `<svg class="theme-svg-icon icon-lavender" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c-1.5 2-1.5 5 0 7 1.5-2 1.5-5 0-7z"/><path d="M8 8c-2 1.5-2 4.5 0 6 2-1.5 2-4.5 0-6z"/><path d="M16 8c-2 1.5-2 4.5 0 6 2-1.5 2-4.5 0-6z"/><line x1="12" y1="14" x2="12" y2="22"/><path d="M12 18c-2-1-4 0-5 2"/></svg>`,
  midnight: `<svg class="theme-svg-icon icon-midnight" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  lemon: `<svg class="theme-svg-icon icon-lemon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 11 4.08 10.35a1 1 0 0 0 1.84 0L17 11"/><path d="M17 11A5 5 0 0 0 7 11"/><path d="M12 6c.5-1.5 2-2.5 3.5-2.5 0 1.5-1 3-2.5 3.5"/></svg>`
};

function updateThemeDropdownUI(themeName) {
  const name = THEME_NAMES[themeName] || 'Lemon Ice-Cream';
  const iconSvg = THEME_ICONS[themeName] || THEME_ICONS.lemon;

  const currentIcon = document.getElementById('themeCurrentIcon');
  if (currentIcon) currentIcon.innerHTML = iconSvg;

  const currentLabel = document.getElementById('themeCurrentLabel');
  if (currentLabel) currentLabel.textContent = name;

  const quickSelect = document.getElementById('quickThemeSelector');
  if (quickSelect && quickSelect.value !== themeName) {
    quickSelect.value = themeName;
  }

  const items = document.querySelectorAll('.theme-dropdown-item');
  items.forEach(item => {
    const isSelected = item.dataset.theme === themeName;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

function setAppTheme(themeName) {
  const validThemes = ['nordic', 'forest', 'sunset', 'lavender', 'midnight', 'lemon'];
  const validTheme = validThemes.includes(themeName) ? themeName : 'lemon';
  document.documentElement.setAttribute('data-theme', validTheme);
  updateThemeDropdownUI(validTheme);
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

/* --------------------------------------------------------------------------
   8. HOJA IZQUIERDA: PLANIFICACIÓN, PRIORIDADES, TAREAS GENERALES, NOTAS Y HÁBITOS
   -------------------------------------------------------------------------- */
function renderLeftPlannerPage() {
  const plan = getCurrentWeekPlan();

  // 1. Planificación Semanal (Objetivo / Foco)
  const focusInput = document.getElementById('weeklyFocusInput');
  if (focusInput && document.activeElement !== focusInput) {
    focusInput.value = plan.focus || '';
  }

  // 2. Prioridades (Top 3-5 metas clave)
  const prioritiesList = document.getElementById('prioritiesList');
  if (prioritiesList) {
    prioritiesList.innerHTML = '';
    if (!plan.priorities || plan.priorities.length === 0) {
      prioritiesList.innerHTML = '<div class="empty-state-small">Sin prioridades aún. Agrega tus metas clave abajo.</div>';
    } else {
      plan.priorities.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = `priority-item ${item.completed ? 'completed' : ''}`;
        row.dataset.id = item.id;
        row.innerHTML = `
          <span class="priority-num">${idx + 1}</span>
          <input type="checkbox" class="priority-checkbox" ${item.completed ? 'checked' : ''} aria-label="Marcar como completada">
          <span class="priority-text">${escapeHTML(item.text)}</span>
          <button type="button" class="btn-item-del" title="Eliminar prioridad" aria-label="Eliminar prioridad">✕</button>
        `;

        const chk = row.querySelector('.priority-checkbox');
        chk.addEventListener('change', async () => {
          item.completed = chk.checked;
          row.classList.toggle('completed', item.completed);
          if (item.completed) playReminderChime();
          await saveCurrentDataToFile();
        });

        const btnDel = row.querySelector('.btn-item-del');
        btnDel.addEventListener('click', async () => {
          plan.priorities = plan.priorities.filter(p => p.id !== item.id);
          renderLeftPlannerPage();
          await saveCurrentDataToFile();
        });

        prioritiesList.appendChild(row);
      });
    }
  }

  // 3. Lista de Tareas General (Backlog semanal con soporte Drag & Drop)
  const generalTasksList = document.getElementById('generalTasksList');
  if (generalTasksList) {
    generalTasksList.innerHTML = '';
    if (!plan.generalTasks || plan.generalTasks.length === 0) {
      generalTasksList.innerHTML = '<div class="empty-state-small">No hay tareas pendientes. Agrega tareas y arrástralas al calendario.</div>';
    } else {
      plan.generalTasks.forEach((task) => {
        const item = document.createElement('div');
        item.className = `general-task-item ${task.completed ? 'completed' : ''}`;
        item.draggable = true;
        item.dataset.id = task.id;
        item.innerHTML = `
          <span class="general-task-drag-handle" title="Arrastrar a un día">⠿</span>
          <input type="checkbox" class="priority-checkbox" ${task.completed ? 'checked' : ''} aria-label="Marcar como completada">
          <span class="general-task-text">${escapeHTML(task.title)}</span>
          <button type="button" class="btn-item-del" title="Eliminar tarea" aria-label="Eliminar tarea">✕</button>
        `;

        item.addEventListener('dragstart', (e) => {
          item.classList.add('dragging');
          const backdrop = document.getElementById('drawerBackdrop');
          if (backdrop) backdrop.classList.add('dragging-active');
          e.dataTransfer.setData('application/x-general-task', JSON.stringify(task));
          e.dataTransfer.setData('text/plain', task.title);
          e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          const backdrop = document.getElementById('drawerBackdrop');
          if (backdrop) backdrop.classList.remove('dragging-active');
        });

        const chk = item.querySelector('.priority-checkbox');
        chk.addEventListener('change', async () => {
          task.completed = chk.checked;
          item.classList.toggle('completed', task.completed);
          if (task.completed) playReminderChime();
          await saveCurrentDataToFile();
        });

        const btnDel = item.querySelector('.btn-item-del');
        btnDel.addEventListener('click', async () => {
          plan.generalTasks = plan.generalTasks.filter(t => t.id !== task.id);
          renderLeftPlannerPage();
          await saveCurrentDataToFile();
        });

        generalTasksList.appendChild(item);
      });
    }
  }

  // 4. Notas
  const notesInput = document.getElementById('weeklyNotesInput');
  if (notesInput && document.activeElement !== notesInput) {
    notesInput.value = plan.notes || '';
  }

  // 5. Rastreador de Hábitos (Habit Tracker semanal)
  const habitsContainer = document.getElementById('habitsContainer');
  if (habitsContainer) {
    habitsContainer.innerHTML = '';
    if (!plan.habits || plan.habits.length === 0) {
      habitsContainer.innerHTML = '<div class="empty-state-small">Sin hábitos configurados. Agrega uno abajo (ej: Leer 20 min).</div>';
    } else {
      const headerRow = document.createElement('div');
      headerRow.className = 'habit-header-row';
      ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(letter => {
        const sp = document.createElement('span');
        sp.className = 'habit-day-letter';
        sp.textContent = letter;
        headerRow.appendChild(sp);
      });
      habitsContainer.appendChild(headerRow);

      const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const dayLetters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

      plan.habits.forEach(habit => {
        if (!Array.isArray(habit.days) || habit.days.length !== 7) {
          habit.days = [false, false, false, false, false, false, false];
        }

        const card = document.createElement('div');
        card.className = 'habit-item-card';
        card.dataset.id = habit.id;

        const titleRow = document.createElement('div');
        titleRow.className = 'habit-title-row';
        titleRow.innerHTML = `
          <span class="habit-name">${escapeHTML(habit.name)}</span>
          <button type="button" class="btn-item-del" title="Eliminar hábito" aria-label="Eliminar hábito">✕</button>
        `;

        const btnDel = titleRow.querySelector('.btn-item-del');
        btnDel.addEventListener('click', async () => {
          plan.habits = plan.habits.filter(h => h.id !== habit.id);
          renderLeftPlannerPage();
          await saveCurrentDataToFile();
        });

        const daysRow = document.createElement('div');
        daysRow.className = 'habit-days-row';

        dayLetters.forEach((letter, dayIdx) => {
          const btnDay = document.createElement('button');
          btnDay.type = 'button';
          btnDay.className = `habit-day-btn ${habit.days[dayIdx] ? 'completed' : ''}`;
          btnDay.textContent = letter;
          btnDay.title = `${dayNames[dayIdx]}: ${habit.days[dayIdx] ? 'Cumplido' : 'Pendiente'}`;

          btnDay.addEventListener('click', async () => {
            habit.days[dayIdx] = !habit.days[dayIdx];
            btnDay.classList.toggle('completed', habit.days[dayIdx]);
            btnDay.title = `${dayNames[dayIdx]}: ${habit.days[dayIdx] ? 'Cumplido' : 'Pendiente'}`;
            if (habit.days[dayIdx]) playReminderChime();
            await saveCurrentDataToFile();
          });

          daysRow.appendChild(btnDay);
        });

        card.appendChild(titleRow);
        card.appendChild(daysRow);
        habitsContainer.appendChild(card);
      });
    }
  }
}

function setupLeftPlannerPageListeners() {
  // Guardado con debounce para Planificación Semanal (Objetivo)
  const focusInput = document.getElementById('weeklyFocusInput');
  if (focusInput) {
    focusInput.addEventListener('input', (e) => {
      const plan = getCurrentWeekPlan();
      plan.focus = e.target.value;
      triggerAutoSaveDebounced();
    });
  }

  // Guardado con debounce para Notas
  const notesInput = document.getElementById('weeklyNotesInput');
  if (notesInput) {
    notesInput.addEventListener('input', (e) => {
      const plan = getCurrentWeekPlan();
      plan.notes = e.target.value;
      triggerAutoSaveDebounced();
    });
  }

  // Formulario de agregar prioridad
  const addPriorityForm = document.getElementById('addPriorityForm');
  const newPriorityInput = document.getElementById('newPriorityInput');
  if (addPriorityForm && newPriorityInput) {
    addPriorityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = newPriorityInput.value.trim();
      if (!text) return;
      const plan = getCurrentWeekPlan();
      plan.priorities.push({
        id: generateUniqueId(),
        text: text,
        completed: false
      });
      newPriorityInput.value = '';
      renderLeftPlannerPage();
      await saveCurrentDataToFile();
    });
  }

  // Formulario de agregar tarea general
  const addGeneralTaskForm = document.getElementById('addGeneralTaskForm');
  const newGeneralTaskInput = document.getElementById('newGeneralTaskInput');
  if (addGeneralTaskForm && newGeneralTaskInput) {
    addGeneralTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = newGeneralTaskInput.value.trim();
      if (!title) return;
      const plan = getCurrentWeekPlan();
      plan.generalTasks.push({
        id: generateUniqueId(),
        title: title,
        completed: false
      });
      newGeneralTaskInput.value = '';
      renderLeftPlannerPage();
      await saveCurrentDataToFile();
    });
  }

  // Formulario de agregar hábito
  const addHabitForm = document.getElementById('addHabitForm');
  const newHabitInput = document.getElementById('newHabitInput');
  if (addHabitForm && newHabitInput) {
    addHabitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newHabitInput.value.trim();
      if (!name) return;
      const plan = getCurrentWeekPlan();
      plan.habits.push({
        id: generateUniqueId(),
        name: name,
        days: [false, false, false, false, false, false, false]
      });
      newHabitInput.value = '';
      renderLeftPlannerPage();
      await saveCurrentDataToFile();
    });
  }

  // Control del Panel Lateral Flotante (Modo Libreta)
  const btnToggleNotebook = document.getElementById('btnToggleNotebook');
  const leftPlannerPage = document.getElementById('leftPlannerPage');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');

  function openNotebookDrawer() {
    if (leftPlannerPage) leftPlannerPage.classList.add('drawer-open');
    if (drawerBackdrop) drawerBackdrop.classList.add('open');
    if (btnToggleNotebook) btnToggleNotebook.classList.add('active');
  }

  function closeNotebookDrawer() {
    if (leftPlannerPage) leftPlannerPage.classList.remove('drawer-open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('open');
    if (btnToggleNotebook) btnToggleNotebook.classList.remove('active');
  }

  function toggleNotebookDrawer() {
    const isOpen = leftPlannerPage && leftPlannerPage.classList.contains('drawer-open');
    if (isOpen) {
      closeNotebookDrawer();
    } else {
      openNotebookDrawer();
    }
  }

  window.openNotebookDrawer = openNotebookDrawer;
  window.closeNotebookDrawer = closeNotebookDrawer;
  window.toggleNotebookDrawer = toggleNotebookDrawer;

  if (btnToggleNotebook) {
    btnToggleNotebook.addEventListener('click', toggleNotebookDrawer);
  }

  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', closeNotebookDrawer);
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', closeNotebookDrawer);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && leftPlannerPage && leftPlannerPage.classList.contains('drawer-open')) {
      closeNotebookDrawer();
    }
  });
}



/* --------------------------------------------------------------------------
   9. MODALES Y EVENTOS GENERALES
   -------------------------------------------------------------------------- */
function setupEvents() {
  // Control del Menú Hamburguesa (Móvil)
  const btnHamburger = document.getElementById('btnHamburger');
  const headerActions = document.getElementById('headerActions');
  if (btnHamburger && headerActions) {
    btnHamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = headerActions.classList.toggle('open');
      btnHamburger.classList.toggle('open', isOpen);
      btnHamburger.setAttribute('aria-expanded', isOpen.toString());
    });

    // Cerrar menú al presionar botones en versión móvil
    headerActions.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        headerActions.classList.remove('open');
        btnHamburger.classList.remove('open');
        btnHamburger.setAttribute('aria-expanded', 'false');
      });
    });

    // Cerrar menú al hacer clic fuera del mismo
    document.addEventListener('click', (e) => {
      if (!btnHamburger.contains(e.target) && !headerActions.contains(e.target)) {
        headerActions.classList.remove('open');
        btnHamburger.classList.remove('open');
        btnHamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Navegación de Semanas
  const btnPrev = document.getElementById('btnPrevWeek');
  const btnNext = document.getElementById('btnNextWeek');
  const btnToday = document.getElementById('btnCurrentWeek');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      currentWeekOffset--;
      updateWeekUI();
      renderWeeklyGrid();
      renderLeftPlannerPage();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      currentWeekOffset++;
      updateWeekUI();
      renderWeeklyGrid();
      renderLeftPlannerPage();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      currentWeekOffset = 0;
      updateWeekUI();
      renderWeeklyGrid();
      renderLeftPlannerPage();
    });
  }

  // Píldoras / Chips de Filtro por Categoría
  const chips = document.querySelectorAll('#categoryChips .chip-btn');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategoryFilter = chip.dataset.category;
      renderWeeklyGrid();
    });
  });

  // Zonas de aterrizaje Drag & Drop en columnas de día
  document.querySelectorAll('.day-column').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const targetDay = col.dataset.day;
      if (!targetDay) return;

      // 1. Comprobar si se arrastró una tarea de la Lista General (Hoja Izquierda)
      const generalTaskData = e.dataTransfer.getData('application/x-general-task');
      if (generalTaskData) {
        try {
          const gTask = JSON.parse(generalTaskData);
          const weekDays = getActiveWeekDays(currentWeekOffset);
          const targetDayInfo = weekDays.find(d => d.dayName === targetDay);

          const newTask = {
            id: generateUniqueId(),
            title: gTask.title,
            description: '',
            day: targetDay,
            date: targetDayInfo ? targetDayInfo.isoDate : '',
            startTime: '09:00',
            endTime: '10:00',
            category: 'personal',
            priority: 'media',
            reminderMinutes: 0,
            completed: !!gTask.completed
          };
          currentTasks.push(newTask);

          const plan = getCurrentWeekPlan();
          plan.generalTasks = (plan.generalTasks || []).filter(t => t.id !== gTask.id);

          playReminderChime();
          renderWeeklyGrid();
          renderLeftPlannerPage();
          updateProgressBar();
          await saveCurrentDataToFile();
          showToast('Tarea Asignada', `"${gTask.title}" movida a ${targetDay.charAt(0).toUpperCase() + targetDay.slice(1)}.`, '📅', 2500);
          return;
        } catch (err) {
          console.error('Error al procesar tarea general arrastrada:', err);
        }
      }

      // 2. Tarea existente movida entre días
      const taskId = e.dataTransfer.getData('text/plain');
      if (!taskId) return;

      const task = currentTasks.find(t => t.id === taskId);
      if (!task) return;

      const weekDays = getActiveWeekDays(currentWeekOffset);
      const targetDayInfo = weekDays.find(d => d.dayName === targetDay);

      if (task.day !== targetDay || (targetDayInfo && task.date !== targetDayInfo.isoDate)) {
        task.day = targetDay;
        if (targetDayInfo) {
          task.date = targetDayInfo.isoDate;
        }
        playReminderChime();
        showToast('Tarea Movida', `"${task.title}" movida a ${targetDay}.`, '↔️', 2500);
        await saveCurrentDataToFile();
      }
    });
  });

  // Cambio de tema con dropdown personalizado interactivo y accesible
  const themeDropdown = document.getElementById('themeDropdown');
  const themeTrigger = document.getElementById('themeDropdownTrigger');
  const themeItems = document.querySelectorAll('.theme-dropdown-item');

  if (themeTrigger && themeDropdown) {
    themeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = themeDropdown.classList.toggle('open');
      themeTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    themeItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selectedTheme = item.dataset.theme;
        if (selectedTheme) {
          setAppTheme(selectedTheme);
          if (currentProfile) {
            currentProfile.theme = selectedTheme;
            await saveCurrentDataToFile();
          }
        }
        themeDropdown.classList.remove('open');
        themeTrigger.setAttribute('aria-expanded', 'false');
      });
    });

    // Cerrar menú al hacer clic fuera del dropdown
    document.addEventListener('click', (e) => {
      if (!themeDropdown.contains(e.target)) {
        themeDropdown.classList.remove('open');
        themeTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    // Accesibilidad: cerrar menú al presionar la tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && themeDropdown.classList.contains('open')) {
        themeDropdown.classList.remove('open');
        themeTrigger.setAttribute('aria-expanded', 'false');
        themeTrigger.focus();
      }
    });
  }

  // Compatibilidad selector tradicional de tema
  const quickThemeSelector = document.getElementById('quickThemeSelector');
  if (quickThemeSelector) {
    quickThemeSelector.addEventListener('change', async (e) => {
      setAppTheme(e.target.value);
      if (currentProfile) {
        currentProfile.theme = e.target.value;
        await saveCurrentDataToFile();
      }
    });
  }

  // Botón de notificaciones
  document.getElementById('btnToggleNotifications').addEventListener('click', setupNotificationPermission);

  // Botón abrir archivo
  document.getElementById('btnOpenFile').addEventListener('click', openAndReadFile);

  // Fallback de carga por input file tradicional (iOS Safari, Firefox, Android)
  const fallbackInput = document.getElementById('fallbackFileInput');
  if (fallbackInput) {
    fallbackInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          loadDataIntoState(parsed);
          saveDataToLocalStorage({
            profile: currentProfile,
            tasks: currentTasks,
            weeklyPlans: currentWeeklyPlans
          });
          updateStatusLocal(file.name);
          showToast('Agenda Cargada', `Archivo sincronizado: ${file.name}. Cambios activos.`, '📂', 4000);
        } catch (err) {
          console.error('Error al parsear archivo JSON:', err);
          showToast('Error', 'El archivo no contiene un formato JSON válido.', '⚠️');
        }
      };
      reader.onerror = () => {
        showToast('Error', 'No se pudo leer el archivo seleccionado.', '⚠️');
      };
      reader.readAsText(file);
    });
  }

  // Botón descargar respaldo JSON (disponible en modo móvil o local)
  const btnDownloadBackup = document.getElementById('btnDownloadBackup');
  if (btnDownloadBackup) {
    btnDownloadBackup.addEventListener('click', downloadJsonBackup);
  }

  // Botón refrescar
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    if (activeFileHandle) {
      await readFromHandle(activeFileHandle);
    }
  });

  // Búsqueda en tiempo real
  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentFilterText = e.target.value;
    renderWeeklyGrid();
  });

  // Pestañas móviles por día
  const dayTabs = document.querySelectorAll('.day-tab-btn');
  dayTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      dayTabs.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentMobileDay = btn.dataset.day;

      document.querySelectorAll('.day-column').forEach(col => {
        if (col.dataset.day === currentMobileDay) {
          col.classList.add('active-mobile-day');
        } else {
          col.classList.remove('active-mobile-day');
        }
      });
    });
  });

  // Botones "+" para agregar tarea en cada columna de día
  document.querySelectorAll('.btn-add-day-task').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;
      openTaskModalForNew(day);
    });
  });

  // Formulario de tarea
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  document.getElementById('btnCloseTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('btnCancelTaskModal').addEventListener('click', closeTaskModal);

  // Dropdown personalizado de Categoría en el formulario de tarea
  const categoryDropdown = document.getElementById('categoryDropdown');
  const categoryTrigger = document.getElementById('categoryDropdownTrigger');
  const categoryItems = document.querySelectorAll('.category-dropdown-item');

  if (categoryTrigger && categoryDropdown) {
    categoryTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = categoryDropdown.classList.toggle('open');
      categoryTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    categoryItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedCat = item.dataset.category;
        if (selectedCat) {
          setTaskFormCategory(selectedCat);
        }
        categoryDropdown.classList.remove('open');
        categoryTrigger.setAttribute('aria-expanded', 'false');
      });
    });

    // Cerrar menú al hacer clic fuera del dropdown
    document.addEventListener('click', (e) => {
      if (!categoryDropdown.contains(e.target)) {
        categoryDropdown.classList.remove('open');
        categoryTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    // Accesibilidad: cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && categoryDropdown.classList.contains('open')) {
        categoryDropdown.classList.remove('open');
        categoryTrigger.setAttribute('aria-expanded', 'false');
        categoryTrigger.focus();
      }
    });
  }

  // Modal de confirmación de borrado
  document.getElementById('btnCloseDeleteModal').addEventListener('click', closeDeleteModal);
  document.getElementById('btnCancelDelete').addEventListener('click', closeDeleteModal);
  document.getElementById('btnConfirmDelete').addEventListener('click', confirmDeleteTask);

  // Modal de Crear Agenda
  const dbModal = document.getElementById('newDbModal');
  document.getElementById('btnOpenNewDbModal').onclick = () => dbModal.classList.add('open');
  document.getElementById('btnCloseDbModal').onclick = closeDbModal;
  document.getElementById('btnCancelDbModal').onclick = closeDbModal;

  const themeOptions = document.querySelectorAll('.theme-picker-option');
  themeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      themeOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedModalTheme = opt.dataset.theme;
    });
  });

  document.getElementById('newDbForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('userNameInput').value.trim();
    const birthdate = document.getElementById('userBirthdateInput').value;
    if (name && birthdate) {
      handleCreateNewDatabase(name, birthdate, selectedModalTheme);
    }
  });

  // Ajustar día móvil activo al día de la semana actual
  const todayIndex = new Date().getDay();
  const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const currentDayName = dayNames[todayIndex];
  
  const todayTab = document.querySelector(`.day-tab-btn[data-day="${currentDayName}"]`);
  if (todayTab) {
    todayTab.click();
  }
}

function closeDbModal() {
  document.getElementById('newDbModal').classList.remove('open');
  document.getElementById('newDbForm').reset();
}

/* --------------------------------------------------------------------------
   10. GESTOR DE RECORRIDO GUIADO (ONBOARDING TOUR)
   -------------------------------------------------------------------------- */
const TOUR_STORAGE_KEY = 'licweekly_tour_completed';

const TOUR_STEPS = [
  {
    selector: '.header-brand-wrap',
    title: 'Bienvenido a LICWeekly Planner',
    desc: 'Tu agenda semanal con privacidad total. Tus datos nunca se envían a servidores externos; todo se almacena de forma local y segura en tu dispositivo.'
  },
  {
    selector: '#btnOpenNewDbModal',
    title: 'Crea o Conecta tu Agenda',
    desc: 'Haz clic en "Nueva Agenda" para crear tu archivo personal con tu nombre y fecha de cumpleaños, o en "Conectar Agenda" para reanudar un archivo JSON existente.'
  },
  {
    selector: '.planner-grid',
    title: 'Cuadrícula de los 7 Días',
    desc: 'Organiza tus tareas de lunes a domingo. Puedes marcarlas como completadas, arrastrarlas para reorganizarlas y agregar nuevas tareas con el botón "+" de cada columna.'
  },
  {
    selector: '#btnToggleNotebook',
    title: 'Modo Libreta Semanal',
    desc: 'Despliega el panel lateral para anotar tu foco semanal, prioridades clave, notas rápidas y llevar el seguimiento diario de tus hábitos.'
  },
  {
    selector: '#themeDropdown',
    title: 'Personaliza tus Colores',
    desc: 'Elige entre 6 temas exclusivos (incluyendo Lemon Ice-Cream y Midnight Dark) para adaptar la interfaz a tu gusto en cualquier momento.'
  },
  {
    selector: '.discrete-status-right',
    title: 'Soporte y Guía Rápida',
    desc: '¡Todo listo para empezar! Puedes volver a abrir esta guía en cualquier momento desde "Guía Rápida" o consultar el Manual de Usuario completo con un clic.'
  }
];

let currentTourStep = -1;

function isTourActive() {
  return currentTourStep >= 0 && currentTourStep < TOUR_STEPS.length;
}

function startTour(initialStep = 0) {
  // Cerrar cualquier modal que pudiera estar abierto
  const welcomeModal = document.getElementById('welcomeTourModal');
  if (welcomeModal) welcomeModal.classList.remove('open');

  const newDbModal = document.getElementById('newDbModal');
  if (newDbModal) newDbModal.classList.remove('open');

  const taskModal = document.getElementById('taskModal');
  if (taskModal) taskModal.classList.remove('open');

  currentTourStep = initialStep;
  const overlay = document.getElementById('tourOverlay');
  if (overlay) {
    overlay.style.display = 'block';
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });
  }

  window.addEventListener('resize', handleTourReposition);
  window.addEventListener('scroll', handleTourReposition, true);
  document.addEventListener('keydown', handleTourKeydown);

  renderTourStep(currentTourStep);
}

function handleTourReposition() {
  if (isTourActive()) {
    const step = TOUR_STEPS[currentTourStep];
    const el = document.querySelector(step.selector);
    if (el) positionTourElements(el);
  }
}

function handleTourKeydown(e) {
  if (!isTourActive()) return;

  if (e.key === 'Escape') {
    endTour(false);
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    nextTourStep();
  } else if (e.key === 'ArrowLeft') {
    prevTourStep();
  }
}

function renderTourStep(index) {
  if (index < 0 || index >= TOUR_STEPS.length) {
    endTour(true);
    return;
  }

  currentTourStep = index;
  const step = TOUR_STEPS[index];
  const targetElement = document.querySelector(step.selector);

  // Asegurar visibilidad en header móvil si el elemento está dentro del contenedor desplegable
  if (targetElement && targetElement.closest('#headerActions')) {
    const headerActions = document.getElementById('headerActions');
    const btnHamburger = document.getElementById('btnHamburger');
    if (headerActions && !headerActions.classList.contains('open')) {
      headerActions.classList.add('open');
      if (btnHamburger) {
        btnHamburger.classList.add('open');
        btnHamburger.setAttribute('aria-expanded', 'true');
      }
    }
  }

  const badge = document.getElementById('tourStepBadge');
  const title = document.getElementById('tourTitle');
  const desc = document.getElementById('tourDesc');
  const btnPrev = document.getElementById('btnTourPrev');
  const btnNext = document.getElementById('btnTourNext');

  if (badge) badge.textContent = `Paso ${index + 1} de ${TOUR_STEPS.length}`;
  if (title) title.textContent = step.title;
  if (desc) desc.textContent = step.desc;

  if (btnPrev) {
    btnPrev.style.display = index === 0 ? 'none' : 'inline-block';
  }

  if (btnNext) {
    btnNext.textContent = (index === TOUR_STEPS.length - 1) ? '¡Finalizar!' : 'Siguiente';
  }

  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    setTimeout(() => {
      positionTourElements(targetElement);
    }, 60);
  }
}

function positionTourElements(targetElement) {
  const spotlight = document.getElementById('tourSpotlight');
  const card = document.getElementById('tourCard');
  if (!targetElement || !spotlight || !card) return;

  spotlight.style.display = 'block';
  const rect = targetElement.getBoundingClientRect();
  const padding = 6;
  const isMobile = window.innerWidth <= 600;

  // Actualizar máscara de foco (spotlight)
  spotlight.style.top = `${Math.max(0, rect.top - padding)}px`;
  spotlight.style.left = `${Math.max(0, rect.left - padding)}px`;
  spotlight.style.width = `${rect.width + padding * 2}px`;
  spotlight.style.height = `${rect.height + padding * 2}px`;

  if (isMobile) {
    card.style.top = '';
    card.style.left = '';
    card.style.right = '';
    card.style.bottom = '';
    return;
  }

  const cardWidth = card.offsetWidth || 330;
  const cardHeight = card.offsetHeight || 190;
  let top, left;

  // Si el elemento es muy alto (por ejemplo la cuadrícula completa), centrar en el viewport
  if (rect.height > window.innerHeight * 0.45) {
    top = Math.max(70, (window.innerHeight - cardHeight) / 2);
    left = Math.max(20, (window.innerWidth - cardWidth) / 2);
  } else {
    // Intentar ubicar debajo del elemento
    if (rect.bottom + cardHeight + 20 <= window.innerHeight) {
      top = rect.bottom + 12;
    } else if (rect.top - cardHeight - 20 >= 0) {
      // Ubicar arriba
      top = rect.top - cardHeight - 12;
    } else {
      top = Math.max(20, window.innerHeight - cardHeight - 25);
    }

    // Centrar horizontalmente respecto al elemento objetivo
    left = rect.left + (rect.width / 2) - (cardWidth / 2);
    // Limitar para que no desborde horizontalmente de la pantalla
    left = Math.max(20, Math.min(left, window.innerWidth - cardWidth - 20));
  }

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.style.right = 'auto';
  card.style.bottom = 'auto';
}

function nextTourStep() {
  if (currentTourStep < TOUR_STEPS.length - 1) {
    renderTourStep(currentTourStep + 1);
  } else {
    endTour(true);
  }
}

function prevTourStep() {
  if (currentTourStep > 0) {
    renderTourStep(currentTourStep - 1);
  }
}

function endTour(completed = false) {
  currentTourStep = -1;
  const overlay = document.getElementById('tourOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }, 250);
  }

  window.removeEventListener('resize', handleTourReposition);
  window.removeEventListener('scroll', handleTourReposition, true);
  document.removeEventListener('keydown', handleTourKeydown);

  // Cerrar menú hamburguesa si fue abierto en móvil durante el tour
  const headerActions = document.getElementById('headerActions');
  const btnHamburger = document.getElementById('btnHamburger');
  if (window.innerWidth <= 840 && headerActions && headerActions.classList.contains('open')) {
    headerActions.classList.remove('open');
    if (btnHamburger) {
      btnHamburger.classList.remove('open');
      btnHamburger.setAttribute('aria-expanded', 'false');
    }
  }

  // Marcar como completado en localStorage
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
  } catch (e) {
    console.warn('No se pudo guardar estado del tour en localStorage:', e);
  }

  if (completed) {
    showToast('¡Recorrido Completado!', 'Ya puedes empezar a organizar tu semana con total privacidad.', '🎉', 4500);
  }
}

function initTourListeners() {
  // Botón "Guía Rápida" en barra de estado
  const btnStartTour = document.getElementById('btnStartTour');
  if (btnStartTour) {
    btnStartTour.addEventListener('click', () => {
      startTour(0);
    });
  }

  // Modal de Bienvenida
  const welcomeModal = document.getElementById('welcomeTourModal');
  const btnAccept = document.getElementById('btnAcceptWelcomeTour');
  const btnSkip = document.getElementById('btnSkipWelcomeTour');

  if (btnAccept) {
    btnAccept.addEventListener('click', () => {
      if (welcomeModal) welcomeModal.classList.remove('open');
      startTour(0);
    });
  }

  if (btnSkip) {
    btnSkip.addEventListener('click', () => {
      if (welcomeModal) welcomeModal.classList.remove('open');
      try {
        localStorage.setItem(TOUR_STORAGE_KEY, 'true');
      } catch (e) {}
    });
  }

  if (welcomeModal) {
    welcomeModal.addEventListener('click', (e) => {
      if (e.target === welcomeModal) {
        welcomeModal.classList.remove('open');
      }
    });
  }

  // Controles dentro de la tarjeta del Tour
  const btnTourClose = document.getElementById('btnTourClose');
  const btnTourSkip = document.getElementById('btnTourSkip');
  const btnTourPrev = document.getElementById('btnTourPrev');
  const btnTourNext = document.getElementById('btnTourNext');

  if (btnTourClose) btnTourClose.addEventListener('click', () => endTour(false));
  if (btnTourSkip) btnTourSkip.addEventListener('click', () => endTour(false));
  if (btnTourPrev) btnTourPrev.addEventListener('click', prevTourStep);
  if (btnTourNext) btnTourNext.addEventListener('click', nextTourStep);
}

function checkFirstVisitForTour() {
  try {
    const hasCompletedTour = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!hasCompletedTour) {
      setTimeout(() => {
        const welcomeModal = document.getElementById('welcomeTourModal');
        const newDbModal = document.getElementById('newDbModal');
        if (welcomeModal && (!newDbModal || !newDbModal.classList.contains('open'))) {
          welcomeModal.classList.add('open');
        }
      }, 700);
    }
  } catch (e) {
    console.warn('Error al verificar primer ingreso para tour:', e);
  }
}

/* --------------------------------------------------------------------------
   11. INICIALIZACIÓN
   -------------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  setAppTheme(document.documentElement.getAttribute('data-theme') || 'lemon');
  setupEvents();
  setupLeftPlannerPageListeners();
  initTourListeners();
  updateWeekUI();
  renderWeeklyGrid();
  renderLeftPlannerPage();
  updateProgressBar();
  updateNotificationButtonState();
  checkPersistedFile();
  checkFirstVisitForTour();

  // Iniciar el reloj de monitoreo de recordatorios (cada 25 segundos)
  setInterval(checkReminders, 25000);

  // Registro de Service Worker para soporte Offline y PWA (cuando se hospeda en servidores como Netlify o localhost)
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('PWA Service Worker activo:', reg.scope))
      .catch((err) => console.warn('Aviso: Service Worker no registrado:', err));
  }
});

