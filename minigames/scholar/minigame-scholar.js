/**
 * Slop Scholar Mini-Game
 * A trivia game to identify AI-generated vs human-made quotes
 */

import { QUOTES, getRandomQuotes } from './scholar-quotes.js';

// Game state
const gameState = {
  currentQuestionIndex: 0,
  score: 0,
  totalQuestions: 10,
  quotes: [],
  startTime: null,
  endTime: null,
  answered: false
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
    total: document.getElementById('total'),
    currentQuestion: document.getElementById('current-question'),
    totalQuestions: document.getElementById('total-questions'),
    quoteText: document.getElementById('quote-text'),
    quoteAttribution: document.getElementById('quote-attribution'),
    btnHuman: document.getElementById('btn-human'),
    btnAI: document.getElementById('btn-ai'),
    feedback: document.getElementById('feedback'),

    // Results screen
    finalScore: document.getElementById('final-score'),
    grade: document.getElementById('grade'),
    gradeText: document.getElementById('grade-text'),
    accuracy: document.getElementById('accuracy'),
    timeTaken: document.getElementById('time-taken'),
    rewardList: document.getElementById('reward-list'),
    playAgainBtn: document.getElementById('play-again-btn'),
    closeBtn: document.getElementById('close-btn')
  };

  // Event listeners
  elements.startBtn.addEventListener('click', startGame);
  elements.btnHuman.addEventListener('click', () => submitAnswer(false));
  elements.btnAI.addEventListener('click', () => submitAnswer(true));
  elements.playAgainBtn.addEventListener('click', resetGame);
  elements.closeBtn.addEventListener('click', closeGame);
}

// Start game
function startGame() {
  // Set difficulty
  const difficulty = elements.difficulty.value;
  gameState.totalQuestions = {
    'easy': 5,
    'medium': 10,
    'hard': 15
  }[difficulty];

  // Reset state
  gameState.currentQuestionIndex = 0;
  gameState.score = 0;
  gameState.quotes = getRandomQuotes(gameState.totalQuestions);
  gameState.startTime = Date.now();
  gameState.answered = false;

  // Update UI
  elements.total.textContent = gameState.totalQuestions;
  elements.totalQuestions.textContent = gameState.totalQuestions;

  // Show game screen
  showScreen('game');
  showQuestion();
}

// Show a screen
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

// Show current question
function showQuestion() {
  const quote = gameState.quotes[gameState.currentQuestionIndex];

  // Update question counter
  elements.currentQuestion.textContent = gameState.currentQuestionIndex + 1;

  // Display quote
  elements.quoteText.textContent = quote.text;
  elements.quoteAttribution.textContent = quote.attribution;

  // Reset buttons and feedback
  elements.btnHuman.disabled = false;
  elements.btnAI.disabled = false;
  elements.feedback.classList.add('hidden');
  gameState.answered = false;
}

// Submit answer
function submitAnswer(userSaysAI) {
  if (gameState.answered) return;

  gameState.answered = true;
  const quote = gameState.quotes[gameState.currentQuestionIndex];
  const correct = userSaysAI === quote.isAI;

  // Update score
  if (correct) {
    gameState.score++;
    elements.score.textContent = gameState.score;
  }

  // Show feedback
  showFeedback(correct, quote);

  // Disable buttons
  elements.btnHuman.disabled = true;
  elements.btnAI.disabled = true;

  // Move to next question after delay
  setTimeout(() => {
    gameState.currentQuestionIndex++;

    if (gameState.currentQuestionIndex < gameState.totalQuestions) {
      showQuestion();
    } else {
      endGame();
    }
  }, 2000);
}

// Show feedback
function showFeedback(correct, quote) {
  elements.feedback.classList.remove('hidden', 'correct', 'incorrect');

  if (correct) {
    elements.feedback.classList.add('correct');
    elements.feedback.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 10px;">✅ Correct!</div>
      <div>This quote was ${quote.isAI ? 'AI-generated' : 'human-made'}.</div>
    `;
  } else {
    elements.feedback.classList.add('incorrect');
    elements.feedback.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 10px;">❌ Wrong!</div>
      <div>This quote was actually ${quote.isAI ? 'AI-generated' : 'human-made'}.</div>
    `;
  }
}

// End game
function endGame() {
  gameState.endTime = Date.now();
  const timeTakenMs = gameState.endTime - gameState.startTime;
  const timeTakenSec = Math.floor(timeTakenMs / 1000);
  const minutes = Math.floor(timeTakenSec / 60);
  const seconds = timeTakenSec % 60;

  // Calculate accuracy
  const accuracy = Math.round((gameState.score / gameState.totalQuestions) * 100);

  // Determine grade
  const gradeData = calculateGrade(accuracy);

  // Update results UI
  elements.finalScore.textContent = `${gameState.score}/${gameState.totalQuestions}`;
  elements.grade.textContent = gradeData.letter;
  elements.grade.className = `grade ${gradeData.letter}`;
  elements.gradeText.textContent = gradeData.text;
  elements.accuracy.textContent = `${accuracy}%`;
  elements.timeTaken.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Calculate and show rewards
  const rewards = calculateRewards(accuracy, gameState.totalQuestions);
  displayRewards(rewards);

  // Send rewards to background script
  sendRewardsToBackground(rewards);

  // Show results screen
  showScreen('results');
}

// Calculate grade
function calculateGrade(accuracy) {
  if (accuracy >= 95) {
    return { letter: 'S', text: 'Perfect! Slop Detection Master!' };
  } else if (accuracy >= 85) {
    return { letter: 'A', text: 'Excellent! You know your slop!' };
  } else if (accuracy >= 70) {
    return { letter: 'B', text: 'Good job! Getting better!' };
  } else if (accuracy >= 55) {
    return { letter: 'C', text: 'Not bad! Keep practicing!' };
  } else if (accuracy >= 40) {
    return { letter: 'D', text: 'Could be better...' };
  } else {
    return { letter: 'F', text: 'Oof. Try again!' };
  }
}

// Calculate rewards based on performance
function calculateRewards(accuracy, totalQuestions) {
  const rewards = {
    hunger: 0,
    glitch: 0
  };

  // Base rewards for playing
  rewards.hunger = 5;

  // Bonus hunger for good performance
  if (accuracy >= 70) {
    rewards.hunger += Math.floor(totalQuestions * 0.5);
  } else if (accuracy >= 50) {
    rewards.hunger += Math.floor(totalQuestions * 0.3);
  }

  // Glitch based on difficulty and performance
  // Perfect play = no glitch, poor play = more glitch
  if (accuracy >= 90) {
    rewards.glitch = 0; // No glitch for excellent performance
  } else if (accuracy >= 70) {
    rewards.glitch = 2; // Small glitch penalty
  } else if (accuracy >= 50) {
    rewards.glitch = 5; // Medium glitch
  } else {
    rewards.glitch = 8; // Higher glitch for poor performance
  }

  return rewards;
}

// Display rewards
function displayRewards(rewards) {
  elements.rewardList.innerHTML = '';

  // Hunger reward
  if (rewards.hunger > 0) {
    const hungerItem = document.createElement('div');
    hungerItem.className = 'reward-item';
    hungerItem.innerHTML = `
      <span class="reward-icon">🍖</span>
      <span class="reward-text">Hunger restored</span>
      <span class="reward-value">+${rewards.hunger}</span>
    `;
    elements.rewardList.appendChild(hungerItem);
  }

  // Glitch change
  const glitchItem = document.createElement('div');
  glitchItem.className = 'reward-item';

  if (rewards.glitch === 0) {
    glitchItem.innerHTML = `
      <span class="reward-icon">✨</span>
      <span class="reward-text">No glitch! Perfect play!</span>
      <span class="reward-value">+0</span>
    `;
  } else {
    glitchItem.innerHTML = `
      <span class="reward-icon">⚡</span>
      <span class="reward-text">Glitch increase</span>
      <span class="reward-value negative">+${rewards.glitch}</span>
    `;
  }
  elements.rewardList.appendChild(glitchItem);
}

// Send rewards to background script
function sendRewardsToBackground(rewards) {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'MINIGAME_COMPLETE',
      game: 'scholar',
      rewards: rewards,
      score: gameState.score,
      total: gameState.totalQuestions
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

// Reset game
function resetGame() {
  showScreen('start');
}

// Close game window
function closeGame() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    window.close();
  } else {
    console.log('Game would close here');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
