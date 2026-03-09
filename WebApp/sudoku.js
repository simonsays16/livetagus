/* Filename: sudoku.js */

// 1. Definição dos Ícones Lucide (Movido do HTML)
window.lucide = {
  createIcons: () => {
    const icons = {
      "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
      "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
      pause:
        '<rect width="4" height="16" x="6" y="4" /><rect width="4" height="16" x="14" y="4" />',
      play: '<polygon points="5 3 19 12 5 21 5 3" />',
      eraser:
        '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
      settings:
        '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
      "refresh-cw":
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      trophy:
        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    };

    document.querySelectorAll("[data-lucide]").forEach((element) => {
      const key = element.getAttribute("data-lucide");
      if (!icons[key]) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "24");
      svg.setAttribute("height", "24");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const currentClasses = element.getAttribute("class") || "";
      svg.setAttribute(
        "class",
        `lucide lucide-${key} ${currentClasses}`.trim(),
      );
      if (element.id) svg.setAttribute("id", element.id);
      svg.innerHTML = icons[key];
      element.parentNode.replaceChild(svg, element);
    });
  },
};

const sudokuEngine = {
  BLANK: 0,
  isValid(board, row, col, num) {
    for (let i = 0; i < 9; i++) {
      if (board[row][i] === num && i !== col) return false;
      if (board[i][col] === num && i !== row) return false;
    }
    const startRow = Math.floor(row / 3) * 3;
    const startCol = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (board[startRow + i][startCol + j] === num) return false;
      }
    }
    return true;
  },
  solve(board) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === this.BLANK) {
          const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(
            () => Math.random() - 0.5,
          );
          for (let num of nums) {
            if (this.isValid(board, r, c, num)) {
              board[r][c] = num;
              if (this.solve(board)) return true;
              board[r][c] = this.BLANK;
            }
          }
          return false;
        }
      }
    }
    return true;
  },
  countSolutions(board) {
    let count = 0;
    const solveInternal = (currentBoard) => {
      if (count > 1) return;
      let r = -1,
        c = -1,
        isEmpty = false;
      for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
          if (currentBoard[i][j] === this.BLANK) {
            r = i;
            c = j;
            isEmpty = true;
            break;
          }
        }
        if (isEmpty) break;
      }
      if (!isEmpty) {
        count++;
        return;
      }
      for (let num = 1; num <= 9; num++) {
        if (this.isValid(currentBoard, r, c, num)) {
          currentBoard[r][c] = num;
          solveInternal(currentBoard);
          currentBoard[r][c] = this.BLANK;
        }
      }
    };
    solveInternal(JSON.parse(JSON.stringify(board)));
    return count;
  },
  generate(removedCount) {
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    this.solve(board);
    const solution = JSON.parse(JSON.stringify(board));
    const puzzle = JSON.parse(JSON.stringify(board));

    let positions = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) positions.push({ r, c });
    }
    positions.sort(() => Math.random() - 0.5);

    let attempts = removedCount;
    for (let i = 0; i < positions.length && attempts > 0; i++) {
      const { r, c } = positions[i];
      const originalVal = puzzle[r][c];
      puzzle[r][c] = this.BLANK;
      if (this.countSolutions(puzzle) !== 1) {
        puzzle[r][c] = originalVal;
      } else {
        attempts--;
      }
    }
    return { puzzle, solution };
  },
};

const game = {
  state: {
    puzzle: [],
    solution: [],
    userGrid: [],
    selected: null,
    timer: 0,
    isPaused: false,
    difficulty: "medium",
    errors: 0,
    notesMode: false,
    notes: {},
    history: [],
    numberCounts: {},
  },
  timerInterval: null,

  init() {
    this.setupEventListeners();
    this.initGame();

    document.addEventListener("keydown", (e) => {
      if (this.state.isPaused) return;
      if (e.key >= "1" && e.key <= "9") this.inputNumber(parseInt(e.key));
      if (e.key === "Backspace" || e.key === "Delete") this.erase();
      if (e.key === "ArrowUp") this.moveSelection(-1, 0);
      if (e.key === "ArrowDown") this.moveSelection(1, 0);
      if (e.key === "ArrowLeft") this.moveSelection(0, -1);
      if (e.key === "ArrowRight") this.moveSelection(0, 1);
    });
  },

  // NOVO: Liga todos os cliques aos botões correspondentes sem usar 'onclick' no HTML
  setupEventListeners() {
    document
      .getElementById("btn-pause-header")
      ?.addEventListener("click", () => this.togglePause());
    document
      .getElementById("btn-settings-header")
      ?.addEventListener("click", () => this.openSettings());

    document
      .getElementById("btn-undo")
      ?.addEventListener("click", () => this.undo());
    document
      .getElementById("btn-erase")
      ?.addEventListener("click", () => this.erase());
    document
      .getElementById("btn-notes")
      ?.addEventListener("click", () => this.toggleNotes());
    document
      .getElementById("btn-new-game")
      ?.addEventListener("click", () => this.initGame());

    for (let i = 1; i <= 9; i++) {
      document
        .getElementById(`numpad-${i}`)
        ?.addEventListener("click", () => this.inputNumber(i));
    }

    document
      .getElementById("btn-resume-pause")
      ?.addEventListener("click", () => this.togglePause());
    document
      .getElementById("settings-overlay-bg")
      ?.addEventListener("click", () => this.closeSettings());
    document
      .getElementById("btn-settings-restart")
      ?.addEventListener("click", () => {
        this.restartGame();
        this.closeSettings();
      });
    document
      .getElementById("btn-win-new-game")
      ?.addEventListener("click", () => this.initGame());

    document.querySelectorAll(".diff-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const diff = e.target.closest(".diff-btn").dataset.diff;
        if (diff) this.setDifficulty(diff);
      });
    });
  },

  initGame() {
    const winModal = document.getElementById("win-modal");
    const settingsModal = document.getElementById("settings-modal");
    const pauseOverlay = document.getElementById("pause-overlay");

    if (winModal) winModal.classList.add("hidden");
    if (settingsModal) settingsModal.classList.add("hidden");
    if (pauseOverlay) pauseOverlay.classList.add("hidden");

    const diffMap = { easy: 30, medium: 40, hard: 50 };
    const removeCount = diffMap[this.state.difficulty] || 40;

    const data = sudokuEngine.generate(removeCount);
    this.state.puzzle = data.puzzle;
    this.state.solution = data.solution;
    this.state.userGrid = JSON.parse(JSON.stringify(data.puzzle));
    this.state.notes = {};
    this.state.errors = 0;
    this.state.timer = 0;
    this.state.isPaused = false;
    this.state.selected = null;
    this.state.history = [];
    this.state.numberCounts = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
    };

    this.updateNumpad();
    this.renderBoard();
    this.updateUI();
    this.startTimer();
    this.loadBestTime();
  },

  renderBoard() {
    const boardEl = document.getElementById("sudoku-board");
    if (!boardEl) return;
    boardEl.innerHTML = "";

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement("div");
        const val = this.state.userGrid[r][c];
        const isFixed = this.state.puzzle[r][c] !== 0;

        cell.className = "sudoku-cell";
        cell.dataset.row = r;
        cell.dataset.col = c;

        if (c === 2 || c === 5) cell.classList.add("cell-border-right");
        if (r === 2 || r === 5) cell.classList.add("cell-border-bottom");

        if (val !== 0) {
          cell.textContent = val;
          cell.classList.add(isFixed ? "cell-fixed" : "cell-user");
        } else {
          const noteKey = `${r}-${c}`;
          if (
            this.state.notes[noteKey] &&
            this.state.notes[noteKey].length > 0
          ) {
            cell.innerHTML = `<div class="grid grid-cols-3 text-[var(--text-secondary)] pointer-events-none w-full h-full p-[1px]" style="font-size: 0.5em; line-height: 1;">
                              ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
                                .map(
                                  (n) =>
                                    `<div class="flex items-center justify-center">${this.state.notes[noteKey].includes(n) ? n : ""}</div>`,
                                )
                                .join("")}
                          </div>`;
          }
        }

        if (
          this.state.selected &&
          this.state.selected.r === r &&
          this.state.selected.c === c
        ) {
          cell.classList.add("cell-selected");
        }

        cell.addEventListener("click", () => this.selectCell(r, c));
        boardEl.appendChild(cell);
      }
    }
  },

  selectCell(r, c) {
    if (this.state.isPaused) return;
    this.state.selected = { r, c };

    const cells = document.querySelectorAll(".sudoku-cell");
    const selectedVal = this.state.userGrid[r][c];

    cells.forEach((cell) => {
      const cellR = parseInt(cell.dataset.row);
      const cellC = parseInt(cell.dataset.col);
      const cellVal = this.state.userGrid[cellR][cellC];

      cell.classList.remove("cell-selected", "cell-related", "cell-same-val");

      if (cellR === r && cellC === c) {
        cell.classList.add("cell-selected");
      } else if (
        cellR === r ||
        cellC === c ||
        (Math.floor(cellR / 3) === Math.floor(r / 3) &&
          Math.floor(cellC / 3) === Math.floor(c / 3))
      ) {
        cell.classList.add("cell-related");
      }

      if (selectedVal !== 0 && cellVal === selectedVal) {
        cell.classList.add("cell-same-val");
      }
    });
  },

  moveSelection(dr, dc) {
    if (!this.state.selected) {
      this.selectCell(0, 0);
      return;
    }
    let nr = this.state.selected.r + dr;
    let nc = this.state.selected.c + dc;
    if (nr < 0) nr = 8;
    if (nr > 8) nr = 0;
    if (nc < 0) nc = 8;
    if (nc > 8) nc = 0;
    this.selectCell(nr, nc);
  },

  inputNumber(num) {
    if (!this.state.selected || this.state.isPaused) return;
    const { r, c } = this.state.selected;

    if (this.state.puzzle[r][c] !== 0) return;

    const currentVal = this.state.userGrid[r][c];
    if (currentVal !== 0 && currentVal === this.state.solution[r][c]) return;

    if (this.state.notesMode) {
      const key = `${r}-${c}`;
      if (!this.state.notes[key]) this.state.notes[key] = [];

      const idx = this.state.notes[key].indexOf(num);
      if (idx > -1) this.state.notes[key].splice(idx, 1);
      else this.state.notes[key].push(num);

      this.renderBoard();
      this.selectCell(r, c);
      return;
    }

    if (currentVal === num) return;
    const correctVal = this.state.solution[r][c];

    if (num !== correctVal) {
      this.state.errors++;
      this.updateUI();

      const cell = document.querySelector(
        `.sudoku-cell[data-row="${r}"][data-col="${c}"]`,
      );
      if (cell) {
        cell.classList.add("cell-error");
        cell.innerText = num;
        cell.style.animation = "shake 0.3s";
        setTimeout(() => {
          cell.classList.remove("cell-error");
          cell.style.animation = "";
          cell.innerText = "";
        }, 500);
      }
    } else {
      this.state.userGrid[r][c] = num;
      delete this.state.notes[`${r}-${c}`];
      this.updateNumpad();
      this.renderBoard();
      this.selectCell(r, c);
      this.checkWin();
    }
  },

  erase() {
    if (!this.state.selected || this.state.isPaused) return;
    const { r, c } = this.state.selected;
    if (this.state.puzzle[r][c] !== 0) return;
    const currentVal = this.state.userGrid[r][c];
    if (currentVal !== 0 && currentVal === this.state.solution[r][c]) return;

    this.state.userGrid[r][c] = 0;
    delete this.state.notes[`${r}-${c}`];
    this.renderBoard();
    this.selectCell(r, c);
    this.updateNumpad();
  },

  toggleNotes() {
    this.state.notesMode = !this.state.notesMode;
    const btn = document.getElementById("btn-notes");
    const indicator = document.getElementById("note-indicator");

    if (!btn || !indicator) return;

    if (this.state.notesMode) {
      btn.classList.remove("opacity-70");
      btn.style.color = "var(--accent)";
      indicator.classList.remove("hidden");
    } else {
      btn.classList.add("opacity-70");
      btn.style.color = "var(--text-secondary)";
      indicator.classList.add("hidden");
    }
  },

  undo() {
    alert("Em breve poderás voltar para trás! Até lá é um botão inútil :)");
  },

  updateUI() {
    const errEl = document.getElementById("errors-display");
    if (errEl) {
      errEl.innerText = `${this.state.errors}`;
      errEl.style.color =
        this.state.errors > 0
          ? "var(--cell-error-text)"
          : "var(--text-primary)";
    }

    const diffDisplay = { easy: "Fácil", medium: "Médio", hard: "Difícil" };
    const diffEl = document.getElementById("difficulty-display");
    if (diffEl) diffEl.innerText = diffDisplay[this.state.difficulty];
  },

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const timerDisplay = document.getElementById("timer-display");

    this.timerInterval = setInterval(() => {
      if (!this.state.isPaused) {
        this.state.timer++;
        const min = Math.floor(this.state.timer / 60)
          .toString()
          .padStart(2, "0");
        const sec = (this.state.timer % 60).toString().padStart(2, "0");
        if (timerDisplay) timerDisplay.innerText = `${min}:${sec}`;
      }
    }, 1000);
  },

  togglePause() {
    this.state.isPaused = !this.state.isPaused;
    const overlay = document.getElementById("pause-overlay");
    if (!overlay) return;

    if (this.state.isPaused) {
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
    } else {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
    }
  },

  updateNumpad() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = this.state.userGrid[r][c];
        if (val !== 0 && val === this.state.solution[r][c]) {
          counts[val]++;
        }
      }
    }

    this.state.numberCounts = counts;

    for (let i = 1; i <= 9; i++) {
      const btn = document.getElementById(`numpad-${i}`);
      if (btn) {
        if (counts[i] >= 9) {
          btn.classList.add("opacity-20", "pointer-events-none");
          this.clearNotesForNumber(i);
        } else {
          btn.classList.remove("opacity-20", "pointer-events-none");
        }
      }
    }
  },

  clearNotesForNumber(num) {
    let notesChanged = false;
    for (const key in this.state.notes) {
      const idx = this.state.notes[key].indexOf(num);
      if (idx > -1) {
        this.state.notes[key].splice(idx, 1);
        notesChanged = true;
      }
    }
    if (notesChanged) {
      this.renderBoard();
    }
  },

  openSettings() {
    this.state.isPaused = true;
    const modal = document.getElementById("settings-modal");
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    }

    document.querySelectorAll(".diff-btn").forEach((btn) => {
      if (btn.dataset.diff === this.state.difficulty) {
        btn.classList.add(
          "bg-[var(--accent)]",
          "text-white",
          "border-transparent",
        );
        btn.classList.remove(
          "bg-[var(--input-bg)]",
          "border-[var(--grid-line)]",
          "text-[var(--text-primary)]",
        );
        btn.style.color = "white";
      } else {
        btn.classList.remove(
          "bg-[var(--accent)]",
          "text-white",
          "border-transparent",
        );
        btn.classList.add("bg-[var(--input-bg)]", "border-[var(--grid-line)]");
        btn.style.color = "var(--text-primary)";
      }
    });
  },

  setDifficulty(diff) {
    this.state.difficulty = diff;
    this.initGame();
    this.closeSettings();
  },

  closeSettings() {
    this.state.isPaused = false;
    const modal = document.getElementById("settings-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
  },

  restartGame() {
    this.initGame();
  },

  checkWin() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (this.state.userGrid[r][c] !== this.state.solution[r][c]) return;
      }
    }

    clearInterval(this.timerInterval);
    const min = Math.floor(this.state.timer / 60)
      .toString()
      .padStart(2, "0");
    const sec = (this.state.timer % 60).toString().padStart(2, "0");
    const timeStr = `${min}:${sec}`;

    const winTimeEl = document.getElementById("win-time");
    const winModalEl = document.getElementById("win-modal");

    if (winTimeEl) winTimeEl.innerText = timeStr;
    if (winModalEl) {
      winModalEl.classList.remove("hidden");
      winModalEl.classList.add("flex");
    }

    this.saveBestTime(this.state.timer);
  },

  loadBestTime() {
    const best = localStorage.getItem(`sudoku-best-${this.state.difficulty}`);
    const bestEl = document.getElementById("best-time-display");

    if (best && bestEl) {
      const min = Math.floor(best / 60)
        .toString()
        .padStart(2, "0");
      const sec = (best % 60).toString().padStart(2, "0");
      bestEl.innerText = `${min}:${sec}`;
    } else if (bestEl) {
      bestEl.innerText = "--:--";
    }
  },

  saveBestTime(time) {
    const key = `sudoku-best-${this.state.difficulty}`;
    const current = localStorage.getItem(key);
    if (!current || time < parseInt(current)) {
      localStorage.setItem(key, time);
    }
  },
};

window.onload = () => {
  if (window.lucide) window.lucide.createIcons();
  game.init();
  if (typeof initSudokuTrainBanner === "function") {
    initSudokuTrainBanner();
  }
};
