/**
 * Game pieces configuration for Slop Swap
 * Each piece type represents a different kind of AI slop
 */

export const PIECE_TYPES = [
  {
    id: 'text',
    emoji: '📝',
    color: '#ff6b6b', // Red
    name: 'Text Slop'
  },
  {
    id: 'image',
    emoji: '🖼️',
    color: '#4ecdc4', // Teal
    name: 'Image Slop'
  },
  {
    id: 'video',
    emoji: '🎬',
    color: '#95e1d3', // Mint
    name: 'Video Slop'
  },
  {
    id: 'audio',
    emoji: '🎵',
    color: '#f38181', // Pink
    name: 'Audio Slop'
  },
  {
    id: 'code',
    emoji: '💻',
    color: '#aa96da', // Purple
    name: 'Code Slop'
  },
  {
    id: 'art',
    emoji: '🎨',
    color: '#fcbad3', // Light Pink
    name: 'AI Art Slop'
  }
];

// Special pieces for combos
export const SPECIAL_PIECES = {
  BOMB: {
    id: 'bomb',
    emoji: '💣',
    color: '#ff4757',
    name: 'Slop Bomb',
    description: 'Clears surrounding 3x3 area'
  },
  ROW_CLEAR: {
    id: 'row_clear',
    emoji: '➡️',
    color: '#ffa502',
    name: 'Row Clearer',
    description: 'Clears entire row'
  },
  COL_CLEAR: {
    id: 'col_clear',
    emoji: '⬇️',
    color: '#ffa502',
    name: 'Column Clearer',
    description: 'Clears entire column'
  },
  RAINBOW: {
    id: 'rainbow',
    emoji: '🌈',
    color: '#ffffff',
    name: 'Rainbow Slop',
    description: 'Clears all pieces of selected type'
  }
};

// Score values
export const SCORES = {
  MATCH_3: 100,
  MATCH_4: 300,
  MATCH_5: 600,
  MATCH_6_PLUS: 1000,
  SPECIAL_BOMB: 500,
  SPECIAL_LINE: 400,
  SPECIAL_RAINBOW: 1500,
  COMBO_MULTIPLIER: 1.5 // Each subsequent combo multiplies score
};

// Game configuration
export const GAME_CONFIG = {
  GRID_SIZE: 8,
  MIN_MATCH: 3,
  MOVE_TIME: 60, // seconds for move-based mode
  TIME_ATTACK_DURATION: 90, // seconds for time attack mode
  TARGET_SCORE_EASY: 3000,
  TARGET_SCORE_MEDIUM: 6000,
  TARGET_SCORE_HARD: 10000
};

/**
 * Get a random piece type
 */
export function getRandomPieceType() {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

/**
 * Get piece by ID
 */
export function getPieceById(id) {
  return PIECE_TYPES.find(p => p.id === id) || SPECIAL_PIECES[id.toUpperCase()];
}

/**
 * Calculate score for a match
 */
export function calculateMatchScore(matchLength, comboCount = 0) {
  let baseScore = 0;

  if (matchLength === 3) {
    baseScore = SCORES.MATCH_3;
  } else if (matchLength === 4) {
    baseScore = SCORES.MATCH_4;
  } else if (matchLength === 5) {
    baseScore = SCORES.MATCH_5;
  } else {
    baseScore = SCORES.MATCH_6_PLUS;
  }

  // Apply combo multiplier
  if (comboCount > 0) {
    baseScore *= Math.pow(SCORES.COMBO_MULTIPLIER, comboCount);
  }

  return Math.floor(baseScore);
}

/**
 * Determine special piece from match
 */
export function getSpecialPieceFromMatch(matchLength, isHorizontal, isVertical) {
  if (matchLength === 5) {
    return SPECIAL_PIECES.RAINBOW;
  } else if (matchLength === 4) {
    // Line match creates line clearer in direction of match
    if (isHorizontal && !isVertical) {
      return SPECIAL_PIECES.ROW_CLEAR;
    } else if (isVertical && !isHorizontal) {
      return SPECIAL_PIECES.COL_CLEAR;
    } else {
      // L or T shape - create bomb
      return SPECIAL_PIECES.BOMB;
    }
  }

  return null;
}
