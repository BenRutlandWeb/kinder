const STORAGE_KEY = "babynames-user";

const state = {
  userId: null,
  email: null,
  linked: false,
  partnerEmail: null,
  pendingInviteUrl: null,
  currentName: null,
  busy: false,
  drag: null,
  inviteToken: null,
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
  inviteEmailInput: document.getElementById("invite-email-input"),
  inviteInviter: document.getElementById("invite-inviter"),
  inviteError: document.getElementById("invite-error"),
  inviteSkipBtn: document.getElementById("invite-skip-btn"),
  app: document.getElementById("app"),
  userLabel: document.getElementById("current-user-label"),
  signOutBtn: document.getElementById("sign-out-btn"),
  partnerLinked: document.getElementById("partner-linked"),
  partnerEmail: document.getElementById("partner-email"),
  unlinkBtn: document.getElementById("unlink-btn"),
  partnerPending: document.getElementById("partner-pending"),
  invitePartnerSection: document.getElementById("invite-partner-section"),
  shareInviteBtn: document.getElementById("share-invite-btn"),
  reshareBtn: document.getElementById("reshare-btn"),
  inviteFeedback: document.getElementById("invite-feedback"),
  card: document.getElementById("name-card"),
  nameText: document.getElementById("name-text"),
  nameRank: document.getElementById("name-rank"),
  genderBadge: document.getElementById("gender-badge"),
  emptyState: document.getElementById("empty-state"),
  loadingState: document.getElementById("loading-state"),
  dislikeBtn: document.getElementById("dislike-btn"),
  likeBtn: document.getElementById("like-btn"),
  matchesBtn: document.getElementById("matches-btn"),
  matchesHint: document.getElementById("matches-hint"),
  matchesModal: document.getElementById("matches-modal"),
  closeModal: document.getElementById("close-modal"),
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
  menuBtn: document.getElementById("menu-btn"),
  sidebar: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebar-overlay"),
  closeSidebarBtn: document.getElementById("close-sidebar-btn"),
  clearPicksBtn: document.getElementById("clear-picks-btn"),
};

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
  state.linked = user.linked;
  state.partnerEmail = user.partner_email;
  state.pendingInviteUrl = user.pending_invite_url;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ id: user.id, email: user.email })
  );
}

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarOverlay.classList.remove("hidden");
  els.sidebar.setAttribute("aria-hidden", "false");
  els.sidebarOverlay.setAttribute("aria-hidden", "false");
  els.menuBtn.setAttribute("aria-expanded", "true");
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarOverlay.classList.add("hidden");
  els.sidebar.setAttribute("aria-hidden", "true");
  els.sidebarOverlay.setAttribute("aria-hidden", "true");
  els.menuBtn.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sidebar-open");
}

function updatePartnerUI() {
  const hasPending = !!state.pendingInviteUrl;

  els.partnerLinked.classList.toggle("hidden", !state.linked);
  els.partnerPending.classList.toggle("hidden", state.linked || !hasPending);
  els.invitePartnerSection.classList.toggle("hidden", state.linked || hasPending);

  if (state.linked) {
    els.partnerEmail.textContent = state.partnerEmail;
  }

  els.matchesBtn.classList.toggle("hidden", !state.linked);
  els.matchesHint.classList.toggle("hidden", state.linked);
}

async function shareInviteLink(url) {
  const shareData = {
    title: "Baby Names",
    text: "Join me to swipe baby names together!",
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    els.inviteFeedback.textContent = "Link copied — paste it in WhatsApp, Gmail, or anywhere.";
    els.inviteFeedback.classList.remove("hidden");
    return true;
  } catch {
    els.inviteFeedback.innerHTML = `Copy this link:<br><a href="${url}">${url}</a>`;
    els.inviteFeedback.classList.remove("hidden");
    return false;
  }
}

async function createAndShareInvite() {
  els.inviteFeedback.classList.add("hidden");

  const res = await fetch("/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Could not create invite");
  }

  await refreshUserStatus();
  await shareInviteLink(data.invite_url);
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

function showCard(name) {
  els.loadingState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.card.classList.remove("hidden", "boy", "girl", "swipe-left", "swipe-right", "dragging");
  resetCardTransform();

  const isBoy = name.gender === "M";
  els.card.classList.add(isBoy ? "boy" : "girl", "entering");
  els.nameText.textContent = name.name;
  els.nameRank.textContent = `#${name.rank}`;
  els.genderBadge.textContent = isBoy ? "Boy" : "Girl";

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

  const swipePromise = fetch("/api/swipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: state.userId,
      name_id: state.currentName.id,
      status,
    }),
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
  await Promise.all([fetchNextName(), loadPicks()]);
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
    li.innerHTML = `<span class="${nameClass}">${item.name}</span><span class="${rankClass}">#${item.rank}</span>`;
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

  if (!confirm("Clear all your picks? Liked names will show up in your deck again.")) return;

  els.clearPicksBtn.disabled = true;

  try {
    const res = await fetch("/api/clear-picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: state.userId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not clear picks");
    }

    await Promise.all([loadPicks(), fetchNextName()]);
    closeSidebar();
  } catch (err) {
    alert(err.message);
  } finally {
    els.clearPicksBtn.disabled = false;
  }
}

async function loadPicks() {
  if (!state.userId) return;

  const res = await fetch(`/api/likes?user_id=${state.userId}`);
  if (!res.ok) return;

  const picks = await res.json();
  const { boys, girls } = splitByGender(picks);
  const hasPicks = picks.length > 0;

  els.noPicks.classList.toggle("hidden", hasPicks);
  els.picksColumns.classList.toggle("hidden", !hasPicks);

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
}

async function loadMatches() {
  els.noMatches.classList.add("hidden");
  els.matchesColumns.classList.add("hidden");

  const res = await fetch(`/api/matches?user_id=${state.userId}`);
  if (!res.ok) {
    alert("Could not load matches.");
    return;
  }

  const data = await res.json();
  if (!data.linked) {
    alert("Link with a partner to see mutual matches.");
    return;
  }

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

  els.matchesModal.showModal();
}

function hideAllScreens() {
  els.signInScreen.classList.add("hidden");
  els.inviteScreen.classList.add("hidden");
  els.app.classList.add("hidden");
}

function showApp() {
  hideAllScreens();
  els.app.classList.remove("hidden");
  els.userLabel.textContent = state.email;
  updatePartnerUI();
  Promise.all([fetchNextName(), loadPicks()]).catch(() => alert("Failed to load names."));
}

function showSignIn() {
  closeSidebar();
  hideAllScreens();
  els.signInScreen.classList.remove("hidden");
  state.userId = null;
  state.email = null;
  state.linked = false;
  state.partnerEmail = null;
  state.pendingInviteUrl = null;
  state.currentName = null;
  localStorage.removeItem(STORAGE_KEY);
  els.signInError.classList.add("hidden");
  els.emailInput.value = "";
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
    els.inviteInviter.textContent = invite.inviter_email;
    els.inviteEmailInput.value = "";
  } catch (err) {
    els.inviteError.textContent = err.message;
    els.inviteError.classList.remove("hidden");
    els.inviteForm.classList.add("hidden");
  }
}

async function signInWithEmail(email) {
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
    await signInWithEmail(els.emailInput.value.trim());
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
      body: JSON.stringify({ email: els.inviteEmailInput.value.trim() }),
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
  }
}

els.card.addEventListener("pointerdown", onPointerDown);
els.card.addEventListener("pointermove", onPointerMove);
els.card.addEventListener("pointerup", onPointerUp);
els.card.addEventListener("pointercancel", onPointerUp);

els.menuBtn.addEventListener("click", openSidebar);
els.closeSidebarBtn.addEventListener("click", closeSidebar);
els.sidebarOverlay.addEventListener("click", closeSidebar);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.sidebar.classList.contains("open")) {
    closeSidebar();
  }
});

els.signOutBtn.addEventListener("click", showSignIn);
els.clearPicksBtn.addEventListener("click", clearPicks);
els.dislikeBtn.addEventListener("click", () => recordSwipe(STATUS_NO));
els.likeBtn.addEventListener("click", () => recordSwipe(STATUS_YES));
els.matchesBtn.addEventListener("click", () => {
  closeSidebar();
  loadMatches();
});
els.closeModal.addEventListener("click", () => els.matchesModal.close());

async function init() {
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

init();
