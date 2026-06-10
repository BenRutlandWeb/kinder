const STORAGE_KEY = "babynames-user";
const SURNAME_STORAGE_KEY = "babynames-surname";

const state = {
  userId: null,
  email: null,
  name: null,
  linked: false,
  partnerName: null,
  pendingInviteUrl: null,
  currentName: null,
  surname: "",
  busy: false,
  drag: null,
  inviteToken: null,
  activeTab: "home",
  searchTimer: null,
  matchedNames: new Set(),
};

const SWIPE_THRESHOLD = 80;
const STATUS_YES = 1;
const STATUS_NO = 2;

const els = {
  signInScreen: document.getElementById("sign-in-screen"),
  signInForm: document.getElementById("sign-in-form"),
  emailInput: document.getElementById("email-input"),
  signInError: document.getElementById("sign-in-error"),
  inviteScreen: document.getElementById("invite-screen"),
  inviteForm: document.getElementById("invite-form"),
  inviteNameInput: document.getElementById("invite-name-input"),
  inviteEmailInput: document.getElementById("invite-email-input"),
  inviteInviter: document.getElementById("invite-inviter"),
  inviteError: document.getElementById("invite-error"),
  inviteSkipBtn: document.getElementById("invite-skip-btn"),
  app: document.getElementById("app"),
  displayNameInput: document.getElementById("display-name-input"),
  signOutBtn: document.getElementById("sign-out-btn"),
  partnerLinked: document.getElementById("partner-linked"),
  partnerName: document.getElementById("partner-name"),
  unlinkBtn: document.getElementById("unlink-btn"),
  partnerPending: document.getElementById("partner-pending"),
  invitePartnerSection: document.getElementById("invite-partner-section"),
  shareInviteBtn: document.getElementById("share-invite-btn"),
  reshareBtn: document.getElementById("reshare-btn"),
  inviteFeedback: document.getElementById("invite-feedback"),
  surnameInput: document.getElementById("surname-input"),
  card: document.getElementById("name-card"),
  nameText: document.getElementById("name-text"),
  nameSurname: document.getElementById("name-surname"),
  nameRank: document.getElementById("name-rank"),
  genderBadge: document.getElementById("gender-badge"),
  emptyState: document.getElementById("empty-state"),
  loadingState: document.getElementById("loading-state"),
  dislikeBtn: document.getElementById("dislike-btn"),
  likeBtn: document.getElementById("like-btn"),
  matchesHint: document.getElementById("matches-hint"),
  matchesColumns: document.getElementById("matches-columns"),
  matchesBoysList: document.getElementById("matches-boys-list"),
  matchesGirlsList: document.getElementById("matches-girls-list"),
  noMatchesBoys: document.getElementById("no-matches-boys"),
  noMatchesGirls: document.getElementById("no-matches-girls"),
  noMatches: document.getElementById("no-matches"),
  picksColumns: document.getElementById("picks-columns"),
  picksBoysList: document.getElementById("picks-boys-list"),
  picksGirlsList: document.getElementById("picks-girls-list"),
  noPicksBoys: document.getElementById("no-picks-boys"),
  noPicksGirls: document.getElementById("no-picks-girls"),
  noPicks: document.getElementById("no-picks"),
  clearPicksBtn: document.getElementById("clear-picks-btn"),
  deleteAccountBtn: document.getElementById("delete-account-btn"),
  settingsActions: document.querySelector(".settings-actions"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmDialogTitle: document.getElementById("confirm-dialog-title"),
  confirmDialogMessage: document.getElementById("confirm-dialog-message"),
  confirmDialogCancel: document.getElementById("confirm-dialog-cancel"),
  confirmDialogConfirm: document.getElementById("confirm-dialog-confirm"),
  recommendSection: document.getElementById("recommend-section"),
  recommendHeading: document.getElementById("recommend-heading"),
  recommendHint: document.getElementById("recommend-hint"),
  recommendForm: document.getElementById("recommend-form"),
  recommendInput: document.getElementById("recommend-input"),
  recommendBtn: document.getElementById("recommend-btn"),
  recommendBtnLabel: document.getElementById("recommend-btn-label"),
  recommendSuggestions: document.getElementById("recommend-suggestions"),
  recommendFeedback: document.getElementById("recommend-feedback"),
  sentRecommendations: document.getElementById("sent-recommendations"),
  sentRecommendationsHeading: document.getElementById("sent-recommendations-heading"),
  sentBoysList: document.getElementById("sent-boys-list"),
  sentGirlsList: document.getElementById("sent-girls-list"),
  noSentBoys: document.getElementById("no-sent-boys"),
  noSentGirls: document.getElementById("no-sent-girls"),
  tabPanels: {
    home: document.getElementById("tab-home"),
    picks: document.getElementById("tab-picks"),
    matches: document.getElementById("tab-matches"),
    settings: document.getElementById("tab-settings"),
  },
  navBtns: {
    home: document.getElementById("nav-home"),
    picks: document.getElementById("nav-picks"),
    matches: document.getElementById("nav-matches"),
    settings: document.getElementById("nav-settings"),
  },
};

let confirmResolve = null;

function showConfirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  if (!els.confirmDialog) return Promise.resolve(false);

  return new Promise((resolve) => {
    confirmResolve = resolve;
    els.confirmDialogTitle.textContent = title;
    els.confirmDialogMessage.textContent = message;
    els.confirmDialogConfirm.textContent = confirmLabel;
    els.confirmDialogConfirm.classList.toggle("confirm-dialog-btn-danger", danger);
    els.confirmDialogConfirm.classList.toggle("confirm-dialog-btn-primary", !danger);
    els.confirmDialog.showModal();
    els.confirmDialogConfirm.focus();
  });
}

function closeConfirmDialog(result) {
  if (els.confirmDialog?.open) {
    els.confirmDialog.close();
  }
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

function clearLocalUserData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SURNAME_STORAGE_KEY);
}

function getInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("invite");
}

function clearInviteFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.pathname + url.search);
}

function applyUserStatus(user) {
  state.userId = user.id;
  state.email = user.email;
  state.name = user.name;
  state.linked = user.linked;
  state.partnerName = user.partner_name;
  state.pendingInviteUrl = user.pending_invite_url;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ id: user.id, email: user.email, name: user.name })
  );
  if (els.displayNameInput) {
    els.displayNameInput.value = user.name;
  }
}

function switchTab(tab) {
  if (tab === "matches" && !state.linked) tab = "home";
  if (!els.tabPanels[tab]) return;

  state.activeTab = tab;

  for (const [name, panel] of Object.entries(els.tabPanels)) {
    panel.classList.toggle("hidden", name !== tab);
  }

  for (const [name, btn] of Object.entries(els.navBtns)) {
    const active = name === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  }

  if (tab === "picks") {
    loadPicks();
    loadSentRecommendations();
    if (state.linked) loadMatches();
  }
  if (tab === "matches") loadMatches();
}

function updatePartnerUI() {
  const hasPending = !!state.pendingInviteUrl;

  els.partnerLinked.classList.toggle("hidden", !state.linked);
  els.partnerPending.classList.toggle("hidden", state.linked || !hasPending);
  els.invitePartnerSection.classList.toggle("hidden", state.linked || hasPending);

  if (state.linked) {
    els.partnerName.textContent = state.partnerName;
  }

  els.navBtns.matches.classList.toggle("hidden", !state.linked);
  if (!state.linked && state.activeTab === "matches") {
    switchTab("home");
  }

  els.matchesHint.classList.toggle("hidden", state.linked);
  updateRecommendUI();
}

function canNativeShare(shareData) {
  // Web Share API (and clipboard API) require HTTPS or localhost.
  if (!window.isSecureContext || !navigator.share) return false;
  if (typeof navigator.canShare === "function") {
    return navigator.canShare(shareData);
  }
  // Firefox desktop exposes share but does not offer a working share UI.
  const isFirefoxDesktop =
    /Firefox/i.test(navigator.userAgent) &&
    !/Mobile|Android|Tablet/i.test(navigator.userAgent);
  return !isFirefoxDesktop;
}

function showInviteLinkFeedback(url, copied) {
  if (copied) {
    els.inviteFeedback.textContent =
      "Link copied — paste it in WhatsApp, Gmail, or anywhere.";
  } else {
    const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    els.inviteFeedback.innerHTML =
      `Copy this link and send it to your partner:<br>` +
      `<input type="text" class="invite-link-input" readonly value="${safeUrl}" aria-label="Invite link">`;
    const input = els.inviteFeedback.querySelector(".invite-link-input");
    input?.addEventListener("focus", () => input.select());
    input?.addEventListener("click", () => input.select());
  }
  els.inviteFeedback.classList.remove("hidden");
}

async function copyTextToClipboard(text) {
  if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": Promise.resolve(new Blob([text], { type: "text/plain" })),
        }),
      ]);
      return true;
    } catch {
      /* try next method */
    }
  }

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* try next method */
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "2em";
  textarea.style.height = "2em";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyInviteUrlWithGesture(urlPromise) {
  if (!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem) {
    return false;
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": urlPromise.then(
          (url) => new Blob([url], { type: "text/plain" })
        ),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function shareInviteLink(url) {
  const shareData = {
    title: "Kinder",
    text: "Join me on Kinder to swipe baby names together!",
    url,
  };

  if (canNativeShare(shareData)) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }

  const copied = await copyTextToClipboard(url);
  showInviteLinkFeedback(url, copied);
  return copied;
}

async function fetchInviteUrl({ refreshStatus = true } = {}) {
  const res = await fetch("/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Could not create invite");
  }

  if (refreshStatus) {
    await refreshUserStatus();
  }
  return data.invite_url;
}

async function createAndShareInvite() {
  els.inviteFeedback.classList.add("hidden");

  const inviteUrlPromise = fetchInviteUrl({ refreshStatus: false });
  const wantsNativeShare = canNativeShare({
    title: "Kinder",
    text: "Join me on Kinder to swipe baby names together!",
    url: `${window.location.origin}/?invite=preview`,
  });

  if (!wantsNativeShare && (await copyInviteUrlWithGesture(inviteUrlPromise))) {
    showInviteLinkFeedback(await inviteUrlPromise, true);
    await refreshUserStatus();
    return;
  }

  await shareInviteLink(await inviteUrlPromise);
  await refreshUserStatus();
}

function setActionsEnabled(enabled) {
  els.dislikeBtn.disabled = !enabled;
  els.likeBtn.disabled = !enabled;
}

function resetCardTransform() {
  els.card.style.transform = "";
  els.card.style.opacity = "";
  els.card.style.removeProperty("--hint-no-opacity");
  els.card.style.removeProperty("--hint-yes-opacity");
  els.card.classList.remove("dragging");
}

function loadSurname() {
  const saved = localStorage.getItem(SURNAME_STORAGE_KEY);
  state.surname = saved || "";
  els.surnameInput.value = state.surname;
}

function saveSurname(value) {
  state.surname = value.trim();
  if (state.surname) {
    localStorage.setItem(SURNAME_STORAGE_KEY, state.surname);
  } else {
    localStorage.removeItem(SURNAME_STORAGE_KEY);
  }
}

async function saveDisplayName(value) {
  const name = value.trim();
  if (!name || !state.userId || name === state.name) return;

  const res = await fetch("/api/me/name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId, name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Could not update name");
  }

  const user = await res.json();
  applyUserStatus(user);
  updatePartnerUI();
  updateRecommendUI();
}

function updateCardSurname() {
  if (state.surname) {
    els.nameSurname.textContent = state.surname;
    els.nameSurname.classList.remove("hidden");
  } else {
    els.nameSurname.textContent = "";
    els.nameSurname.classList.add("hidden");
  }
}

function showCard(name) {
  els.loadingState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.card.classList.remove("hidden", "boy", "girl", "swipe-left", "swipe-right", "dragging");
  resetCardTransform();

  const isBoy = name.gender === "M";
  els.card.classList.add(isBoy ? "boy" : "girl", "entering");
  els.nameText.textContent = name.name;
  updateCardSurname();
  els.nameRank.textContent = name.rank ? `#${name.rank}` : "";
  els.nameRank.classList.toggle("hidden", !name.rank);
  els.genderBadge.textContent = isBoy ? "Boy" : "Girl";
  els.genderBadge.classList.remove("hidden");

  requestAnimationFrame(() => {
    els.card.classList.remove("entering");
    els.card.classList.add("visible");
  });

  setActionsEnabled(true);
}

function showEmpty() {
  els.card.classList.add("hidden");
  els.loadingState.classList.add("hidden");
  els.emptyState.classList.remove("hidden");
  setActionsEnabled(false);
}

async function fetchNextName() {
  els.loadingState.classList.remove("hidden");
  els.card.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  setActionsEnabled(false);

  const res = await fetch(`/api/next-name?user_id=${state.userId}`);
  if (res.status === 404) {
    state.currentName = null;
    showEmpty();
    return;
  }
  if (!res.ok) throw new Error("Failed to load next name");

  state.currentName = await res.json();
  showCard(state.currentName);
}

async function recordSwipe(status, animate = true) {
  if (!state.currentName || state.busy) return;

  state.busy = true;
  setActionsEnabled(false);

  const direction = status === STATUS_YES ? "swipe-right" : "swipe-left";

  if (animate) {
    els.card.classList.remove("visible", "dragging");
    resetCardTransform();
    els.card.classList.add(direction);
  }

  const swipeBody = { user_id: state.userId, status };
  if (state.currentName.custom) {
    swipeBody.custom_id = state.currentName.id;
  } else {
    swipeBody.name_id = state.currentName.id;
  }

  const swipePromise = fetch("/api/swipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(swipeBody),
  });

  if (animate) {
    await new Promise((resolve) => setTimeout(resolve, 320));
  }

  const res = await swipePromise;
  if (!res.ok) {
    state.busy = false;
    setActionsEnabled(true);
    els.card.classList.remove(direction);
    els.card.classList.add("visible");
    alert("Could not save swipe. Please try again.");
    return;
  }

  state.busy = false;
  const refresh = [fetchNextName(), loadPicks()];
  if (state.linked) refresh.push(loadMatches());
  await Promise.all(refresh);
}

function splitByGender(names) {
  return {
    boys: names.filter((item) => item.gender === "M"),
    girls: names.filter((item) => item.gender !== "M"),
  };
}

function renderNameList(container, names, nameClass, rankClass) {
  container.innerHTML = "";
  for (const item of names) {
    const li = document.createElement("li");
    li.className = item.gender === "M" ? "boy" : "girl";
    const rankHtml = item.rank ? `<span class="${rankClass}">#${item.rank}</span>` : "";
    li.innerHTML = `<span class="${nameClass}">${item.name}</span>${rankHtml}`;
    container.appendChild(li);
  }
}

function renderGenderColumns({ boys, girls }, lists, emptyEls, nameClass, rankClass) {
  renderNameList(lists.boys, boys, nameClass, rankClass);
  renderNameList(lists.girls, girls, nameClass, rankClass);

  lists.boys.classList.toggle("hidden", boys.length === 0);
  lists.girls.classList.toggle("hidden", girls.length === 0);
  emptyEls.boys.classList.toggle("hidden", boys.length > 0);
  emptyEls.girls.classList.toggle("hidden", girls.length > 0);
}

async function clearPicks() {
  if (!state.userId) return;

  const confirmed = await showConfirmDialog({
    title: "Clear picks?",
    message: "All names you liked will show up in your deck again. This cannot be undone.",
    confirmLabel: "Clear picks",
    danger: true,
  });
  if (!confirmed) return;

  els.clearPicksBtn.disabled = true;

  try {
    const res = await fetch("/api/clear-picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: state.userId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      const message =
        typeof detail === "string"
          ? detail
          : res.status === 405
            ? "Clear picks is not available — restart the app server."
            : "Could not clear picks";
      throw new Error(message);
    }

    await Promise.all([loadPicks(), fetchNextName()]);
  } catch (err) {
    alert(err.message);
    await loadPicks();
  }
}

function updateRecommendUI() {
  els.recommendSection.classList.remove("hidden");

  if (state.linked) {
    const partner = state.partnerName || "your partner";
    els.recommendHeading.textContent = `Recommend to ${partner}`;
    els.sentRecommendationsHeading.textContent = `Sent to ${partner}`;
    els.recommendHint.textContent =
      "Suggest any name — it'll show up first on their home screen. Known names are matched from the database automatically.";
    els.recommendBtnLabel.textContent = "Send";
  } else {
    els.recommendHeading.textContent = "Add a name";
    els.recommendHint.textContent =
      "Add any name to your picks. Known names are matched from the database automatically.";
    els.recommendBtnLabel.textContent = "Add";
  }
}

function getSelectedRecommendGender() {
  const selected = els.recommendForm.querySelector('input[name="recommend-gender"]:checked');
  return selected ? selected.value : null;
}

function setRecommendGender(gender) {
  const radio = els.recommendForm.querySelector(`input[name="recommend-gender"][value="${gender}"]`);
  if (radio) radio.checked = true;
  updateRecommendBtnState();
}

function isNameMatched(name) {
  return state.linked && state.matchedNames.has(name.toLowerCase());
}

function updateRecommendBtnState() {
  const name = els.recommendInput.value.trim();
  const gender = getSelectedRecommendGender();
  const matched = isNameMatched(name);
  els.recommendBtn.disabled = name.length < 1 || !gender || matched;

  if (matched) {
    showRecommendFeedback("You already matched on this name", true);
  }
}

function clearRecommendSelection() {
  els.recommendInput.value = "";
  for (const radio of els.recommendForm.querySelectorAll('input[name="recommend-gender"]')) {
    radio.checked = false;
  }
  updateRecommendBtnState();
  hideRecommendSuggestions();
}

function hideRecommendSuggestions() {
  els.recommendSuggestions.classList.add("hidden");
  els.recommendSuggestions.innerHTML = "";
}

function selectRecommendName(item) {
  els.recommendInput.value = item.name;
  setRecommendGender(item.gender);
  hideRecommendSuggestions();
}

function renderRecommendSuggestions(items) {
  els.recommendSuggestions.innerHTML = "";
  if (!items.length) {
    els.recommendSuggestions.classList.add("hidden");
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = item.gender === "M" ? "boy" : "girl";
    li.setAttribute("role", "option");
    li.innerHTML = `<span class="suggestion-name">${item.name}</span><span class="suggestion-meta">${item.gender === "M" ? "Boy" : "Girl"} · #${item.rank}</span>`;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectRecommendName(item);
    });
    els.recommendSuggestions.appendChild(li);
  }

  els.recommendSuggestions.classList.remove("hidden");
}

async function searchRecommendNames(query) {
  const res = await fetch(`/api/names/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  return res.json();
}

function scheduleRecommendSearch(query) {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(async () => {
    const items = await searchRecommendNames(query);
    renderRecommendSuggestions(items);
  }, 200);
}

function showRecommendFeedback(message, isError = false) {
  els.recommendFeedback.textContent = message;
  els.recommendFeedback.classList.toggle("recommend-feedback-error", isError);
  els.recommendFeedback.classList.remove("hidden");
}

async function submitRecommendation(e) {
  e.preventDefault();
  const name = els.recommendInput.value.trim();
  const gender = getSelectedRecommendGender();
  if (!name || !gender) return;

  els.recommendBtn.disabled = true;

  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: state.userId,
        name,
        gender,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Could not send recommendation");
    }

    showRecommendFeedback(
      state.linked
        ? `Sent "${name}" to ${state.partnerName || "your partner"}!`
        : `Added "${name}" to your picks!`
    );
    clearRecommendSelection();
    const refresh = [loadPicks()];
    if (state.linked) {
      refresh.push(loadSentRecommendations(), loadMatches());
    }
    await Promise.all(refresh);
  } catch (err) {
    showRecommendFeedback(err.message, true);
    updateRecommendBtnState();
  }
}

async function loadSentRecommendations() {
  if (!state.userId || !state.linked) {
    els.sentRecommendations.classList.add("hidden");
    return;
  }

  const res = await fetch(`/api/recommendations?user_id=${state.userId}`);
  if (!res.ok) return;

  const items = await res.json();
  const { boys, girls } = splitByGender(items);
  els.sentRecommendations.classList.toggle("hidden", items.length === 0);

  renderGenderColumns(
    { boys, girls },
    { boys: els.sentBoysList, girls: els.sentGirlsList },
    { boys: els.noSentBoys, girls: els.noSentGirls },
    "sent-name",
    "sent-rank"
  );
}

async function loadPicks() {
  if (!state.userId) return;

  updateRecommendUI();

  const res = await fetch(`/api/likes?user_id=${state.userId}`);
  if (!res.ok) return;

  const picks = await res.json();
  const { boys, girls } = splitByGender(picks);
  const hasPicks = picks.length > 0;

  els.noPicks.classList.toggle("hidden", hasPicks);
  els.picksColumns.classList.toggle("hidden", !hasPicks);
  els.clearPicksBtn.disabled = !hasPicks;

  if (hasPicks) {
    renderGenderColumns(
      { boys, girls },
      { boys: els.picksBoysList, girls: els.picksGirlsList },
      { boys: els.noPicksBoys, girls: els.noPicksGirls },
      "pick-name",
      "pick-rank"
    );
  }
}

async function refreshUserStatus() {
  const res = await fetch(`/api/me?user_id=${state.userId}`);
  if (!res.ok) return;
  const user = await res.json();
  applyUserStatus(user);
  updatePartnerUI();
  if (state.activeTab === "matches") loadMatches();
}

async function loadMatches() {
  els.noMatches.classList.add("hidden");
  els.matchesColumns.classList.add("hidden");
  els.matchesHint.classList.toggle("hidden", state.linked);

  if (!state.linked) return;

  const res = await fetch(`/api/matches?user_id=${state.userId}`);
  if (!res.ok) return;

  const data = await res.json();
  if (!data.linked) return;

  state.matchedNames = new Set(data.matches.map((item) => item.name.toLowerCase()));

  const { boys, girls } = splitByGender(data.matches);
  const hasMatches = data.matches.length > 0;

  els.noMatches.classList.toggle("hidden", hasMatches);
  els.matchesColumns.classList.toggle("hidden", !hasMatches);

  if (hasMatches) {
    renderGenderColumns(
      { boys, girls },
      { boys: els.matchesBoysList, girls: els.matchesGirlsList },
      { boys: els.noMatchesBoys, girls: els.noMatchesGirls },
      "match-name",
      "match-rank"
    );
  }

  updateRecommendBtnState();
}

function hideAllScreens() {
  els.signInScreen.classList.add("hidden");
  els.inviteScreen.classList.add("hidden");
  els.app.classList.add("hidden");
}

function showApp() {
  hideAllScreens();
  els.app.classList.remove("hidden");
  updatePartnerUI();
  switchTab("home");
  const initLoads = [fetchNextName(), loadPicks()];
  if (state.linked) initLoads.push(loadMatches());
  Promise.all(initLoads).catch(() => alert("Failed to load names."));
}

async function handleDeleteAccount() {
  if (!state.userId) return;

  const confirmed = await showConfirmDialog({
    title: "Delete account?",
    message:
      "This permanently deletes your account, picks, and partner link. Your partner will be unlinked but their account stays. Your saved sign-in and settings will be cleared from this browser.",
    confirmLabel: "Delete account",
    danger: true,
  });
  if (!confirmed) return;

  if (els.deleteAccountBtn) els.deleteAccountBtn.disabled = true;

  try {
    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: state.userId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      throw new Error(typeof detail === "string" ? detail : "Could not delete account");
    }

    clearLocalUserData();
    showSignIn();
  } catch (err) {
    alert(err.message);
    if (els.deleteAccountBtn) els.deleteAccountBtn.disabled = false;
  }
}

function showSignIn() {
  hideAllScreens();
  els.signInScreen.classList.remove("hidden");
  state.userId = null;
  state.email = null;
  state.name = null;
  state.linked = false;
  state.partnerName = null;
  state.pendingInviteUrl = null;
  state.currentName = null;
  clearLocalUserData();
  els.signInError.classList.add("hidden");
  els.emailInput.value = "";
  els.displayNameInput.value = "";
  els.surnameInput.value = "";
  state.surname = "";
  if (els.deleteAccountBtn) els.deleteAccountBtn.disabled = false;
}

async function showInviteScreen(token) {
  hideAllScreens();
  els.inviteScreen.classList.remove("hidden");
  els.inviteError.classList.add("hidden");
  els.inviteForm.classList.remove("hidden");
  state.inviteToken = token;

  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Invite not found");
    }
    const invite = await res.json();
    els.inviteInviter.textContent = invite.inviter_name;
    els.inviteNameInput.value = "";
    els.inviteEmailInput.value = "";
  } catch (err) {
    els.inviteError.textContent = err.message;
    els.inviteError.classList.remove("hidden");
    els.inviteForm.classList.add("hidden");
  }
}

async function signIn(email) {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.[0]?.msg || err.detail || "Could not sign in");
  }

  const user = await res.json();
  applyUserStatus(user);
  showApp();
}

els.signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.signInError.classList.add("hidden");
  try {
    await signIn(els.emailInput.value.trim());
  } catch (err) {
    els.signInError.textContent = err.message;
    els.signInError.classList.remove("hidden");
  }
});

els.inviteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.inviteError.classList.add("hidden");

  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(state.inviteToken)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: els.inviteEmailInput.value.trim(),
        name: els.inviteNameInput.value.trim(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not accept invite");
    }

    const user = await res.json();
    applyUserStatus(user);
    clearInviteFromUrl();
    state.inviteToken = null;
    showApp();
  } catch (err) {
    els.inviteError.textContent = err.message;
    els.inviteError.classList.remove("hidden");
  }
});

els.inviteSkipBtn.addEventListener("click", () => {
  clearInviteFromUrl();
  state.inviteToken = null;
  showSignIn();
});

els.shareInviteBtn.addEventListener("click", async () => {
  try {
    await createAndShareInvite();
  } catch (err) {
    els.inviteFeedback.textContent = err.message;
    els.inviteFeedback.classList.remove("hidden");
  }
});

els.reshareBtn.addEventListener("click", async () => {
  els.inviteFeedback.classList.add("hidden");
  if (state.pendingInviteUrl) {
    await shareInviteLink(state.pendingInviteUrl);
  }
});

els.unlinkBtn.addEventListener("click", async () => {
  if (!confirm("Unlink from your partner? You can invite someone else later.")) return;

  const res = await fetch("/api/unlink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId }),
  });

  if (!res.ok) {
    alert("Could not unlink.");
    return;
  }

  await refreshUserStatus();
});

function updateDragVisual(dx) {
  const rotate = dx * 0.08;
  const opacity = Math.max(0.55, 1 - Math.abs(dx) / 400);
  const hintOpacity = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);
  els.card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
  els.card.style.opacity = String(opacity);
  els.card.style.setProperty("--hint-no-opacity", dx < 0 ? String(hintOpacity) : "0");
  els.card.style.setProperty("--hint-yes-opacity", dx > 0 ? String(hintOpacity) : "0");
}

function onPointerDown(event) {
  if (!state.currentName || state.busy) return;
  if (event.button !== undefined && event.button !== 0) return;

  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: event.clientX,
  };

  els.card.classList.add("dragging");
  els.card.classList.remove("visible");
  setActionsEnabled(false);
  els.card.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;

  state.drag.currentX = event.clientX;
  const dx = state.drag.currentX - state.drag.startX;
  updateDragVisual(dx);
}

function onPointerUp(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;

  const dx = state.drag.currentX - state.drag.startX;
  state.drag = null;

  try {
    els.card.releasePointerCapture(event.pointerId);
  } catch {
    /* already released */
  }

  if (dx > SWIPE_THRESHOLD) {
    recordSwipe(STATUS_YES);
  } else if (dx < -SWIPE_THRESHOLD) {
    recordSwipe(STATUS_NO);
  } else {
    els.card.classList.remove("dragging");
    els.card.classList.add("visible");
    resetCardTransform();
    setActionsEnabled(true);
  }
}

els.card.addEventListener("pointerdown", onPointerDown);
els.card.addEventListener("pointermove", onPointerMove);
els.card.addEventListener("pointerup", onPointerUp);
els.card.addEventListener("pointercancel", onPointerUp);

for (const [tab, btn] of Object.entries(els.navBtns)) {
  btn.addEventListener("click", () => switchTab(tab));
}

els.displayNameInput.addEventListener("blur", async () => {
  try {
    await saveDisplayName(els.displayNameInput.value);
  } catch (err) {
    els.displayNameInput.value = state.name;
    alert(err.message);
  }
});

els.displayNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    els.displayNameInput.blur();
  }
});

els.surnameInput.addEventListener("input", () => {
  saveSurname(els.surnameInput.value);
  if (state.currentName && !els.card.classList.contains("hidden")) {
    updateCardSurname();
  }
});

els.signOutBtn?.addEventListener("click", showSignIn);

els.settingsActions?.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest("#delete-account-btn");
  if (deleteBtn) {
    event.preventDefault();
    void handleDeleteAccount();
    return;
  }

  const clearBtn = event.target.closest("#clear-picks-btn");
  if (clearBtn && !clearBtn.disabled) {
    event.preventDefault();
    void clearPicks();
  }
});

els.confirmDialogCancel?.addEventListener("click", () => closeConfirmDialog(false));
els.confirmDialogConfirm?.addEventListener("click", () => closeConfirmDialog(true));
els.confirmDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeConfirmDialog(false);
});
els.confirmDialog?.addEventListener("click", (event) => {
  if (event.target === els.confirmDialog) {
    closeConfirmDialog(false);
  }
});

els.recommendForm.addEventListener("submit", submitRecommendation);

els.recommendInput.addEventListener("input", () => {
  const query = els.recommendInput.value.trim();
  if (!isNameMatched(query)) {
    els.recommendFeedback.classList.add("hidden");
  }
  updateRecommendBtnState();

  if (query.length < 2) {
    hideRecommendSuggestions();
    return;
  }

  scheduleRecommendSearch(query);
});

els.recommendInput.addEventListener("blur", () => {
  setTimeout(hideRecommendSuggestions, 150);
});

for (const radio of els.recommendForm.querySelectorAll('input[name="recommend-gender"]')) {
  radio.addEventListener("change", updateRecommendBtnState);
}
els.dislikeBtn.addEventListener("click", () => recordSwipe(STATUS_NO));
els.likeBtn.addEventListener("click", () => recordSwipe(STATUS_YES));
async function init() {
  loadSurname();

  const inviteToken = getInviteTokenFromUrl();
  if (inviteToken) {
    await showInviteScreen(inviteToken);
    return;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const user = JSON.parse(saved);
      const res = await fetch(`/api/me?user_id=${user.id}`);
      if (res.ok) {
        const status = await res.json();
        if (status.email === user.email) {
          applyUserStatus(status);
          showApp();
          return;
        }
      }
    } catch {
      /* fall through to sign-in */
    }
  }

  showSignIn();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is optional */
    });
  });
}

init();
