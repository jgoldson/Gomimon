import { HISTORY_KEY, HISTORY_CATEGORY_LABELS } from './slop-history.js';
// GomiMon Popup Script (Refactored)
// Displays the pet and its stats with proper error handling

import {
  PLATFORMS,
  LOW_HUNGER_THRESHOLD,
  HIGH_GLITCH_THRESHOLD,
  GLITCH_CRASH_THRESHOLD,
  EVOLUTION_NAMES,
  PET_SPRITES,
  DEFAULT_STATS,
  sanitizeStats,
  getPetSprite,
  validatePetName
} from './constants.js';

const SAFARI_RELEASE = chrome.runtime.getURL('').startsWith('safari-web-extension:');
let releaseConsent = false;
let consentDismissed = false;
let linkedProviders = [];
function renderSafariRelease() {
  if (!SAFARI_RELEASE) return;
  const settings = detectorSettingsOpen && onboardingStage === 'complete';
  document.getElementById('onboardingApple').hidden = false;
  document.getElementById('onboardingLocal').hidden = false;
  document.getElementById('detectorAppleSignIn').hidden = !settings || detectorSignedIn;
  document.getElementById('safariAccountSettings').hidden = !settings || !detectorSignedIn;
  document.getElementById('safariProviders').textContent = `Linked sign-ins: ${linkedProviders.join(', ') || 'loading…'}`;
  document.getElementById('linkApple').hidden = linkedProviders.includes('apple');
  document.getElementById('linkGoogle').hidden = linkedProviders.includes('google');
  document.getElementById('safariConsent').hidden = !(settings || onboardingStage === 'account' || (onboardingStage === 'complete' && !releaseConsent && !consentDismissed));
  document.getElementById('allowAI').hidden = releaseConsent;
  document.getElementById('declineAI').hidden = releaseConsent;
  document.getElementById('withdrawAI').hidden = !releaseConsent;
  document.getElementById('safariConsentStatus').textContent = releaseConsent ? 'Permission is on.' : 'Permission is off. Remote checks and public name reservation are paused.';
  document.getElementById('billingSettings').hidden = true;
}
async function changeAIConsent(accepted) {
  try {
    const result = await callBackground({ type: 'SET_AI_CONSENT', accepted });
    releaseConsent = result.consent; consentDismissed = !accepted;
    renderSafariRelease(); await updateDetectorUI();
  } catch (error) { document.getElementById('safariConsentStatus').textContent = error.message; }
}
async function linkSafariProvider(provider) {
  try {
    await callBackground({ type: 'DETECTOR_LINK_PROVIDER', provider });
    elements.detectorStatus.textContent = 'Finish linking in the new Safari tab.';
  } catch (error) { elements.detectorStatus.textContent = error.message; }
}

// Cached stats to prevent unnecessary updates
let cachedStats = null;
let renderedPetStats = null;
let petAnimationTimer = null;

// Cached DOM elements
const elements = {};
let detectorOnboardingOpen = false;
let detectorSettingsOpen = false;
let onboardingStage = 'loading';
let detectorSignedIn = false;
let accountSnapshot = null;
let leaderboardOpen = false;
let historyOpen = false;
let leaderboardPeriod = 'weekly';
let nameMigrationRequired = false;
let platformDraft = false;
let categoryDraft = false;
let profileNameDraft = false;
let onboardingBusy = false;
let accountBusy = false;
let finishingOnboarding = false;

// Cache DOM elements on load
function cacheElements() {
  elements.hungerBar = document.getElementById('hungerBar');
  elements.hungerValue = document.getElementById('hungerValue');
  elements.hungerState = document.getElementById('hungerState');
  elements.glitchBar = document.getElementById('glitchBar');
  elements.glitchValue = document.getElementById('glitchValue');
  elements.glitchState = document.getElementById('glitchState');
  elements.petSprite = document.getElementById('petSprite');
  elements.petContainer = document.getElementById('petContainer');
  elements.rebootButton = document.getElementById('rebootButton');
  elements.infoText = document.getElementById('infoText');
  elements.petName = document.getElementById('petName');
  elements.petState = document.querySelector('.pet-state');
  elements.feedSummary = document.getElementById('feedSummary');
  elements.consoleFooter = document.getElementById('consoleFooter');
  elements.detectorStatus = document.getElementById('detectorStatus');
  elements.detectorSignInButton = document.getElementById('detectorSignInButton');
  elements.detectorOnboarding = document.getElementById('detectorOnboarding');
  elements.detectorOnboardingDismiss = document.getElementById('detectorOnboardingDismiss');
  elements.detectorOnboardingOpen = document.getElementById('detectorOnboardingOpen');
  elements.detectorControls = document.getElementById('detectorControls');
  elements.detectorCategoryControls = document.getElementById('detectorCategoryControls');
  elements.detectorCategoryStrength = document.getElementById('detectorCategoryStrength');
  elements.detectorFilterSummary = document.getElementById('detectorFilterSummary');
  elements.detectorCategoryInputs = Array.from(document.querySelectorAll('[data-detector-category]'));
  elements.detectorMode = document.getElementById('detectorMode');
  elements.detectorSensitivity = document.getElementById('detectorSensitivity');
  elements.detectorDebug = document.getElementById('detectorDebug');
  elements.detectorSignOutButton = document.getElementById('detectorSignOutButton');
  elements.detectorDeleteButton = document.getElementById('detectorDeleteButton');
  elements.detectorSection = document.getElementById('detectorSection');
  elements.showEatingAnimations = document.getElementById('showEatingAnimations');
  elements.settingsButton = document.getElementById('settingsButton');
  elements.settingsCloseButton = document.getElementById('settingsCloseButton');
  elements.detectorDebugControl = document.getElementById('detectorDebugControl');
  elements.settingsDebugTools = document.getElementById('settingsDebugTools');
  elements.debugPetForm = document.getElementById('debugPetForm');
  elements.debugPetFormStatus = document.getElementById('debugPetFormStatus');
  elements.debugPetForm.replaceChildren(...Object.entries(EVOLUTION_NAMES).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.detectorTitle = document.getElementById('detector-title');
  elements.onboardingNameField = document.getElementById('onboardingNameField');
  elements.onboardingPetName = document.getElementById('onboardingPetName');
  elements.onboardingNameHelp = document.getElementById('onboardingNameHelp');
  elements.leaderboardOpen = document.getElementById('leaderboardOpen');
  elements.leaderboardSection = document.getElementById('leaderboardSection');
  elements.leaderboardClose = document.getElementById('leaderboardClose');
  elements.leaderboardWeekly = document.getElementById('leaderboardWeekly');
  elements.leaderboardAllTime = document.getElementById('leaderboardAllTime');
  elements.leaderboardStatus = document.getElementById('leaderboardStatus');
  elements.leaderboardList = document.getElementById('leaderboardList');
  elements.leaderboardMe = document.getElementById('leaderboardMe');
  elements.leaderboardJoin = document.getElementById('leaderboardJoin');
  elements.leaderboardLeave = document.getElementById('leaderboardLeave');
  elements.profileSettings = document.getElementById('profileSettings');
  elements.profileNameInput = document.getElementById('profileNameInput');
  elements.profileNameSave = document.getElementById('profileNameSave');
  elements.profileStatus = document.getElementById('profileStatus');
  elements.platformControls = document.getElementById('platformControls');
  elements.platformNotice = document.getElementById('platformNotice');
  const options = document.getElementById('platformOptions');
  options.replaceChildren();
  for (const platform of Object.values(PLATFORMS.registry)) {
    const label = document.createElement('label');
    label.className = 'platform-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.platform = platform.id;
    input.checked = true;
    const name = document.createElement('span');
    name.textContent = platform.name;
    const logo = document.createElement('span');
    logo.className = `platform-logo ${platform.id}-logo`;
    logo.setAttribute('aria-hidden', 'true');
    logo.textContent = platform.id === 'reddit' ? 'r/' : '𝕏';
    label.append(input, logo, name);
    options.appendChild(label);
  }
  elements.platformInputs = Array.from(options.querySelectorAll('input'));
}

function renderDetectorSections() {
  renderSafariRelease();
  if (document.getElementById('onboardingCreature')?.classList.contains('is-hatching')) return;
  const complete = onboardingStage === 'complete';
  const hatching = onboardingStage === 'hatch';
  const choosingDiet = onboardingStage === 'diet';
  const choosingPlatforms = onboardingStage === 'platforms';
  const creatingAccount = onboardingStage === 'account';
  const naming = hatching || nameMigrationRequired;
  const setupVisible = !complete || nameMigrationRequired;
  document.body.classList.toggle('is-setup', setupVisible);
  document.body.classList.toggle('is-onboarding-account', creatingAccount);
  document.getElementById('onboardingAccount').hidden = !creatingAccount || nameMigrationRequired;
  document.getElementById('onboardingFooter').hidden = !setupVisible;
  const progress = document.getElementById('onboardingProgress');
  progress.hidden = !setupVisible || nameMigrationRequired;
  const stepIndex = ['hatch', 'platforms', 'diet', 'account'].indexOf(onboardingStage);
  progress.querySelectorAll('[data-step]').forEach((step, index) => {
    step.classList.toggle('is-complete', index < stepIndex);
    if (index === stepIndex) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
    step.querySelector('.step-number').textContent = index < stepIndex ? '✓' : index + 1;
  });
  const settingsVisible = complete && detectorSettingsOpen && !leaderboardOpen && !historyOpen && !nameMigrationRequired;
  const homeVisible = complete && !settingsVisible && !leaderboardOpen && !historyOpen && !nameMigrationRequired;
  document.body.classList.toggle('is-onboarding-hatch', hatching);
  document.body.classList.toggle('is-onboarding-diet', choosingDiet);
  document.body.classList.toggle('is-onboarding-platforms', choosingPlatforms);
  document.body.classList.toggle('is-settings-open', settingsVisible);
  document.body.classList.toggle('is-home', homeVisible);
  document.body.classList.toggle('is-leaderboard', leaderboardOpen);
  document.body.classList.toggle('is-history', historyOpen);
  document.getElementById('historySection').hidden = !historyOpen;
  document.getElementById('onboardingFlow').hidden = complete && !nameMigrationRequired;
  document.getElementById('onboardingActions').hidden = (complete && !nameMigrationRequired) || creatingAccount;
  document.getElementById('onboardingTitle').textContent = nameMigrationRequired
    ? 'Every GomiMon needs a name.' : hatching
    ? 'Your egg is ready to hatch.' : choosingPlatforms ? 'Where should GomiMon eat?' : creatingAccount ? 'One last step.' : 'What’s on the menu?';
  document.getElementById('onboardingCopy').textContent = nameMigrationRequired
    ? 'Name your companion without changing any of their progress.' : hatching
    ? 'Name your companion, then tap to meet them.'
    : choosingPlatforms ? 'Choose the feeds your companion calls home.'
    : creatingAccount ? '' : 'Pick the posts GomiMon should eat, so you see less of them.';
  document.getElementById('onboardingNext').textContent = nameMigrationRequired
    ? 'Save name' : hatching ? 'Hatch my egg' : choosingPlatforms ? 'Choose diet' : 'Continue';
  document.getElementById('onboardingNext').disabled = onboardingBusy || onboardingStage === 'loading' ||
    (naming && !validatePetName(elements.onboardingPetName.value).valid);
  document.getElementById('onboardingTapCue').hidden = !hatching;
  elements.onboardingNameField.hidden = !naming;
  document.getElementById('onboardingCreature').hidden = nameMigrationRequired;
  const heroSprite = document.getElementById('onboardingCreatureSprite');
  const heroSource = creatingAccount ? 'assets/onboarding-account.png' : hatching ? 'assets/onboarding-egg.png' : getPetSprite('baby', 'idle');
  if (heroSprite.getAttribute('src') !== heroSource) heroSprite.src = heroSource;
  elements.petContainer.hidden = !homeVisible;
  elements.petState.hidden = settingsVisible || leaderboardOpen || historyOpen;
  document.querySelector('.stats-grid').hidden = !homeVisible;
  elements.feedSummary.hidden = !homeVisible;
  elements.consoleFooter.hidden = !homeVisible;
  elements.infoText.hidden = !homeVisible || !elements.infoText.textContent;
  elements.leaderboardOpen.hidden = !homeVisible;
  elements.leaderboardSection.hidden = !leaderboardOpen;
  elements.detectorSection.hidden = !choosingDiet && !choosingPlatforms && !settingsVisible;
  elements.platformControls.hidden = !choosingPlatforms && !settingsVisible;
  elements.detectorStatus.hidden = !settingsVisible;
  elements.detectorSignInButton.hidden = !settingsVisible || detectorSignedIn;
  elements.settingsButton.hidden = !homeVisible;
  elements.settingsButton.setAttribute('aria-expanded', String(settingsVisible));
  elements.settingsButton.setAttribute('aria-label', settingsVisible ? 'Close settings' : 'Open settings');
  elements.detectorTitle.textContent = settingsVisible ? 'Settings' : choosingPlatforms ? 'Platforms' : 'Choose a diet';
  elements.settingsCloseButton.hidden = !settingsVisible;
  document.getElementById('historyClose').hidden = !historyOpen;
  elements.leaderboardClose.hidden = !leaderboardOpen;
  elements.detectorOnboardingDismiss.hidden = !settingsVisible;
  elements.detectorOnboarding.hidden = !settingsVisible || !detectorOnboardingOpen;
  elements.detectorOnboardingOpen.hidden = detectorOnboardingOpen || !settingsVisible;
  elements.detectorCategoryControls.hidden = (!choosingDiet && !settingsVisible) || detectorOnboardingOpen;
  elements.detectorControls.hidden = !settingsVisible || detectorOnboardingOpen || !detectorSignedIn;
  elements.detectorDebugControl.hidden = !settingsVisible;
  elements.settingsDebugTools.hidden = !settingsVisible;
  elements.profileSettings.hidden = !settingsVisible;
  document.getElementById('settingsDetectorOptions').hidden = !settingsVisible || !detectorSignedIn;
  document.getElementById('settingsAdvanced').hidden = !settingsVisible;
  elements.detectorSignOutButton.hidden = !detectorSignedIn;
  elements.detectorDeleteButton.hidden = !detectorSignedIn;
  renderBilling();
}

function updateFilterSummary() {
  const selectedCount = elements.detectorCategoryInputs.filter(input => input.checked).length;
  if (selectedCount > 0) document.getElementById('onboardingNotice').hidden = true;
  if (selectedCount === 0) {
    elements.detectorFilterSummary.textContent = 'No filters selected — nothing is hidden.';
    elements.detectorFilterSummary.classList.remove('is-active');
    return;
  }

  const noun = selectedCount === 1 ? 'filter' : 'filters';
  elements.detectorFilterSummary.textContent = `${selectedCount} ${noun} selected — matching posts will be hidden.`;
  elements.detectorFilterSummary.classList.add('is-active');
}

function updateNameInputState() {
  const validation = validatePetName(elements.onboardingPetName.value);
  elements.onboardingNameHelp.textContent = validation.valid
    ? 'Looks good! This will be your companion’s name.'
    : validation.error;
  elements.onboardingNameHelp.style.color = '';
  elements.onboardingPetName.setAttribute('aria-invalid', String(Boolean(elements.onboardingPetName.value) && !validation.valid));
  if (onboardingStage !== 'loading' && (onboardingStage === 'hatch' || nameMigrationRequired)) {
    document.getElementById('onboardingNext').disabled = onboardingBusy || !validation.valid;
  }
}

async function initializeDetectorOnboarding() {
  const stored = await chrome.storage.local.get({ onboardingStage: null, evolution: 'egg', petName: '' });
  onboardingStage = stored.evolution === 'egg' ? 'hatch' : (stored.onboardingStage || 'complete');
  if (onboardingStage === 'filters') onboardingStage = 'diet';
  if (!['hatch', 'platforms', 'diet', 'account', 'complete'].includes(onboardingStage)) onboardingStage = 'platforms';
  nameMigrationRequired = stored.evolution !== 'egg' && !validatePetName(stored.petName).valid;
  if (validatePetName(stored.petName).valid) elements.onboardingPetName.value = stored.petName;
  await chrome.storage.local.set({ onboardingStage });
  renderDetectorSections();
  updateNameInputState();
  await finishOnboardingIfSignedIn();
}

async function advanceOnboarding() {
  if (onboardingBusy) return;
  onboardingBusy = true;
  document.getElementById('onboardingNotice').hidden = true;
  const button = document.getElementById('onboardingNext');
  button.disabled = true;
  try {
    if (nameMigrationRequired) {
      const validation = validatePetName(elements.onboardingPetName.value);
      if (!validation.valid) throw new Error(validation.error);
      await chrome.storage.local.set({ petName: validation.name });
      nameMigrationRequired = false;
      if (detectorSignedIn) {
        callBackground({ type: 'RESERVE_GOMIMON_NAME', name: validation.name })
          .then(response => {
            accountSnapshot = { ...(accountSnapshot || {}), gomimon: response.gomimon };
            updateProfileUI();
          })
          .catch(error => {
            elements.profileStatus.textContent = error.message;
          });
      }
      cachedStats = null;
      await updateUI();
    } else if (onboardingStage === 'hatch') {
      const validation = validatePetName(elements.onboardingPetName.value);
      if (!validation.valid) throw new Error(validation.error);
      await playHatchAnimation();
      await callBackground({ type: 'HATCH_PET', petName: validation.name });
      onboardingStage = 'platforms';
      cachedStats = null;
      await updateUI();
    } else if (onboardingStage === 'platforms') {
      if (!await handleDetectorSettingsChange()) return;
      onboardingStage = 'diet';
      await chrome.storage.local.set({ onboardingStage });
    } else if (onboardingStage === 'diet') {
      if (!elements.detectorCategoryInputs.some(input => input.checked)) {
        const notice = document.getElementById('onboardingNotice');
        notice.textContent = 'Choose at least one category to feed GomiMon.';
        notice.hidden = false;
        elements.detectorCategoryInputs[0]?.focus();
        return;
      }
      if (!await handleDetectorSettingsChange()) return;
      onboardingStage = 'account';
      await chrome.storage.local.set({ onboardingStage });
      await finishOnboardingIfSignedIn();
    }
    renderDetectorSections();
    document.querySelector('.container').scrollTop = 0;
    window.scrollTo(0, 0);
    if (onboardingStage !== 'complete') document.getElementById('onboardingTitle').focus();
  } catch (error) {
    showOnboardingError(error.message);
  } finally {
    onboardingBusy = false;
    button.disabled = false;
    updateNameInputState();
  }
}

function showOnboardingError(message) {
  const notice = document.getElementById('onboardingNotice');
  notice.textContent = message;
  notice.hidden = false;
}

function handleCategoryChange() {
  categoryDraft = true;
  updateFilterSummary();
  if (onboardingStage === 'complete') handleDetectorSettingsChange();
}

// Also runs on reopen: OAuth may finish after Chrome closes the popup.
async function finishOnboardingIfSignedIn() {
  if (onboardingStage !== 'account' || !detectorSignedIn || finishingOnboarding || nameMigrationRequired) return;
  finishingOnboarding = true;
  try {
    await chrome.storage.local.set({ onboardingStage: 'complete', detectorOnboardingSeen: true });
    onboardingStage = 'complete';
    renderDetectorSections();
    await updateUI();
  } finally {
    finishingOnboarding = false;
  }
}

async function handleOnboardingAccount(provider = 'google') {
  if (accountBusy) return;
  accountBusy = true;
  const button = document.getElementById(provider === 'apple' ? 'onboardingApple' : 'onboardingGoogle');
  const status = document.getElementById('onboardingAccountStatus');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.hidden = false;
  status.textContent = `Opening ${provider === 'apple' ? 'Apple' : 'Google'} sign-in…`;
  try {
    const signIn = await callBackground({ type: 'DETECTOR_SIGN_IN', provider });
    if (signIn.pending) {
      status.textContent = 'Finish signing in in the new Safari tab, then return to GomiMon.';
      return;
    }
    await updateDetectorUI();
    if (!detectorSignedIn) throw new Error('Sign-in was not completed. Please try again.');
    await finishOnboardingIfSignedIn();
    status.hidden = true;
    if (onboardingStage === 'complete') elements.settingsButton.focus();
  } catch (error) {
    status.textContent = error.message || 'Could not connect. Please try again.';
  } finally {
    accountBusy = false;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function playHatchAnimation() {
  const creature = document.getElementById('onboardingCreature');
  const button = document.getElementById('onboardingNext');
  const copy = document.getElementById('onboardingCopy');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const duration = reducedMotion ? 900 : 4800;
  const originalCopy = copy.textContent;
  elements.onboardingPetName.disabled = true;
  button.textContent = 'Hatching…';
  button.setAttribute('aria-busy', 'true');
  copy.textContent = reducedMotion ? 'Your companion is here!' : 'Someone inside is waking up…';
  creature.classList.toggle('is-hatch-quiet', Boolean(reducedMotion));
  creature.classList.add('is-hatching');
  const revealTimer = reducedMotion ? null : window.setTimeout(() => {
    copy.textContent = 'Hello, ' + elements.onboardingPetName.value.trim() + '!';
  }, 3200);
  try {
    await new Promise(resolve => window.setTimeout(resolve, duration));
  } finally {
    window.clearTimeout(revealTimer);
    creature.classList.remove('is-hatching', 'is-hatch-quiet');
    elements.onboardingPetName.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Hatch my egg';
    copy.textContent = originalCopy;
  }
}

async function resetOnboarding() {
  const button = document.getElementById('resetOnboarding');
  button.disabled = true;
  try {
    await callBackground({ type: 'RESET_ONBOARDING' });
    platformDraft = false;
    categoryDraft = false;
    onboardingStage = 'hatch';
    nameMigrationRequired = false;
    elements.onboardingPetName.value = '';
    updateNameInputState();
    detectorOnboardingOpen = false;
    detectorSettingsOpen = false;
    cachedStats = null;
    await updateUI();
    await updateDetectorUI();
    renderDetectorSections();
    document.querySelector('.container').scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (error) {
    document.getElementById('resetStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function dismissDetectorOnboarding() {
  detectorOnboardingOpen = false;
  renderDetectorSections();
  try {
    await chrome.storage.local.set({ detectorOnboardingSeen: true });
  } catch (error) {
    console.warn('[GomiMon Popup] Could not save detector onboarding state:', error);
  }
  elements.detectorCategoryInputs[0]?.focus();
}

function openDetectorOnboarding() {
  detectorOnboardingOpen = true;
  renderDetectorSections();
  elements.detectorOnboarding.querySelector('button')?.focus();
}

function openDetectorSettings() {
  detectorSettingsOpen = true;
  detectorOnboardingOpen = false;
  renderDetectorSections();
  document.querySelector('.container').scrollTop = 0;
  window.scrollTo(0, 0);
  elements.settingsCloseButton.focus();
}

function closeDetectorSettings() {
  detectorSettingsOpen = false;
  detectorOnboardingOpen = false;
  renderDetectorSections();
  elements.settingsButton.focus();
}

function callBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.success && response?.error) {
        const error = new Error(response.error.message || response.error);
        if (response.error && typeof response.error === 'object') {
          Object.assign(error, response.error);
        }
        reject(error);
        return;
      }
      resolve(response || { success: true });
    });
  });
}

function renderBilling() {
  const box = document.getElementById('billingSettings');
  if (SAFARI_RELEASE) { box.hidden = true; return; }
  if (!box) return;
  box.hidden = !detectorSettingsOpen || !detectorSignedIn;
  const billing = accountSnapshot?.billing;
  const plan = document.getElementById('billingPlan');
  const description = document.getElementById('billingDescription');
  const upgrade = document.getElementById('billingUpgrade');
  const manage = document.getElementById('billingManage');
  const refresh = document.getElementById('billingRefresh');
  const hasSubscription = billing?.status && !['none', 'canceled', 'incomplete_expired'].includes(billing.status);
  const serverFull = accountSnapshot?.quotaBlock?.scope === 'server';
  plan.textContent = billing?.plan === 'plus' ? 'GomiMon Plus' : 'Free';
  upgrade.hidden = !billing?.available || hasSubscription || serverFull || billing?.deleting;
  manage.hidden = !billing?.available || !billing.hasCustomer || billing.deleting;
  refresh.hidden = !billing?.available;
  description.textContent = !billing?.available ? 'Plus is coming soon: 10,000 checks/day for $9.99 USD/month.'
    : serverFull ? 'The detector service is at capacity. Checks resume after the daily reset.'
    : billing.deleting ? 'Account deletion is in progress. Retry Delete detector account to finish.'
    : billing.cancelAtPeriodEnd ? `Plus ends ${new Date(billing.paidThrough).toLocaleDateString()}. You can manage your cancellation below.`
    : billing.graceDeadline ? (billing.plan === 'plus'
      ? `Renewal payment failed. Update your payment method by ${new Date(billing.graceDeadline).toLocaleString()} to keep Plus.`
      : 'Renewal payment failed. Free limits apply until payment succeeds.')
    : hasSubscription && billing.plan !== 'plus' ? 'Payment is pending or your paid access has ended. Manage billing or refresh your plan.'
    : billing.plan === 'plus' ? '10,000 checks each day. $9.99 USD/month. Cancel anytime.'
    : 'Get 10,000 checks each day with Plus for $9.99 USD/month. Cancel anytime.';
  if (billing?.available && billing.mode === 'test') description.textContent += ' Test mode — no real charges.';
}

async function handleBillingAction(action) {
  const status = document.getElementById('billingStatus');
  const buttons = [...document.querySelectorAll('.billing-actions button')];
  buttons.forEach(button => { button.disabled = true; });
  status.textContent = action === 'REFRESH' ? 'Refreshing your plan…' : 'Opening billing…';
  try {
    await callBackground({ type: `BILLING_${action}` });
    await updateDetectorUI();
    status.textContent = action === 'REFRESH' ? 'Plan refreshed.' : 'Finish in the new tab, then return here. If your plan is still updating, select Refresh plan.';
  } catch (error) {
    status.textContent = error.message || 'Billing is unavailable. Try again.';
  } finally { buttons.forEach(button => { button.disabled = false; }); }
}

function formatResetTime(resetAt) {
  if (!resetAt) return '';
  const reset = new Date(resetAt);
  return Number.isNaN(reset.getTime()) ? '' : ` Resets ${reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
}

async function updateDetectorUI() {
  try {
    const response = await callBackground({ type: 'GET_DETECTOR_ACCOUNT' });
    accountSnapshot = response;
    const settings = response.settings || {};
    if (!platformDraft) {
      const selectedPlatforms = new Set(PLATFORMS.normalize(settings.enabledPlatforms));
      elements.platformInputs.forEach(input => { input.checked = selectedPlatforms.has(input.dataset.platform); });
    }
    detectorSignedIn = Boolean(response.signedIn);
    if (SAFARI_RELEASE) {
      const release = await callBackground({ type: 'GET_RELEASE_ACCOUNT' });
      releaseConsent = release.consent; linkedProviders = release.providers || [];
      renderSafariRelease();
    }
    await finishOnboardingIfSignedIn();
    await updateProfileUI();
    if (!categoryDraft) {
      elements.showEatingAnimations.checked = settings.showEatingAnimations !== false;
      elements.detectorCategoryStrength.value = settings.categoryStrength || 'balanced';
      const selectedCategories = new Set(Array.isArray(settings.categories) ? settings.categories : []);
      elements.detectorCategoryInputs.forEach(input => {
        input.checked = selectedCategories.has(input.dataset.detectorCategory);
      });
    }
    elements.detectorDebug.checked = settings.debug === true;
    updateFilterSummary();
    if (!response.signedIn) {
      elements.detectorStatus.textContent = 'Ads are detected locally. Sign in to use semantic filters and the AI detector.';
      elements.detectorSignInButton.hidden = false;
      renderDetectorSections();
      return;
    }

    const quota = response.quota || {};
    const email = response.account?.email || 'Signed in';
    elements.detectorStatus.textContent = `${email}: ${quota.remaining ?? 0}/${quota.limit ?? 1000} checks left today.${formatResetTime(quota.resetAt)}`;
    elements.detectorSignInButton.hidden = true;
    elements.detectorMode.value = settings.mode || 'manual';
    elements.detectorSensitivity.value = settings.sensitivity || 'strict';
    renderDetectorSections();
  } catch (error) {
    accountSnapshot = null;
    detectorSignedIn = false;
    elements.detectorStatus.textContent = 'Detector service unavailable. Try again later.';
    renderDetectorSections();
  }
}

async function handleDetectorSignIn(provider = 'google') {
  elements.detectorSignInButton.disabled = true;
  elements.detectorStatus.textContent = `Opening ${provider === 'apple' ? 'Apple' : 'Google'} sign-in…`;
  try {
    const signIn = await callBackground({ type: 'DETECTOR_SIGN_IN', provider });
    if (signIn.pending) {
      elements.detectorStatus.textContent = 'Finish signing in in the new Safari tab, then return to GomiMon.';
      return;
    }
    await updateDetectorUI();
  } catch (error) {
    elements.detectorStatus.textContent = error.message || 'Sign-in failed.';
  } finally {
    elements.detectorSignInButton.disabled = false;
  }
}

async function handleDetectorSignOut() {
  try {
    await callBackground({ type: 'DETECTOR_SIGN_OUT' });
    await updateDetectorUI();
  } catch (error) {
    elements.detectorStatus.textContent = error.message || 'Sign-out failed.';
  }
}

async function handleDetectorDelete() {
  if (!window.confirm('Delete your GomiMon account, detector results, reserved name, and leaderboard progress? Any subscription will be canceled immediately and remaining paid access will end. No automatic refund is issued.')) return;
  try {
    const deletion = await callBackground({ type: 'DETECTOR_DELETE_ACCOUNT' });
    await updateDetectorUI();
    elements.detectorStatus.textContent = deletion.appleRevocationPending ? 'Account deleted. Apple authorization revocation is pending and will be retried automatically.' : 'Account deleted.';
  } catch (error) {
    elements.detectorStatus.textContent = error.message || 'Account deletion failed.';
  }
}

async function handleDetectorSettingsChange() {
  const enabledPlatforms = elements.platformInputs.filter(input => input.checked).map(input => input.dataset.platform);
  elements.platformNotice.hidden = enabledPlatforms.length > 0;
  if (enabledPlatforms.length === 0) {
    elements.platformNotice.textContent = 'Choose at least one platform.';
    return false;
  }
  try {
    const response = await callBackground({
      type: 'SET_DETECTOR_SETTINGS',
      settings: {
        enabledPlatforms,
        mode: elements.detectorMode.value,
        sensitivity: elements.detectorSensitivity.value,
        categoryStrength: elements.detectorCategoryStrength.value,
        debug: elements.detectorDebug.checked,
        showEatingAnimations: elements.showEatingAnimations.checked,
        categories: elements.detectorCategoryInputs
          .filter(input => input.checked)
          .map(input => input.dataset.detectorCategory)
      }
    });
    platformDraft = false;
    categoryDraft = false;
    if (response.settings) {
      elements.showEatingAnimations.checked = response.settings.showEatingAnimations !== false;
      elements.detectorMode.value = response.settings.mode;
      elements.detectorSensitivity.value = response.settings.sensitivity;
      elements.detectorCategoryStrength.value = response.settings.categoryStrength;
      elements.detectorDebug.checked = response.settings.debug === true;
      const selectedCategories = new Set(response.settings.categories || []);
      elements.detectorCategoryInputs.forEach(input => {
        input.checked = selectedCategories.has(input.dataset.detectorCategory);
      });
      updateFilterSummary();
    }
    return true;
  } catch (error) {
    elements.detectorStatus.textContent = error.message || 'Could not save detector settings.';
    if (onboardingStage !== 'complete') showOnboardingError(elements.detectorStatus.textContent);
    return false;
  }
}

async function updateProfileUI() {
  const stats = sanitizeStats(await chrome.storage.local.get(DEFAULT_STATS));
  const stored = await chrome.storage.local.get({ leaderboardStateV1: {} });
  const localLeaderboard = stored.leaderboardStateV1 || {};
  const profile = accountSnapshot?.gomimon || null;
  if (!profileNameDraft) elements.profileNameInput.value = stats.petName || profile?.name || '';
  const reservedWhileSignedOut = !detectorSignedIn && Boolean(localLeaderboard.profileName);
  elements.profileNameInput.disabled = reservedWhileSignedOut;
  elements.profileNameSave.disabled = reservedWhileSignedOut;
  if (accountSnapshot?.nameError) {
    elements.profileStatus.textContent = accountSnapshot.nameError.message;
  } else if (profile?.name) {
    elements.profileStatus.textContent = profile.leaderboardEnabled
      ? 'Reserved and visible on the leaderboard.'
      : 'Reserved. Join the leaderboard to make it public.';
  } else if (reservedWhileSignedOut) {
    elements.profileStatus.textContent = 'Sign in to rename this reserved GomiMon.';
  } else {
    elements.profileStatus.textContent = detectorSignedIn
      ? 'Save to reserve this name globally.'
      : 'This name is stored only in this browser.';
  }
  const enabled = profile?.leaderboardEnabled === true;
  elements.leaderboardJoin.hidden = enabled;
  elements.leaderboardJoin.textContent = detectorSignedIn ? 'Join leaderboard' : 'Sign in to join';
  elements.leaderboardLeave.hidden = !enabled;
}

function createLeaderboardRow(entry, { mine = false } = {}) {
  const row = document.createElement('div');
  row.className = `leaderboard-row${entry.rank <= 3 ? ' is-top-three' : ''}`;
  const rank = document.createElement('span');
  rank.className = 'leaderboard-rank';
  rank.textContent = `#${entry.rank}`;
  const sprite = document.createElement('img');
  sprite.className = 'leaderboard-sprite';
  sprite.src = getPetSprite(entry.evolution, 'idle');
  sprite.alt = '';
  const identity = document.createElement('span');
  identity.className = 'leaderboard-name';
  identity.textContent = entry.name;
  const species = document.createElement('span');
  species.className = 'leaderboard-species';
  species.textContent = `${mine ? 'Your GomiMon · ' : ''}${EVOLUTION_NAMES[entry.evolution] || 'GomiMon'}`;
  identity.appendChild(species);
  const meals = document.createElement('span');
  meals.className = 'leaderboard-meals';
  meals.textContent = `${entry.meals} ${entry.meals === 1 ? 'meal' : 'meals'}`;
  row.append(rank, sprite, identity, meals);
  return row;
}

async function loadLeaderboard() {
  elements.leaderboardStatus.textContent = 'Loading standings…';
  elements.leaderboardList.replaceChildren();
  elements.leaderboardMe.replaceChildren();
  elements.leaderboardMe.hidden = true;
  elements.leaderboardWeekly.setAttribute('aria-selected', String(leaderboardPeriod === 'weekly'));
  elements.leaderboardAllTime.setAttribute('aria-selected', String(leaderboardPeriod === 'all_time'));
  try {
    const response = await callBackground({ type: 'GET_LEADERBOARD', period: leaderboardPeriod });
    const entries = Array.isArray(response.entries) ? response.entries : [];
    for (const entry of entries) {
      const item = document.createElement('li');
      item.appendChild(createLeaderboardRow(entry));
      elements.leaderboardList.appendChild(item);
    }
    elements.leaderboardStatus.textContent = entries.length === 0
      ? 'No ranked GomiMons yet. The first meal can take the lead.'
      : leaderboardPeriod === 'weekly'
        ? 'This week resets Monday at 00:00 UTC.'
        : 'Lifetime meals, including imported progress.';
    if (response.me) {
      elements.leaderboardMe.appendChild(createLeaderboardRow(response.me, { mine: true }));
      elements.leaderboardMe.hidden = false;
    }
    await updateProfileUI();
  } catch (error) {
    elements.leaderboardStatus.textContent = 'Standings are offline. Try again in a moment.';
  }
}

async function renderSlopHistory() {
  const list = document.getElementById('historyList');
  const status = document.getElementById('historyStatus');
  try {
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [], feedCount: 0 });
    const entries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    document.getElementById('historyTotal').textContent = stored.feedCount || 0;
    list.replaceChildren();
    status.textContent = entries.length ? '' : stored.feedCount
      ? 'New meals will appear here. Earlier meals are included in your total, but their details weren’t saved.'
      : 'Nothing consumed yet. Feed your GomiMon to start its meal diary.';
    document.getElementById('historyClear').hidden = !entries.length;
    for (const entry of entries) {
      const card = document.createElement('li');
      const header = document.createElement('div');
      header.className = 'history-card-header';
      const platform = document.createElement('strong');
      platform.textContent = entry.platform === 'reddit' ? 'Reddit' : entry.platform === 'x' ? 'X' : entry.platform || 'Web';
      const mode = document.createElement('span');
      mode.className = 'history-mode' + (entry.source === 'manual' ? ' is-manual' : '');
      mode.textContent = entry.source === 'manual' ? 'Manual' : 'Automatic';
      header.append(platform, mode);
      const excerpt = document.createElement('p');
      excerpt.textContent = entry.excerpt || 'Slop consumed — no text preview available.';
      const time = document.createElement('time');
      const date = new Date(entry.consumedAt);
      if (!Number.isNaN(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
      const categories = document.createElement('div');
      categories.className = 'history-categories';
      const labels = (Array.isArray(entry.categories) ? entry.categories : [])
        .filter(id => Object.hasOwn(HISTORY_CATEGORY_LABELS, id)).map(id => HISTORY_CATEGORY_LABELS[id]);
      for (const label of labels.length ? labels : ['Category not recorded']) {
        const badge = document.createElement('span');
        badge.textContent = label;
        categories.append(badge);
      }
      card.append(header, categories, excerpt, time);
      list.append(card);
    }
  } catch {
    status.textContent = 'Could not load history. Close and reopen to try again.';
  }
}

async function openSlopHistory() {
  historyOpen = true;
  leaderboardOpen = false;
  detectorSettingsOpen = false;
  renderDetectorSections();
  document.querySelector('.container').scrollTop = 0;
  document.getElementById('historyClose').focus();
  await renderSlopHistory();
}

async function clearSlopHistory() {
  if (!window.confirm('Clear saved meal history? Your Slop total and pet progress will stay.')) return;
  const button = document.getElementById('historyClear');
  button.disabled = true;
  try {
    await callBackground({ type: 'CLEAR_SLOP_HISTORY' });
    await renderSlopHistory();
    document.getElementById('historyClose').focus();
  } catch {
    document.getElementById('historyStatus').textContent = 'Could not clear history. Try again.';
  } finally { button.disabled = false; }
}

function openLeaderboard() {
  leaderboardOpen = true;
  detectorSettingsOpen = false;
  renderDetectorSections();
  window.scrollTo(0, 0);
  document.querySelector('.container').scrollTop = 0;
  loadLeaderboard();
  elements.leaderboardClose.focus();
}

function closeLeaderboard() {
  leaderboardOpen = false;
  renderDetectorSections();
  elements.leaderboardOpen.focus();
}

async function handleLeaderboardJoin() {
  elements.leaderboardJoin.disabled = true;
  elements.leaderboardStatus.textContent = detectorSignedIn
    ? 'Joining leaderboard…'
    : 'Opening Google sign-in…';
  try {
    if (!detectorSignedIn) {
      const signIn = await callBackground({ type: 'DETECTOR_SIGN_IN' });
      if (signIn.pending) {
        elements.leaderboardStatus.textContent = 'Finish signing in in Safari, then open the leaderboard to join.';
        return;
      }
      await updateDetectorUI();
    }
    const response = await callBackground({ type: 'JOIN_LEADERBOARD' });
    accountSnapshot = { ...(accountSnapshot || {}), signedIn: true, gomimon: response.gomimon };
    await updateProfileUI();
    await loadLeaderboard();
  } catch (error) {
    elements.leaderboardStatus.textContent = error.message || 'Could not join the leaderboard.';
  } finally {
    elements.leaderboardJoin.disabled = false;
  }
}

async function handleLeaderboardLeave() {
  if (!window.confirm('Leave the leaderboard? Your score and reserved name will be kept.')) return;
  elements.leaderboardLeave.disabled = true;
  try {
    const response = await callBackground({ type: 'LEAVE_LEADERBOARD' });
    accountSnapshot = { ...(accountSnapshot || {}), gomimon: response.gomimon };
    await updateProfileUI();
    await loadLeaderboard();
  } catch (error) {
    elements.leaderboardStatus.textContent = error.message || 'Could not leave the leaderboard.';
  } finally {
    elements.leaderboardLeave.disabled = false;
  }
}

async function handleProfileNameSave() {
  const validation = validatePetName(elements.profileNameInput.value);
  if (!validation.valid) {
    elements.profileStatus.textContent = validation.error;
    return;
  }
  elements.profileNameSave.disabled = true;
  elements.profileStatus.textContent = detectorSignedIn ? 'Checking name…' : 'Saving locally…';
  try {
    if (detectorSignedIn) {
      const response = await callBackground({ type: 'RESERVE_GOMIMON_NAME', name: validation.name });
      accountSnapshot = { ...(accountSnapshot || {}), gomimon: response.gomimon };
    } else {
      await chrome.storage.local.set({ petName: validation.name });
    }
    profileNameDraft = false;
    cachedStats = null;
    await updateUI();
    await updateProfileUI();
    elements.profileStatus.textContent = detectorSignedIn
      ? 'Name reserved.'
      : 'Name saved in this browser.';
  } catch (error) {
    elements.profileStatus.textContent = error.message || 'Could not save that name.';
  } finally {
    elements.profileNameSave.disabled = false;
  }
}

// Update the UI with current stats
async function updateUI() {
  try {
    // Get stats with defaults
    const rawStats = await chrome.storage.local.get(DEFAULT_STATS);
    const stats = sanitizeStats(rawStats);
    const customName = stats.petName || (stats.evolution === 'egg' ? 'Egg' : 'GomiMon');

    // Check if stats changed (avoid unnecessary DOM updates)
    const statsString = JSON.stringify(stats);
    if (statsString === cachedStats) {
      return; // No changes
    }
    cachedStats = statsString;
    elements.debugPetForm.value = stats.evolution;
    const previousPetStats = renderedPetStats;
    renderedPetStats = { evolution: stats.evolution, feedCount: stats.feedCount };
    clearTimeout(petAnimationTimer);

    // Keep feeding history visible even when the companion needs attention.
    document.getElementById('feedCount').textContent = stats.feedCount || 0;
    elements.infoText.textContent = '';

    // Update hunger bar
    elements.hungerBar.style.width = `${stats.hunger}%`;
    elements.hungerBar.setAttribute('aria-valuenow', stats.hunger);
    elements.hungerValue.textContent = stats.hunger;
    elements.hungerState.textContent = stats.hunger < LOW_HUNGER_THRESHOLD ? 'LOW' : 'READY TO EAT';

    // Update glitch bar
    elements.glitchBar.style.width = `${stats.glitch}%`;
    elements.glitchBar.setAttribute('aria-valuenow', stats.glitch);
    elements.glitchValue.textContent = stats.glitch;
    elements.glitchState.textContent = stats.glitch > HIGH_GLITCH_THRESHOLD ? 'WATCH' : 'ALL CLEAR';

    // Check for crashed state
    if (stats.glitch >= GLITCH_CRASH_THRESHOLD) {
      elements.petContainer.classList.add('crashed');
      const evolution = stats.evolution || 'egg';
      const spriteUrl = getPetSprite(evolution, 'crashed');
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="Crashed pet" />`;
      elements.rebootButton.style.display = 'block';
      elements.infoText.textContent = '⚠️ SYSTEM ERROR: GomiMon has crashed!';
      elements.petName.textContent = customName;
      elements.hungerState.textContent = 'PAUSED';
      elements.glitchState.textContent = 'CRASHED';
    }
    // Check for starved state
    else if (stats.hunger === 0) {
      elements.petContainer.classList.remove('crashed');
      const evolution = stats.evolution || 'egg';
      const spriteUrl = getPetSprite(evolution, 'starved');
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="Starved pet" />`;
      elements.rebootButton.style.display = 'none';
      elements.infoText.textContent = '💀 Your GomiMon is starving! Feed it some slop!';
      elements.petName.textContent = customName;
      elements.hungerState.textContent = 'EMPTY';
    }
    // Normal state
    else {
      elements.petContainer.classList.remove('crashed');
      elements.rebootButton.style.display = 'none';


      // Determine evolution
      const evolution = stats.evolution || 'egg';

      let animation = 'idle';
      if (PET_SPRITES[evolution]?.celebrate) {
        if (previousPetStats && previousPetStats.evolution !== evolution) {
          animation = 'celebrate';
        } else if (previousPetStats && stats.feedCount > previousPetStats.feedCount) {
          animation = 'eat';
        } else if (stats.glitch > HIGH_GLITCH_THRESHOLD) {
          animation = 'sleep';
        }
      }
      const spriteUrl = getPetSprite(evolution, animation);
      const spriteName = EVOLUTION_NAMES[evolution] || 'GomiMon';
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="${spriteName}" />`;
      if (animation === 'celebrate' || animation === 'eat') {
        petAnimationTimer = setTimeout(() => {
          cachedStats = null;
          updateUI();
        }, animation === 'celebrate' ? 1800 : 1200);
      }

      // Update pet name
      elements.petName.textContent = customName || spriteName;

      if (stats.hunger < LOW_HUNGER_THRESHOLD) {
        elements.infoText.textContent = 'Getting hungry! Find some slop to feed your GomiMon.';
      } else if (stats.glitch > HIGH_GLITCH_THRESHOLD) {
        elements.infoText.textContent = 'High glitch level! Let your GomiMon rest a little.';
      }

    }
    elements.infoText.hidden = !document.body.classList.contains('is-home') || !elements.infoText.textContent;
  } catch (error) {
    console.error('[GomiMon Popup] Error updating UI:', error);

    // Show error state
    if (elements.infoText) {
      elements.infoText.textContent = 'Error loading pet data';
      elements.infoText.hidden = !document.body.classList.contains('is-home');
    }
  }
}

async function handleDebugPetFormChange() {
  const evolution = elements.debugPetForm.value;
  if (!Object.hasOwn(EVOLUTION_NAMES, evolution)) return;
  elements.debugPetForm.disabled = true;
  elements.debugPetFormStatus.textContent = '';
  try {
    await chrome.storage.local.set({ evolution });
    cachedStats = null;
    await updateUI();
    elements.debugPetFormStatus.textContent = `Switched to ${EVOLUTION_NAMES[evolution]}.`;
  } catch (error) {
    elements.debugPetFormStatus.textContent = 'Could not switch pet form. Try again.';
    cachedStats = null;
    await updateUI();
  } finally {
    elements.debugPetForm.disabled = false;
  }
}

// Handle reboot button click
async function handleReboot() {
  try {
    // Get current stats
    const stats = await chrome.storage.local.get(DEFAULT_STATS);

    // Reset glitch to 0
    await chrome.storage.local.set({
      ...stats,
      glitch: 0,
      lastUpdate: Date.now()
    });

    // Force cache invalidation
    cachedStats = null;

    // Update UI immediately
    await updateUI();
  } catch (error) {
    console.error('[GomiMon Popup] Error rebooting:', error);
  }
}

// Initialize popup
function initialize() {
  // Toolbar popups need a fixed intrinsic size; onboarding/auth tabs need a
  // full viewport canvas. getCurrent is undefined outside an extension tab.
  if (chrome.tabs?.getCurrent) {
    chrome.tabs.getCurrent().then(tab => {
      document.documentElement.classList.toggle('is-extension-tab', Boolean(tab));
    }).catch(() => {});
  }

  try {
    // Cache DOM elements
    cacheElements();
    if (SAFARI_RELEASE) {
      document.getElementById('onboardingApple').addEventListener('click', () => handleOnboardingAccount('apple'));
      document.getElementById('detectorAppleSignIn').addEventListener('click', () => handleDetectorSignIn('apple'));
      document.getElementById('linkApple').addEventListener('click', () => linkSafariProvider('apple'));
      document.getElementById('linkGoogle').addEventListener('click', () => linkSafariProvider('google'));
      document.getElementById('allowAI').addEventListener('click', () => changeAIConsent(true));
      document.getElementById('declineAI').addEventListener('click', () => changeAIConsent(false));
      document.getElementById('withdrawAI').addEventListener('click', () => changeAIConsent(false));
      document.getElementById('onboardingLocal').addEventListener('click', async () => {
        await chrome.storage.local.set({ onboardingStage: 'complete', detectorOnboardingSeen: true });
        onboardingStage = 'complete'; renderDetectorSections(); await updateUI();
      });
    }


    document.getElementById('onboardingNext').addEventListener('click', advanceOnboarding);
    elements.onboardingPetName.addEventListener('input', updateNameInputState);
    document.getElementById('resetOnboarding').addEventListener('click', resetOnboarding);
    // Set up reboot button listener
    elements.rebootButton.addEventListener('click', handleReboot);

    elements.leaderboardOpen.addEventListener('click', openLeaderboard);
    elements.leaderboardClose.addEventListener('click', closeLeaderboard);
    document.getElementById('historyOpen').addEventListener('click', openSlopHistory);
    document.getElementById('historyClear').addEventListener('click', clearSlopHistory);
    document.getElementById('historyClose').addEventListener('click', () => {
      historyOpen = false;
      renderDetectorSections();
      document.getElementById('historyOpen').focus();
    });
    elements.leaderboardWeekly.addEventListener('click', () => {
      leaderboardPeriod = 'weekly';
      loadLeaderboard();
    });
    elements.leaderboardAllTime.addEventListener('click', () => {
      leaderboardPeriod = 'all_time';
      loadLeaderboard();
    });
    elements.leaderboardJoin.addEventListener('click', handleLeaderboardJoin);
    elements.leaderboardLeave.addEventListener('click', handleLeaderboardLeave);
    elements.profileNameSave.addEventListener('click', handleProfileNameSave);
    elements.profileNameInput.addEventListener('input', () => { profileNameDraft = true; });
    elements.detectorSignInButton.addEventListener('click', () => handleDetectorSignIn());
    document.getElementById('onboardingGoogle').addEventListener('click', () => handleOnboardingAccount());
    elements.detectorOnboardingDismiss.addEventListener('click', dismissDetectorOnboarding);
    elements.detectorOnboardingOpen.addEventListener('click', openDetectorOnboarding);
    elements.settingsButton.addEventListener('click', () => {
      if (detectorSettingsOpen) closeDetectorSettings();
      else openDetectorSettings();
    });
    elements.settingsCloseButton.addEventListener('click', closeDetectorSettings);
    elements.detectorSignOutButton.addEventListener('click', handleDetectorSignOut);
    elements.detectorDeleteButton.addEventListener('click', handleDetectorDelete);
    document.getElementById('billingUpgrade').addEventListener('click', () => handleBillingAction('CHECKOUT'));
    document.getElementById('billingManage').addEventListener('click', () => handleBillingAction('PORTAL'));
    document.getElementById('billingRefresh').addEventListener('click', () => handleBillingAction('REFRESH'));
    window.addEventListener('focus', () => updateDetectorUI());
    elements.detectorMode.addEventListener('change', handleDetectorSettingsChange);
    elements.detectorSensitivity.addEventListener('change', handleDetectorSettingsChange);
    elements.detectorCategoryStrength.addEventListener('change', handleCategoryChange);
    elements.showEatingAnimations.addEventListener('change', handleCategoryChange);
    elements.detectorDebug.addEventListener('change', handleDetectorSettingsChange);
    elements.debugPetForm.addEventListener('change', handleDebugPetFormChange);
    elements.detectorCategoryInputs.forEach(input => {
      input.addEventListener('change', handleCategoryChange);
    });
    elements.platformInputs.forEach(input => {
      input.addEventListener('change', () => {
        platformDraft = true;
        elements.platformNotice.hidden = elements.platformInputs.some(option => option.checked);
        if (onboardingStage === 'complete') handleDetectorSettingsChange();
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && detectorSettingsOpen) closeDetectorSettings();
      else if (event.key === 'Escape' && leaderboardOpen) closeLeaderboard();
    });

    // Initial update
    renderDetectorSections();
    initializeDetectorOnboarding();
    updateUI();
    updateDetectorUI();
    updateNameInputState();

    // Listen for storage changes instead of polling
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        if (historyOpen) renderSlopHistory();
        if (changes.onboardingStage) {
          onboardingStage = changes.onboardingStage.newValue;
          renderDetectorSections();
        }
        // Force cache invalidation when storage changes
        cachedStats = null;
        updateUI();
      }
    });

    // Fallback: Update every 5 seconds (less aggressive than before)
    setInterval(() => {
      // Only update if popup is visible
      if (document.visibilityState === 'visible') {
        updateUI();
        updateDetectorUI();
      }
    }, 5000);

  } catch (error) {
    console.error('[GomiMon Popup] Initialization error:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
