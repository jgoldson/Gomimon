/**
 * Slop Swap - Match-3 Puzzle Game
 */

import {
  PIECE_TYPES,
  SPECIAL_PIECES,
  GAME_CONFIG,
  getRandomPieceType,
  calculateMatchScore,
  getSpecialPieceFromMatch
} from './swap-pieces.js';

// Game state
const gameState = {
  board: [],
  score: 0,
  targetScore: 3000,
  timeRemaining: 90,
  comboCount: 0,
  maxCombo: 0,
  selectedCell: null,
  isProcessing: false,
  timerInterval: null,
  difficulty: 'medium'
};

// DOM elements
let elements = {};

// Initialize game
function init() {
  // Cache DOM elements
  elements = {
    // Screens
    startScreen: document.getElementById('start-screen'),
    gameScreen: document.getElementById('game-screen'),
    resultsScreen: document.getElementById('results-screen'),

    // Start screen
    startBtn: document.getElementById('start-btn'),
    difficulty: document.getElementById('difficulty'),

    // Game screen
    score: document.getElementById('score'),
    target: document.getElementById('target'),
    timer: document.getElementById('timer'),
    combo: document.getElementById('combo'),
    progressBar: document.getElementById('progress-bar'),
    gameBoard: document.getElementById('game-board'),
    hintText: document.getElementById('hint-text'),

    // Results screen
    resultsTitle: document.getElementById('results-title'),
    finalScore: document.getElementById('final-score'),
    resultTarget: document.getElementById('result-target'),
    maxComboDisplay: document.getElementById('max-combo'),
    timeRemainingDisplay: document.getElementById('time-remaining'),
    rewardList: document.getElementById('reward-list'),
    playAgainBtn: document.getElementById('play-again-btn'),
    closeBtn: document.getElementById('close-btn')
  };

  // Event listeners
  elements.startBtn.addEventListener('click', startGame);
  elements.playAgainBtn.addEventListener('click', resetGame);
  elements.closeBtn.addEventListener('click', closeGame);
}

// Start game
function startGame() {
  // Get difficulty
  gameState.difficulty = elements.difficulty.value;

  // Set target score based on difficulty
  gameState.targetScore = {
    'easy': GAME_CONFIG.TARGET_SCORE_EASY,
    'medium': GAME_CONFIG.TARGET_SCORE_MEDIUM,
    'hard': GAME_CONFIG.TARGET_SCORE_HARD
  }[gameState.difficulty];

  // Reset state
  gameState.score = 0;
  gameState.timeRemaining = GAME_CONFIG.TIME_ATTACK_DURATION;
  gameState.comboCount = 0;
  gameState.maxCombo = 0;
  gameState.selectedCell = null;
  gameState.isProcessing = false;

  // Update UI
  elements.target.textContent = gameState.targetScore;
  elements.score.textContent = '0';
  elements.timer.textContent = gameState.timeRemaining;
  elements.combo.textContent = '0x';
  updateProgressBar();

  // Initialize board
  initializeBoard();

  // Start timer
  startTimer();

  // Show game screen
  showScreen('game');
}

// Initialize the game board
function initializeBoard() {
  gameState.board = [];
  elements.gameBoard.innerHTML = '';

  // Create grid
  for (let row = 0; row < GAME_CONFIG.GRID_SIZE; row++) {
    gameState.board[row] = [];
    for (let col = 0; col < GAME_CONFIG.GRID_SIZE; col++) {
      // Get random piece that doesn't create initial matches
      let piece = getRandomNonMatchingPiece(row, col);
      gameState.board[row][col] = piece;

      // Create DOM element
      const cell = createCellElement(piece, row, col);
      elements.gameBoard.appendChild(cell);
    }
  }
}

// Get a random piece that won't create an initial match
function getRandomNonMatchingPiece(row, col) {
  let attempts = 0;
  let piece;

  do {
    piece = getRandomPieceType();
    attempts++;

    // If we've tried too many times, just return any piece
    if (attempts > 20) break;

    // Check if this piece would create a match
    const wouldMatch = wouldCreateMatch(row, col, piece);
    if (!wouldMatch) break;
  } while (true);

  return piece;
}

// Check if placing a piece would create a match
function wouldCreateMatch(row, col, piece) {
  // Check horizontal
  let horizCount = 1;
  // Check left
  for (let c = col - 1; c >= 0 && gameState.board[row][c]?.id === piece.id; c--) {
    horizCount++;
  }
  // Check right
  for (let c = col + 1; c < GAME_CONFIG.GRID_SIZE && gameState.board[row][c]?.id === piece.id; c++) {
    horizCount++;
  }

  if (horizCount >= GAME_CONFIG.MIN_MATCH) return true;

  // Check vertical
  let vertCount = 1;
  // Check up
  for (let r = row - 1; r >= 0 && gameState.board[r][col]?.id === piece.id; r--) {
    vertCount++;
  }
  // Check down
  for (let r = row + 1; r < GAME_CONFIG.GRID_SIZE && gameState.board[r][col]?.id === piece.id; r++) {
    vertCount++;
  }

  if (vertCount >= GAME_CONFIG.MIN_MATCH) return true;

  return false;
}

// Create a cell DOM element
function createCellElement(piece, row, col) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
  cell.dataset.type = piece.id;
  cell.textContent = piece.emoji;
  cell.style.backgroundColor = piece.color;

  cell.addEventListener('click', () => handleCellClick(row, col));

  return cell;
}

// Handle cell click
function handleCellClick(row, col) {
  if (gameState.isProcessing) return;

  const cell = getCellElement(row, col);

  // If no cell selected, select this one
  if (!gameState.selectedCell) {
    gameState.selectedCell = { row, col };
    cell.classList.add('selected');
    return;
  }

  // If clicking the same cell, deselect
  if (gameState.selectedCell.row === row && gameState.selectedCell.col === col) {
    cell.classList.remove('selected');
    gameState.selectedCell = null;
    return;
  }

  // Check if cells are adjacent
  const isAdjacent = Math.abs(gameState.selectedCell.row - row) + Math.abs(gameState.selectedCell.col - col) === 1;

  if (isAdjacent) {
    // Attempt swap
    performSwap(gameState.selectedCell.row, gameState.selectedCell.col, row, col);
  } else {
    // Select new cell
    const prevCell = getCellElement(gameState.selectedCell.row, gameState.selectedCell.col);
    prevCell.classList.remove('selected');
    gameState.selectedCell = { row, col };
    cell.classList.add('selected');
  }
}

// Perform a swap
async function performSwap(row1, col1, row2, col2) {
  gameState.isProcessing = true;

  // Deselect cells
  const cell1 = getCellElement(row1, col1);
  const cell2 = getCellElement(row2, col2);
  cell1.classList.remove('selected');
  cell2.classList.remove('selected');
  gameState.selectedCell = null;

  // Swap in board
  const temp = gameState.board[row1][col1];
  gameState.board[row1][col1] = gameState.board[row2][col2];
  gameState.board[row2][col2] = temp;

  // Update DOM
  updateCellDisplay(row1, col1);
  updateCellDisplay(row2, col2);

  // Wait for animation
  await delay(200);

  // Check for matches
  const matches = findAllMatches();

  if (matches.length === 0) {
    // No match, swap back
    const temp2 = gameState.board[row1][col1];
    gameState.board[row1][col1] = gameState.board[row2][col2];
    gameState.board[row2][col2] = temp2;

    updateCellDisplay(row1, col1);
    updateCellDisplay(row2, col2);

    gameState.isProcessing = false;
    showHint('No matches! Try another swap.');
    await delay(1500);
    showHint('Swap pieces to match 3 or more!');
  } else {
    // Process matches
    await processMatches();
  }
}

// Find all matches on the board
function findAllMatches() {
  const matches = [];
  const checked = new Set();

  // Check horizontal matches
  for (let row = 0; row < GAME_CONFIG.GRID_SIZE; row++) {
    for (let col = 0; col < GAME_CONFIG.GRID_SIZE - 2; col++) {
      const piece = gameState.board[row][col];
      if (!piece) continue;

      let matchLength = 1;
      let matchCells = [{ row, col }];

      for (let c = col + 1; c < GAME_CONFIG.GRID_SIZE; c++) {
        if (gameState.board[row][c]?.id === piece.id) {
          matchLength++;
          matchCells.push({ row, col: c });
        } else {
          break;
        }
      }

      if (matchLength >= GAME_CONFIG.MIN_MATCH) {
        matchCells.forEach(cell => {
          const key = `${cell.row},${cell.col}`;
          if (!checked.has(key)) {
            matches.push(cell);
            checked.add(key);
          }
        });
      }
    }
  }

  // Check vertical matches
  for (let col = 0; col < GAME_CONFIG.GRID_SIZE; col++) {
    for (let row = 0; row < GAME_CONFIG.GRID_SIZE - 2; row++) {
      const piece = gameState.board[row][col];
      if (!piece) continue;

      let matchLength = 1;
      let matchCells = [{ row, col }];

      for (let r = row + 1; r < GAME_CONFIG.GRID_SIZE; r++) {
        if (gameState.board[r][col]?.id === piece.id) {
          matchLength++;
          matchCells.push({ row: r, col });
        } else {
          break;
        }
      }

      if (matchLength >= GAME_CONFIG.MIN_MATCH) {
        matchCells.forEach(cell => {
          const key = `${cell.row},${cell.col}`;
          if (!checked.has(key)) {
            matches.push(cell);
            checked.add(key);
          }
        });
      }
    }
  }

  return matches;
}

// Process matches and cascade
async function processMatches() {
  let hasMatches = true;
  let cascadeCount = 0;

  while (hasMatches) {
    const matches = findAllMatches();

    if (matches.length === 0) {
      hasMatches = false;
      gameState.comboCount = 0;
      updateComboDisplay();
      gameState.isProcessing = false;
      break;
    }

    // Highlight matching cells
    matches.forEach(({ row, col }) => {
      const cell = getCellElement(row, col);
      cell.classList.add('matching');
    });

    await delay(300);

    // Calculate score for this match
    const matchScore = calculateMatchScore(matches.length, cascadeCount);
    addScore(matchScore);

    // Update combo
    gameState.comboCount = cascadeCount;
    if (gameState.comboCount > gameState.maxCombo) {
      gameState.maxCombo = gameState.comboCount;
    }
    updateComboDisplay();

    // Remove matched pieces
    matches.forEach(({ row, col }) => {
      const cell = getCellElement(row, col);
      cell.classList.add('disappearing');
      gameState.board[row][col] = null;
    });

    await delay(300);

    // Apply gravity
    applyGravity();
    await delay(400);

    cascadeCount++;
  }

  // Show combo message if applicable
  if (cascadeCount > 1) {
    showHint(`${cascadeCount}x COMBO! 🔥`);
    await delay(2000);
    showHint('Keep matching!');
  }
}

// Apply gravity to make pieces fall
function applyGravity() {
  for (let col = 0; col < GAME_CONFIG.GRID_SIZE; col++) {
    // Collect non-null pieces from bottom to top
    const column = [];
    for (let row = GAME_CONFIG.GRID_SIZE - 1; row >= 0; row--) {
      if (gameState.board[row][col]) {
        column.push(gameState.board[row][col]);
      }
    }

    // Fill from bottom
    let colIndex = 0;
    for (let row = GAME_CONFIG.GRID_SIZE - 1; row >= 0; row--) {
      if (colIndex < column.length) {
        gameState.board[row][col] = column[colIndex];
        colIndex++;
      } else {
        // Add new random piece at top
        gameState.board[row][col] = getRandomPieceType();
      }

      updateCellDisplay(row, col);
      const cell = getCellElement(row, col);
      cell.classList.add('falling');
      setTimeout(() => cell.classList.remove('falling'), 400);
    }
  }
}

// Update cell display
function updateCellDisplay(row, col) {
  const cell = getCellElement(row, col);
  const piece = gameState.board[row][col];

  if (piece) {
    cell.textContent = piece.emoji;
    cell.dataset.type = piece.id;
    cell.style.backgroundColor = piece.color;
    cell.classList.remove('matching', 'disappearing');
  }
}

// Get cell element
function getCellElement(row, col) {
  return elements.gameBoard.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

// Add score
function addScore(points) {
  gameState.score += points;
  elements.score.textContent = gameState.score;
  updateProgressBar();

  // Check win condition
  if (gameState.score >= gameState.targetScore) {
    setTimeout(() => endGame(true), 500);
  }
}

// Update progress bar
function updateProgressBar() {
  const progress = Math.min((gameState.score / gameState.targetScore) * 100, 100);
  elements.progressBar.style.width = `${progress}%`;
}

// Update combo display
function updateComboDisplay() {
  elements.combo.textContent = gameState.comboCount > 0 ? `${gameState.comboCount}x` : '0x';
}

// Show hint
function showHint(text) {
  elements.hintText.textContent = text;
}

// Start timer
function startTimer() {
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }

  gameState.timerInterval = setInterval(() => {
    gameState.timeRemaining--;
    elements.timer.textContent = gameState.timeRemaining;

    if (gameState.timeRemaining <= 10) {
      elements.timer.style.color = '#ff6b6b';
    }

    if (gameState.timeRemaining <= 0) {
      endGame(false);
    }
  }, 1000);
}

// End game
function endGame(won) {
  // Stop timer
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;
  }

  // Calculate rewards
  const rewards = calculateRewards(won, gameState.score, gameState.timeRemaining);

  // Update results UI
  elements.resultsTitle.textContent = won ? 'Victory! 🎉' : 'Time\'s Up! ⏰';
  elements.resultsTitle.className = won ? 'results-title victory' : 'results-title defeat';
  elements.finalScore.textContent = gameState.score;
  elements.resultTarget.textContent = gameState.targetScore;
  elements.maxComboDisplay.textContent = `${gameState.maxCombo}x`;
  elements.timeRemainingDisplay.textContent = `${gameState.timeRemaining}s`;

  // Display rewards
  displayRewards(rewards);

  // Send rewards to background
  sendRewardsToBackground(rewards, won);

  // Show results screen
  showScreen('results');
}

// Calculate rewards
function calculateRewards(won, score, timeRemaining) {
  const rewards = {
    hunger: 0,
    glitch: 0
  };

  if (won) {
    // Base reward for winning
    rewards.hunger = 10;

    // Bonus for remaining time
    const timeBonus = Math.floor(timeRemaining / 10);
    rewards.hunger += timeBonus;

    // Bonus for high score
    const scoreRatio = score / gameState.targetScore;
    if (scoreRatio >= 2) {
      rewards.hunger += 10;
    } else if (scoreRatio >= 1.5) {
      rewards.hunger += 5;
    }

    // Low glitch for winning
    rewards.glitch = 2;
  } else {
    // Consolation prize for trying
    rewards.hunger = 3;

    // Higher glitch for losing
    rewards.glitch = 6;
  }

  return rewards;
}

// Display rewards
function displayRewards(rewards) {
  elements.rewardList.innerHTML = '';

  // Hunger reward
  const hungerItem = document.createElement('div');
  hungerItem.className = 'reward-item';
  hungerItem.innerHTML = `
    <span class="reward-icon">🍖</span>
    <span class="reward-text">Hunger restored</span>
    <span class="reward-value">+${rewards.hunger}</span>
  `;
  elements.rewardList.appendChild(hungerItem);

  // Glitch change
  const glitchItem = document.createElement('div');
  glitchItem.className = 'reward-item';
  glitchItem.innerHTML = `
    <span class="reward-icon">⚡</span>
    <span class="reward-text">Glitch increase</span>
    <span class="reward-value negative">+${rewards.glitch}</span>
  `;
  elements.rewardList.appendChild(glitchItem);
}

// Send rewards to background
function sendRewardsToBackground(rewards, won) {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'MINIGAME_COMPLETE',
      game: 'swap',
      rewards: rewards,
      score: gameState.score,
      total: gameState.targetScore,
      won: won
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending rewards:', chrome.runtime.lastError);
      } else {
        console.log('Rewards sent successfully:', response);
      }
    });
  } else {
    console.log('Not in extension context, rewards:', rewards);
  }
}

// Show screen
function showScreen(screenName) {
  elements.startScreen.classList.remove('active');
  elements.gameScreen.classList.remove('active');
  elements.resultsScreen.classList.remove('active');

  if (screenName === 'start') {
    elements.startScreen.classList.add('active');
  } else if (screenName === 'game') {
    elements.gameScreen.classList.add('active');
  } else if (screenName === 'results') {
    elements.resultsScreen.classList.add('active');
  }
}

// Reset game
function resetGame() {
  showScreen('start');
}

// Close game
function closeGame() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    window.close();
  } else {
    console.log('Game would close here');
  }
}

// Utility: delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
