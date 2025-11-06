/**
 * Quote database for Slop Scholar mini-game
 * Each quote has:
 * - text: the quote itself
 * - isAI: true if AI-generated, false if human-made
 * - attribution: who said it (or fake attribution for AI quotes)
 * - category: subject matter
 */

export const QUOTES = [
  // HUMAN QUOTES
  {
    text: "The only way to do great work is to love what you do.",
    isAI: false,
    attribution: "Steve Jobs",
    category: "work"
  },
  {
    text: "In the middle of difficulty lies opportunity.",
    isAI: false,
    attribution: "Albert Einstein",
    category: "wisdom"
  },
  {
    text: "Be yourself; everyone else is already taken.",
    isAI: false,
    attribution: "Oscar Wilde",
    category: "identity"
  },
  {
    text: "The unexamined life is not worth living.",
    isAI: false,
    attribution: "Socrates",
    category: "philosophy"
  },
  {
    text: "I think, therefore I am.",
    isAI: false,
    attribution: "René Descartes",
    category: "philosophy"
  },
  {
    text: "The only thing we have to fear is fear itself.",
    isAI: false,
    attribution: "Franklin D. Roosevelt",
    category: "courage"
  },
  {
    text: "Ask not what your country can do for you – ask what you can do for your country.",
    isAI: false,
    attribution: "John F. Kennedy",
    category: "service"
  },
  {
    text: "That which does not kill us makes us stronger.",
    isAI: false,
    attribution: "Friedrich Nietzsche",
    category: "resilience"
  },
  {
    text: "The journey of a thousand miles begins with one step.",
    isAI: false,
    attribution: "Lao Tzu",
    category: "action"
  },
  {
    text: "Life is what happens when you're busy making other plans.",
    isAI: false,
    attribution: "John Lennon",
    category: "life"
  },
  {
    text: "The greatest glory in living lies not in never falling, but in rising every time we fall.",
    isAI: false,
    attribution: "Nelson Mandela",
    category: "resilience"
  },
  {
    text: "You miss 100% of the shots you don't take.",
    isAI: false,
    attribution: "Wayne Gretzky",
    category: "action"
  },
  {
    text: "Two roads diverged in a wood, and I—I took the one less traveled by, and that has made all the difference.",
    isAI: false,
    attribution: "Robert Frost",
    category: "choice"
  },
  {
    text: "I have a dream that one day this nation will rise up and live out the true meaning of its creed.",
    isAI: false,
    attribution: "Martin Luther King Jr.",
    category: "justice"
  },
  {
    text: "It is our choices that show what we truly are, far more than our abilities.",
    isAI: false,
    attribution: "J.K. Rowling",
    category: "character"
  },

  // AI-GENERATED QUOTES (plausible but generic/meaningless)
  {
    text: "Success is not just about reaching the destination, but embracing the journey that shapes who we become.",
    isAI: true,
    attribution: "Marcus Chen",
    category: "success"
  },
  {
    text: "In the tapestry of life, every thread of challenge weaves together to create the beautiful pattern of growth.",
    isAI: true,
    attribution: "Dr. Sarah Mitchell",
    category: "growth"
  },
  {
    text: "True wisdom emerges when we learn to balance the chaos of ambition with the serenity of acceptance.",
    isAI: true,
    attribution: "David Thompson",
    category: "wisdom"
  },
  {
    text: "The key to unlocking potential lies in our ability to transform obstacles into stepping stones toward greatness.",
    isAI: true,
    attribution: "Jennifer Rodriguez",
    category: "potential"
  },
  {
    text: "Every moment presents an opportunity to choose courage over comfort and growth over complacency.",
    isAI: true,
    attribution: "Michael Anderson",
    category: "courage"
  },
  {
    text: "The seeds of tomorrow's success are planted in the soil of today's persistence and watered with determination.",
    isAI: true,
    attribution: "Amanda Williams",
    category: "persistence"
  },
  {
    text: "When we align our actions with our authentic values, we unlock the door to meaningful transformation.",
    isAI: true,
    attribution: "Dr. Robert Hayes",
    category: "authenticity"
  },
  {
    text: "Life's greatest lessons often come disguised as challenges that push us beyond our perceived limitations.",
    isAI: true,
    attribution: "Lisa Martinez",
    category: "lessons"
  },
  {
    text: "The bridge between dreams and reality is built with consistency, intention, and unwavering belief.",
    isAI: true,
    attribution: "Christopher Lee",
    category: "dreams"
  },
  {
    text: "True fulfillment comes from nurturing both the mind's aspirations and the heart's deepest desires.",
    isAI: true,
    attribution: "Rachel Cooper",
    category: "fulfillment"
  },
  {
    text: "In the symphony of existence, each note of experience harmonizes to create the melody of wisdom.",
    isAI: true,
    attribution: "Dr. James Peterson",
    category: "experience"
  },
  {
    text: "The compass of purpose guides us through uncertainty toward the horizon of our highest potential.",
    isAI: true,
    attribution: "Emily Stevens",
    category: "purpose"
  },
  {
    text: "Greatness is not a destination but a continuous journey of aligning intention with inspired action.",
    isAI: true,
    attribution: "Thomas Wright",
    category: "greatness"
  },
  {
    text: "The currency of connection is authenticity, and its value appreciates through genuine presence.",
    isAI: true,
    attribution: "Sophia Turner",
    category: "connection"
  },
  {
    text: "When we cultivate inner clarity, outer circumstances transform to reflect our elevated consciousness.",
    isAI: true,
    attribution: "Daniel Brooks",
    category: "clarity"
  }
];

/**
 * Get a random selection of quotes for a game
 * @param {number} count - Number of quotes to return
 * @returns {Array} Shuffled array of quotes
 */
export function getRandomQuotes(count = 10) {
  const shuffled = [...QUOTES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Calculate difficulty score (0-1) based on quote characteristics
 * AI quotes with more generic language are "easier" to detect
 */
export function getDifficultyScore(quote) {
  if (!quote.isAI) return 0.5; // Human quotes have medium difficulty

  // Count "slop" indicators in AI quotes
  const slopIndicators = [
    'journey', 'tapestry', 'unlock', 'transform', 'authentic',
    'align', 'elevate', 'cultivate', 'embrace', 'meaningful',
    'stepping stones', 'bridges', 'compass', 'seeds', 'symphony'
  ];

  const text = quote.text.toLowerCase();
  const slopCount = slopIndicators.filter(word => text.includes(word)).length;

  // More slop words = easier to detect = lower difficulty
  return Math.max(0.1, 1 - (slopCount * 0.15));
}
