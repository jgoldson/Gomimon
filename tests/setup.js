import { jest, beforeEach } from '@jest/globals';

globalThis.jest = jest;

// Test Setup - Mock Chrome APIs
// This file sets up the testing environment with chrome API mocks

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys) => Promise.resolve({})),
      set: jest.fn((items) => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve()),
      remove: jest.fn((keys) => Promise.resolve())
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },

  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },

  contextMenus: {
    create: jest.fn((options) => Promise.resolve()),
    update: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },

  scripting: {
    executeScript: jest.fn(() => Promise.resolve([{ result: true }])),
    insertCSS: jest.fn(() => Promise.resolve())
  },

  tabs: {
    get: jest.fn((tabId) => Promise.resolve({ id: tabId, status: 'complete', url: 'https://twitter.com' })),
    query: jest.fn(() => Promise.resolve([])),
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },

  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    setIcon: jest.fn()
  },

  notifications: {
    create: jest.fn((id, options) => Promise.resolve('notification-id')),
    clear: jest.fn()
  },

  permissions: {
    contains: jest.fn(() => Promise.resolve(true)),
    request: jest.fn(() => Promise.resolve(true))
  },

  offscreen: {
    createDocument: jest.fn(() => Promise.resolve()),
    closeDocument: jest.fn(() => Promise.resolve())
  },

  runtime: {
    getURL: jest.fn(path => `chrome-extension://gomimon/${path}`),
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getContexts: jest.fn(() => Promise.resolve([]))
  }
};

// Mock console methods to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
