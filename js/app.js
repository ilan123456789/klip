import {
  FirebaseService,
  RecommendationService,
  VideoInteractionType,
  DEFAULT_BIO,
  normalizeHandle,
  validateHandle,
  getInitials,
} from "./firebase.js?v=7";

const CHECKMARK_PATH = "M5,10.5 L8.5,14 L15,6.5";
const PLUS_PATH = "M10,5 L10,15 M5,10 L15,10";
const HEART_PATH =
  "M12,21.35 L10.55,20.03 C5.4,15.36 2,12.27 2,8.5 C2,5.41 4.42,3 7.5,3 C9.24,3 10.91,3.81 12,5.08 C13.09,3.81 14.76,3 16.5,3 C19.58,3 22,5.41 22,8.5 C22,12.27 18.6,15.36 13.45,20.03 L12,21.35 Z";
const COMMENT_PATH =
  "M12,3 C6.5,3 2,6.6 2,11 C2,13.2 3.1,15.2 5,16.6 L4.2,20.4 C4.1,20.8 4.5,21.1 4.8,20.9 L9.3,18.8 C10.2,19 11.1,19.1 12,19.1 C17.5,19.1 22,15.5 22,11 C22,6.6 17.5,3 12,3 Z";
const BOOKMARK_PATH =
  "M17,3 H7 C5.9,3 5,3.9 5,5 V21 L12,18 L19,21 V5 C19,3.9 18.1,3 17,3 Z";
const EYE_PATH =
  "M12,4.5 C7,4.5 2.73,7.61 1,12 C2.73,16.39 7,19.5 12,19.5 C17,19.5 21.27,16.39 23,12 C21.27,7.61 17,4.5 12,4.5 Z M12,17 C9.24,17 7,14.76 7,12 C7,9.24 9.24,7 12,7 C14.76,7 17,9.24 17,12 C17,14.76 14.76,17 12,17 Z M12,9 C10.34,9 9,10.34 9,12 C9,13.66 10.34,15 12,15 C13.66,15 15,13.66 15,12 C15,10.34 13.66,9 12,9 Z";
const SHARE_PATH =
  "M14,5 V9 C7,10 4,15 3,20 C5.5,16.5 9,14.9 14,14.9 V19 L21,12 L14,5 Z";
const TRASH_PATH =
  "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6";

function isOwnKlip(klip) {
  return Boolean(
    FirebaseService.isLoggedIn &&
    FirebaseService.currentUid &&
    klip &&
    klip.CreatorUid === FirebaseService.currentUid
  );
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") || (navigator.maxTouchPoints > 1 && window.innerWidth < 800);
}

// Audio starts unmuted immediately by default across all devices
const initialMobileMute = false;

// ==================== GLOBAL APP STATE ====================
const state = {
  activeRootTab: "MainPage", // "MainPage" | "CreatePage" | "ProfilePage"
  navigationStack: [], // Stack of { pageId, params } for subpages
  activeFeedTab: "ForYou", // "Following" | "Female" | "ForYou"
  isTabTransitioning: false,
  isMuted: false,
  userMuted: false,
  autoMuted: false,
  lastAutoUnmuteAt: 0,

  // MainPage Feed items
  feedItems: [],
  followingItems: [],
  femaleItems: [],
  activeFeedVideoId: null,
  activeFollowingVideoId: null,
  videoStartTime: Date.now(),
  currentKlipInView: null,
  isFeedRefreshing: false,

  // CreatePage state
  isPhotoMode: false,
  selectedVideoFile: null,
  selectedVideoObjectUrl: null,
  selectedPhotoFiles: [],
  previewPhotoUrls: [],
  previewPhotoIndex: 0,
  selectedSound: null,
  videoDuration: 0,

  // ProfilePage state
  showingSaved: false,
  isSignUpMode: true,
  selectedGender: "Male",
  profileDisplayedKlips: [],

  // CreatorProfilePage state
  creatorUid: "",
  creatorFallbackHandle: "",
  creatorFallbackInitials: "KL",
  creatorIsFollowing: false,
  creatorKlips: [],

  // FollowListPage state
  followListUid: "",
  followListMode: "following",

  // SearchPage state
  searchActiveTab: "All", // "All" | "Accounts" | "Klips"
  searchAllKlips: [],
  searchAllUsers: [],
  searchFilteredKlips: [],
  searchFilteredUsers: [],

  // VideoDetailPage state
  detailPlaylist: [],
  detailActiveVideoId: null,

  // EditProfile Crop state
  cropSourceCanvas: null,
  cropObjectUrl: null,
  cropBaseWidth: 260,
  cropBaseHeight: 260,
  cropScale: 1.0,
  cropOffsetX: 0,
  cropOffsetY: 0,
};

let toastTimer = null;
export function showToast(message) {
  const el = document.getElementById("klipToast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("visible");
  }, 2400);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==================== NAVIGATION & ROUTING ====================
function getActivePageId() {
  if (state.navigationStack.length > 0) {
    return state.navigationStack[state.navigationStack.length - 1].pageId;
  }
  return state.activeRootTab;
}

function syncNavigationUI() {
  const activePageId = getActivePageId();
  const isLoggedIn = FirebaseService.isLoggedIn;
  const isSubpageActive = state.navigationStack.length > 0;

  document.querySelectorAll(".page-view").forEach((el) => {
    const isThisActive = el.id === `page-${activePageId}`;
    el.classList.toggle("active", isThisActive);
    if (isThisActive) {
      el.classList.toggle("is-subpage", isSubpageActive);
    }
  });

  // Guest mode visibility toggles: hide posting and inbox buttons when in guest mode
  const postTabBtn = document.querySelector('.tabbar-item[data-tab="CreatePage"]');
  if (postTabBtn) {
    postTabBtn.style.display = isLoggedIn ? "flex" : "none";
  }
  const inboxTabBtn = document.querySelector('.tabbar-item[data-tab="InboxPage"]');
  if (inboxTabBtn) {
    inboxTabBtn.style.display = isLoggedIn ? "flex" : "none";
  }
  const bottomBar = document.getElementById("bottomTabBar");
  if (bottomBar) {
    bottomBar.classList.toggle("guest-mode", !isLoggedIn);
  }

  const sidebarPostBtn = document.querySelector('.sidebar-nav-btn[data-nav="CreatePage"]');
  if (sidebarPostBtn) {
    sidebarPostBtn.style.display = isLoggedIn ? "flex" : "none";
  }
  const sidebarInboxBtn = document.querySelector('.sidebar-nav-btn[data-nav="InboxPage"]');
  if (sidebarInboxBtn) {
    sidebarInboxBtn.style.display = isLoggedIn ? "flex" : "none";
  }
  const profileInboxBtn = document.getElementById("profileInboxBtn");
  if (profileInboxBtn) {
    profileInboxBtn.style.display = isLoggedIn ? "flex" : "none";
  }

  // Update Bottom TabBar
  document.querySelectorAll(".tabbar-item").forEach((btn) => {
    const tab = btn.getAttribute("data-tab");
    btn.classList.toggle("active", tab === state.activeRootTab);
  });

  // Update Desktop Sidebar
  document.querySelectorAll(".sidebar-nav-btn[data-nav]").forEach((btn) => {
    const nav = btn.getAttribute("data-nav");
    btn.classList.toggle("active", nav === activePageId || (!isSubpageActive && nav === state.activeRootTab));
  });

  // Show/hide desktop up/down arrows (only relevant on MainPage or VideoDetailPage)
  const arrows = document.querySelector(".desktop-feed-arrows");
  if (arrows) {
    arrows.style.display =
      activePageId === "MainPage" || activePageId === "VideoDetailPage"
        ? "flex"
        : "none";
  }

  // Manage video playback gate across pages
  if (activePageId !== "MainPage") {
    pauseAllCarouselVideos(document.getElementById("feedCarousel"));
    pauseAllCarouselVideos(document.getElementById("followingCarousel"));
  }
  if (activePageId !== "VideoDetailPage") {
    pauseAllCarouselVideos(document.getElementById("detailFeedCarousel"));
  }
  if (activePageId !== "CreatePage") {
    const previewVid = document.getElementById("previewVideoPlayer");
    if (previewVid) previewVid.pause();
  }
}

async function switchRootTab(tabId) {
  const wasAlreadyOnMainPage =
    tabId === "MainPage" &&
    state.activeRootTab === "MainPage" &&
    state.navigationStack.length === 0;

  state.navigationStack = [];
  state.activeRootTab = tabId;
  syncNavigationUI();

  if (tabId === "MainPage") {
    if (wasAlreadyOnMainPage) {
      await triggerFeedRefreshAsync();
    } else {
      await onMainPageAppearing();
    }
  } else if (tabId === "SearchPage") {
    await onSearchPageAppearing();
  } else if (tabId === "CreatePage") {
    await onCreatePageAppearing();
  } else if (tabId === "InboxPage") {
    await onInboxAppearing();
  } else if (tabId === "ProfilePage") {
    await onProfilePageAppearing();
  }
}

async function pushSubpage(pageId, params = {}) {
  if (pageId !== "SoundDetailPage") {
    cleanupSoundDetailAudio();
  }
  state.navigationStack.push({ pageId, params });
  syncNavigationUI();

  if (pageId === "CreatorProfilePage") {
    state.creatorUid = params.uid || "";
    state.creatorFallbackHandle = params.handle || "";
    state.creatorFallbackInitials = params.initials || "KL";
    loadCreatorProfileAsync();
  } else if (pageId === "EditProfilePage") {
    await onEditProfileAppearing();
  } else if (pageId === "FollowListPage") {
    state.followListUid = params.uid || "";
    state.followListMode = params.mode || "following";
    await onFollowListAppearing();
  } else if (pageId === "InboxPage") {
    await onInboxAppearing();
  } else if (pageId === "SearchPage") {
    await onSearchPageAppearing(params.query);
  } else if (pageId === "VideoDetailPage") {
    await onVideoDetailAppearing(params.playlist, params.selected, params.openComments);
  } else if (pageId === "SoundDetailPage") {
    await onSoundDetailAppearing(params);
  }
}

async function popSubpage() {
  if (state.navigationStack.length === 0) return;
  const popped = state.navigationStack.pop();
  if (popped.pageId === "EditProfilePage") {
    closeCropModal();
  }
  if (popped.pageId === "VideoDetailPage") {
    releaseVideosIn(document.getElementById("detailFeedCarousel"));
  }
  if (popped.pageId === "SoundDetailPage") {
    cleanupSoundDetailAudio();
  }
  syncNavigationUI();

  const currentId = getActivePageId();
  if (currentId === "MainPage") {
    await refreshFeedsAsync();
    activateCurrentFeedVideo();
  } else if (currentId === "ProfilePage") {
    await refreshProfileViewAsync();
  } else if (currentId === "CreatorProfilePage") {
    await loadCreatorProfileAsync();
  } else if (currentId === "VideoDetailPage") {
    activateCurrentDetailVideo();
  }
}

// ==================== SIDEBAR USER BADGE ====================
function updateSidebarUserCard() {
  const nameEl = document.getElementById("sidebarUserName");
  const handleEl = document.getElementById("sidebarUserHandle");
  const initialsEl = document.getElementById("sidebarUserInitials");
  const imgEl = document.getElementById("sidebarUserImg");

  const u = FirebaseService.currentUser;
  if (FirebaseService.isLoggedIn && u) {
    nameEl.textContent = u.DisplayName || u.Handle;
    handleEl.textContent = u.Handle;
    initialsEl.textContent = u.Initials || "KL";
    if (u.hasAvatar) {
      imgEl.src = u.AvatarUrl;
      imgEl.style.display = "block";
      initialsEl.style.display = "none";
    } else {
      imgEl.style.display = "none";
      initialsEl.style.display = "inline";
    }
  } else {
    nameEl.textContent = "Guest";
    handleEl.textContent = "Tap to Sign In";
    initialsEl.textContent = "KL";
    imgEl.style.display = "none";
    initialsEl.style.display = "inline";
  }
}

function propagateAvatarUpdate(avatarUrl) {
  if (!avatarUrl) return;
  const myUid = FirebaseService.currentUid || "";

  // 1. Desktop Sidebar
  updateSidebarUserCard();

  // 2. Profile Page (Me)
  const profileImg = document.getElementById("profileAvatarImg");
  const profileInitials = document.getElementById("profileInitialsLabel");
  if (profileImg) {
    profileImg.src = avatarUrl;
    profileImg.style.display = "block";
  }
  if (profileInitials) {
    profileInitials.style.display = "none";
  }

  // 3. Edit Profile Preview
  const editPreview = document.getElementById("editAvatarPreviewImg");
  const editInitials = document.getElementById("editAvatarInitialsLabel");
  if (editPreview) {
    editPreview.src = avatarUrl;
    editPreview.style.display = "block";
  }
  if (editInitials) {
    editInitials.style.display = "none";
  }

  // 4. Creator Profile Page (if viewing own profile)
  if (!state.creatorUid || state.creatorUid === myUid) {
    const creatorImg = document.getElementById("creatorAvatarImg");
    const creatorInitials = document.getElementById("creatorInitialsLabel");
    if (creatorImg) {
      creatorImg.src = avatarUrl;
      creatorImg.style.display = "block";
    }
    if (creatorInitials) {
      creatorInitials.style.display = "none";
    }
  }

  // 5. In-Memory Klips across all active state lists
  const myHandle = (FirebaseService.currentUser?.Handle || "").toLowerCase();
  const updateList = (list) => {
    if (!Array.isArray(list)) return;
    for (const k of list) {
      if (!k) continue;
      const kUid = k.CreatorUid || "";
      const kHandle = (k.CreatorHandle || "").toLowerCase();
      if ((myUid && kUid === myUid) || (myHandle && kHandle === myHandle)) {
        k.CreatorAvatarUrl = avatarUrl;
      }
    }
  };
  updateList(state.feedItems);
  updateList(state.followingItems);
  updateList(state.femaleItems);
  updateList(state.detailPlaylist);
  updateList(state.userKlips);
  updateList(state.savedKlips);
  updateList(state.searchKlips);

  // 6. Live Feed & Detail Slide DOM Elements
  const allSlides = document.querySelectorAll(".feed-slide");
  allSlides.forEach((slide) => {
    const sUid = slide.dataset.creatorUid || "";
    const sHandle = (slide.dataset.creatorHandle || "").toLowerCase();
    const isMine = (myUid && sUid === myUid) || (myHandle && sHandle === myHandle);
    if (isMine) {
      const railImg = slide.querySelector(".rail-creator-img");
      const railInit = slide.querySelector(".rail-avatar-initials");
      if (railImg) {
        railImg.src = avatarUrl;
        railImg.dataset.src = avatarUrl;
        railImg.style.display = "block";
      }
      if (railInit) {
        railInit.style.display = "none";
      }
    }
  });

  // Keep all playlist items in sync
  state.feedItems.forEach((k) => {
    if (k && ((myUid && k.CreatorUid === myUid) || (myHandle && (k.CreatorHandle || "").toLowerCase() === myHandle))) {
      syncVideoAcrossAllViews(k);
    }
  });

  // 7. Live Comments DOM Elements & memory list
  document.querySelectorAll(`.comment-item[data-user-uid="${myUid}"]`).forEach((item) => {
    const box = item.querySelector(".comment-avatar-box");
    if (box) {
      box.innerHTML = `<img class="comment-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" />`;
    }
  });
  if (Array.isArray(currentCommentsList)) {
    for (const c of currentCommentsList) {
      if (c && (c.UserUid === myUid || c.UserId === myUid)) {
        c.UserAvatarUrl = avatarUrl;
      }
    }
  }

  // 8. Rebind Profile UI to keep counts & info in sync
  if (FirebaseService.currentUser) {
    bindProfileUI(FirebaseService.currentUser);
  }
}

// ==================== SOUND / MUTE CONTROLLER ====================
function updateSoundIcons() {
  const effectiveMuted = Boolean(state.userMuted || state.autoMuted);
  state.isMuted = effectiveMuted;
  const onIcon = document.getElementById("soundOnIcon");
  const offIcon = document.getElementById("soundOffIcon");
  if (onIcon && offIcon) {
    onIcon.style.display = effectiveMuted ? "none" : "block";
    offIcon.style.display = effectiveMuted ? "block" : "none";
  }
}

function setMutedState(muted, byUser = true) {
  if (byUser) {
    state.userMuted = Boolean(muted);
    state.autoMuted = false;
  } else {
    state.autoMuted = Boolean(muted);
  }
  updateSoundIcons();
  const effectiveMuted = Boolean(state.userMuted || state.autoMuted);
  document.querySelectorAll("video.klip-video-element").forEach((v) => {
    if (v.id === "previewVideoPlayer") {
      v.muted = false;
      v.volume = 1.0;
      return;
    }
    if (v.dataset.active === "1") {
      v.defaultMuted = effectiveMuted;
      v.muted = effectiveMuted;
      v.volume = 1.0;
      if (!effectiveMuted && v.paused) {
        const slide = v.closest(".feed-slide");
        const disc = slide?.querySelector(".rail-audio-disc");
        playVideoSafely(v, disc);
      }
    } else {
      v.muted = true;
    }
  });
}

function ensureAudioTracksEnabled(videoEl) {
  if (!videoEl) return;
  try {
    if (videoEl.audioTracks && videoEl.audioTracks.length > 0) {
      for (let i = 0; i < videoEl.audioTracks.length; i++) {
        videoEl.audioTracks[i].enabled = true;
      }
    }
  } catch {
    /* ignore */
  }
}

// ==================== VIDEO SLIDE BUILDER (SHARED BY MAIN FEED & DETAIL PAGE) ====================
function createFeedSlideElement(klip, contextType, slideIndex = 0) {
  const slide = document.createElement("div");
  slide.className = "feed-slide";
  slide.dataset.klipId = klip.Id;
  slide.dataset.creatorUid = klip.CreatorUid || "";
  slide.dataset.creatorHandle = klip.CreatorHandle || "";
  slide.style.backgroundColor = klip.PlaceholderColor || "#080D18";

  // 0. Placeholder: shows video thumbnail poster if available, or Klip logo
  const placeholderEl = document.createElement("div");
  placeholderEl.className = "feed-slide-placeholder";
  if (klip.ThumbnailUrl) {
    placeholderEl.innerHTML = `<img src="${escapeHtml(klip.ThumbnailUrl)}" alt="" class="feed-slide-placeholder-poster" />`;
  } else {
    placeholderEl.innerHTML = `<img src="./assets/klip_logo.png" alt="" class="feed-slide-placeholder-logo" />`;
  }
  slide.appendChild(placeholderEl);

  // 1. Video OR Photo Slideshow
  if (klip.isVideoPost) {
    const videoEl = document.createElement("video");
    videoEl.className = "klip-video-element";
    videoEl.dataset.src = klip.VideoUrl;
    if (klip.ThumbnailUrl) {
      videoEl.poster = klip.ThumbnailUrl;
    }
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.setAttribute("autoplay", "");
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("webkit-playsinline", "true");
    videoEl.setAttribute("x5-playsinline", "true");
    videoEl.volume = 1.0;
    // Videos start unmuted by default unless user has explicitly muted
    const wantMuted = Boolean(state.userMuted);
    videoEl.defaultMuted = wantMuted;
    videoEl.muted = wantMuted;
    if (wantMuted) {
      videoEl.setAttribute("muted", "");
    }

    // For the very first slide, prime with preload="auto"; others wait for activateSlideInCarousel
    videoEl.preload = slideIndex === 0 ? "auto" : "none";
    slide.appendChild(videoEl);

    // Buffering Spinner
    const bufferSpinner = document.createElement("div");
    bufferSpinner.className = "video-buffering-spinner";
    slide.appendChild(bufferSpinner);

    let retryBtn = null;
    let retryCount = 0;
    let watchdog = null;
    let watchdogTries = 0;
    let lastErrorCode = 0;

    const isActiveSlide = () => videoEl.dataset.active === "1";
    const wantsPlayback = () =>
      isActiveSlide() && !klip.IsPaused && !klip.IsPausedByUser;

    const showSpinner = () => {
      if (isActiveSlide() || !videoEl.paused) {
        bufferSpinner.style.display = "block";
      }
    };
    const hideSpinner = () => {
      bufferSpinner.style.display = "none";
    };

    // Reload the source (keeping position) – used by watchdog, online event and retry.
    const reloadVideo = () => {
      if (!videoEl.dataset.src) return;
      placeholderEl.style.display = "flex";
      placeholderEl.style.opacity = "1";
      const resumeAt = videoEl.currentTime || 0;
      attachVideoToElement(videoEl, videoEl.dataset.src);
      videoEl.preload = "auto";
      videoEl.load();
      if (resumeAt > 0.5) {
        videoEl.addEventListener(
          "loadedmetadata",
          () => {
            try {
              videoEl.currentTime = resumeAt;
            } catch {
              /* ignore */
            }
          },
          { once: true }
        );
      }
      if (wantsPlayback()) {
        showSpinner();
        playVideoSafely(videoEl, slide.querySelector(".rail-audio-disc"));
      }
    };

    const showRetryBadge = () => {
      hideSpinner();
      if (retryBtn) return;
      retryBtn = document.createElement("div");
      retryBtn.className = "video-retry-badge";
      const label =
        lastErrorCode === 4 ? "Can't play this video · Tap to retry" : "Tap to Retry";
      retryBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        <span>${label}</span>
      `;
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retryCount = 0;
        watchdogTries = 0;
        retryBtn.remove();
        retryBtn = null;
        reloadVideo();
      });
      slide.appendChild(retryBtn);
    };

    // Stall watchdog: browsers often stall silently (no "error" event) on weak
    // mobile connections. If the active video is not playable after a while,
    // reload it; after 3 attempts show a tap-to-retry badge.
    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    const armWatchdog = () => {
      clearWatchdog();
      if (!isActiveSlide() || videoEl.readyState >= 3 || retryBtn) return;
      const delay = [8000, 12000, 16000][Math.min(watchdogTries, 2)];
      watchdog = setTimeout(() => {
        watchdog = null;
        if (!isActiveSlide() || videoEl.readyState >= 3 || !videoEl.isConnected) {
          return;
        }
        if (watchdogTries >= 3) {
          showRetryBadge();
          return;
        }
        watchdogTries++;
        reloadVideo();
        armWatchdog();
      }, delay);
    };
    videoEl._klipArmWatchdog = armWatchdog;
    videoEl._klipClearWatchdog = clearWatchdog;
    videoEl._klipReload = reloadVideo;
    videoEl._klipHideSpinner = hideSpinner;
    videoEl._klipShowSpinner = showSpinner;

    videoEl.addEventListener("loadstart", () => {
      if (isActiveSlide()) {
        showSpinner();
        armWatchdog();
      }
    });
    videoEl.addEventListener("waiting", () => {
      showSpinner();
      armWatchdog();
    });
    videoEl.addEventListener("stalled", () => {
      if (isActiveSlide() && videoEl.readyState < 3) {
        showSpinner();
        armWatchdog();
      }
    });
    videoEl.addEventListener("seeking", showSpinner);
    const syncActiveAudioState = () => {
      if (isActiveSlide()) {
        ensureAudioTracksEnabled(videoEl);
        const shouldMute = Boolean(state.userMuted || state.autoMuted);
        videoEl.defaultMuted = shouldMute;
        if (videoEl.muted !== shouldMute) {
          videoEl.muted = shouldMute;
        }
        if (videoEl.volume !== 1.0) {
          videoEl.volume = 1.0;
        }
      } else if (!videoEl.muted) {
        videoEl.muted = true;
      }
    };
    const onReady = () => {
      hideSpinner();
      clearWatchdog();
      watchdogTries = 0;
      retryCount = 0;
      if (retryBtn) {
        retryBtn.remove();
        retryBtn = null;
      }
      placeholderEl.style.opacity = "0";
      setTimeout(() => {
        if (placeholderEl.parentNode) placeholderEl.style.display = "none";
      }, 300);
      syncActiveAudioState();
    };
    let lastVideoTime = 0;
    let audioWakeAttempted = false;
    videoEl.addEventListener("loadedmetadata", () => {
      hideSpinner();
      syncActiveAudioState();
    });
    videoEl.addEventListener("loadeddata", () => {
      hideSpinner();
      syncActiveAudioState();
    });
    videoEl.addEventListener("playing", onReady);
    videoEl.addEventListener("canplay", onReady);
    videoEl.addEventListener("canplaythrough", onReady);
    videoEl.addEventListener("timeupdate", () => {
      if (!videoEl.paused && videoEl.readyState >= 3) {
        onReady();
      }
      // Wake Chromium/WebKit audio sink if a pre-buffered video started playing with 0 decoded audio bytes
      if (
        isActiveSlide() &&
        !videoEl.paused &&
        !videoEl.muted &&
        !audioWakeAttempted &&
        videoEl.currentTime > 0.35
      ) {
        audioWakeAttempted = true;
        ensureAudioTracksEnabled(videoEl);
        if (
          typeof videoEl.webkitAudioDecodedByteCount === "number" &&
          videoEl.webkitAudioDecodedByteCount === 0 &&
          (videoEl.webkitVideoDecodedByteCount || 0) > 0
        ) {
          videoEl.muted = true;
          videoEl.muted = false;
          videoEl.volume = 1.0;
        }
      }
      // Detect video loop wrap-around (matching OnVideoCompleted in MainPage.xaml.cs)
      const dur = videoEl.duration;
      const cur = videoEl.currentTime;
      if (
        isFinite(dur) &&
        dur > 1 &&
        lastVideoTime > dur - 0.7 &&
        cur < 0.6 &&
        isActiveSlide()
      ) {
        const profile = RecommendationService.getProfile();
        const loops = profile.VideoCompletionCounts[klip.Id] || 0;
        const type =
          loops >= 1
            ? VideoInteractionType.Rewatched
            : VideoInteractionType.WatchedEntire;
        RecommendationService.recordInteraction(klip, type);
      }
      lastVideoTime = cur;
    });

    videoEl.addEventListener("error", () => {
      hideSpinner();
      placeholderEl.style.display = "flex";
      placeholderEl.style.opacity = "1";
      lastErrorCode = videoEl.error?.code || 0;
      // Nothing to retry for slides that were intentionally unloaded.
      if (!videoEl.getAttribute("src")) return;
      if (retryCount < 2) {
        retryCount++;
        setTimeout(() => {
          if (videoEl.isConnected && videoEl.getAttribute("src")) reloadVideo();
        }, 1200 * retryCount);
      } else if (isActiveSlide()) {
        showRetryBadge();
      }
    });
  } else {
    const slideshowWrap = document.createElement("div");
    slideshowWrap.className = "photo-slideshow-container";

    const track = document.createElement("div");
    track.className = "photo-carousel-track";

    klip.PhotoUrls.forEach((url, pIdx) => {
      const item = document.createElement("div");
      item.className = "photo-slide-item";
      const img = document.createElement("img");
      img.alt = klip.Caption || "Klip photo";

      // Only load image source immediately for the very first visible slide (slide 0, photo 0)
      if (slideIndex === 0 && pIdx === 0) {
        img.src = url;
        img.loading = "eager";
        img.fetchPriority = "high";
        if (img.complete) {
          placeholderEl.style.display = "none";
        } else {
          img.addEventListener("load", () => {
            placeholderEl.style.opacity = "0";
            setTimeout(() => { if (placeholderEl.parentNode) placeholderEl.style.display = "none"; }, 300);
          }, { once: true });
        }
      } else {
        // Deferred lazy-load so off-screen photos never compete with active video bandwidth
        img.dataset.src = url;
        img.loading = "lazy";
      }
      item.appendChild(img);
      track.appendChild(item);
    });

    slideshowWrap.appendChild(track);

    if (klip.isMultiPhotoSlideshow) {
      // Desktop Prev/Next buttons
      const prevBtn = document.createElement("button");
      prevBtn.className = "photo-nav-btn prev";
      prevBtn.setAttribute("aria-label", "Previous photo");
      prevBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`;
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const w = track.clientWidth || 1;
        const idx = Math.max(0, Math.round(track.scrollLeft / w) - 1);
        track.scrollTo({ left: idx * w, behavior: "smooth" });
      });

      const nextBtn = document.createElement("button");
      nextBtn.className = "photo-nav-btn next";
      nextBtn.setAttribute("aria-label", "Next photo");
      nextBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`;
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const w = track.clientWidth || 1;
        const idx = Math.min(
          klip.PhotoUrls.length - 1,
          Math.round(track.scrollLeft / w) + 1
        );
        track.scrollTo({ left: idx * w, behavior: "smooth" });
      });

      slideshowWrap.appendChild(prevBtn);
      slideshowWrap.appendChild(nextBtn);

      // Top-Right Counter Pill
      const counterPill = document.createElement("div");
      counterPill.className = "photo-counter-pill";
      counterPill.textContent = `1/${klip.PhotoUrls.length}`;
      slideshowWrap.appendChild(counterPill);

      // Bottom Indicator Dots
      const dotsRow = document.createElement("div");
      dotsRow.className = "photo-dots-row";
      const dots = klip.PhotoUrls.map((_, idx) => {
        const d = document.createElement("div");
        d.className = `photo-dot${idx === 0 ? " active" : ""}`;
        dotsRow.appendChild(d);
        return d;
      });
      slideshowWrap.appendChild(dotsRow);

      track.addEventListener(
        "scroll",
        () => {
          const w = track.clientWidth || 1;
          const pos = Math.min(
            Math.max(Math.round(track.scrollLeft / w), 0),
            klip.PhotoUrls.length - 1
          );
          klip.CurrentPhotoPosition = pos;
          counterPill.textContent = `${pos + 1}/${klip.PhotoUrls.length}`;
          dots.forEach((d, idx) => d.classList.toggle("active", idx === pos));
        },
        { passive: true }
      );
    }

    slide.appendChild(slideshowWrap);
  }

  // 2. Center Play Indicator (Visible only when paused by user tap on a video)
  const playIndicator = document.createElement("div");
  playIndicator.className = "center-play-indicator";
  playIndicator.style.display = klip.IsPausedByUser ? "flex" : "none";
  playIndicator.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8,5 V19 L19,12 Z"/></svg>`;
  slide.appendChild(playIndicator);

  // 3. Bottom Scrim
  const scrim = document.createElement("div");
  scrim.className = "bottom-scrim";
  slide.appendChild(scrim);

  // 4. Right Action Rail
  const rail = document.createElement("div");
  rail.className = "right-action-rail";

  // Creator Avatar + Follow Badge
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "rail-avatar-wrap";

  const avatarCircle = document.createElement("div");
  avatarCircle.className = "rail-avatar-circle";
  const avatarSrc = klip.CreatorAvatarUrl || "";
  const hasAvatar = Boolean(avatarSrc && avatarSrc.trim());
  avatarCircle.innerHTML = `
    <img class="rail-creator-img" ${hasAvatar ? `src="${escapeHtml(avatarSrc)}"` : ""} loading="lazy" alt="" style="display: ${hasAvatar ? "block" : "none"};" />
    <span class="rail-avatar-initials" style="display: ${hasAvatar ? "none" : "inline"};">${escapeHtml(klip.CreatorInitials)}</span>
  `;
  avatarCircle.addEventListener("click", (e) => {
    e.stopPropagation();
    openCreatorProfile(klip);
  });
  avatarWrap.appendChild(avatarCircle);

  const followBadge = document.createElement("div");
  followBadge.className = "rail-follow-badge";
  followBadge.style.display = klip.followBadgeVisible ? "flex" : "none";
  followBadge.innerHTML = `
    <svg viewBox="0 0 20 20" fill="none">
      <path class="follow-badge-path" d="${PLUS_PATH}" stroke="#0B0E17" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
  followBadge.addEventListener("click", async (e) => {
    e.stopPropagation();
    await handleFollowBadgeClicked(klip, followBadge);
  });
  avatarWrap.appendChild(followBadge);
  rail.appendChild(avatarWrap);

  // Like Button (Shkoyach Heart)
  const likeBtn = document.createElement("div");
  likeBtn.className = "rail-action-btn like-action-btn";
  likeBtn.innerHTML = `
    <svg class="rail-action-icon heart-svg" viewBox="0 0 24 24" width="26" height="26">
      <path class="heart-path" d="${HEART_PATH}" fill="${klip.IsLiked ? "#FF2D55" : "#FFFFFF"}" />
    </svg>
    <span class="rail-action-count like-count-label">${klip.LikesCount}</span>
  `;
  likeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleLikeClicked(klip, likeBtn);
  });
  rail.appendChild(likeBtn);

  // Comments Button (In between Like and Bookmark, matching App version)
  const commentBtn = document.createElement("div");
  commentBtn.className = "rail-action-btn comments-action-btn";
  commentBtn.innerHTML = `
    <svg class="rail-action-icon comment-svg" viewBox="0 0 24 24" width="25" height="25">
      <path class="comment-path" d="${COMMENT_PATH}" fill="#FFFFFF" />
    </svg>
    <span class="rail-action-count comments-count-label">${klip.CommentsCount ?? 0}</span>
  `;
  commentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCommentsModal(klip);
  });
  rail.appendChild(commentBtn);

  // Bookmark Button
  const bookmarkBtn = document.createElement("div");
  bookmarkBtn.className = "rail-action-btn bookmark-action-btn";
  bookmarkBtn.innerHTML = `
    <svg class="rail-action-icon bookmark-svg" viewBox="0 0 24 24" width="24" height="24">
      <path class="bookmark-path" d="${BOOKMARK_PATH}" fill="${klip.IsBookmarked ? "#FACC15" : "#FFFFFF"}" />
    </svg>
    <span class="rail-action-count bookmark-count-label">${klip.BookmarksCount}</span>
  `;
  bookmarkBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleBookmarkClicked(klip, bookmarkBtn);
  });
  rail.appendChild(bookmarkBtn);

  // Views Counter (Eye Icon)
  const viewsBtn = document.createElement("div");
  viewsBtn.className = "rail-action-btn views-action-btn";
  viewsBtn.style.cursor = "default";
  viewsBtn.innerHTML = `
    <svg class="rail-action-icon views-svg" viewBox="0 0 24 24" width="24" height="24">
      <path d="${EYE_PATH}" fill="#FFFFFF" />
    </svg>
    <span class="rail-action-count views-count-label">${klip.ViewsCount ?? 0}</span>
  `;
  rail.appendChild(viewsBtn);

  // Share Button
  const shareBtn = document.createElement("div");
  shareBtn.className = "rail-action-btn";
  shareBtn.innerHTML = `
    <svg class="rail-action-icon" viewBox="0 0 24 24" width="24" height="24">
      <path d="${SHARE_PATH}" fill="#FFFFFF" />
    </svg>
    <span class="rail-action-count">${escapeHtml(klip.SharesCount)}</span>
  `;
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openShareModal(klip);
  });
  rail.appendChild(shareBtn);

  // Delete Button (only visible on your own Klips)
  const deleteBtn = document.createElement("div");
  deleteBtn.className = "rail-action-btn rail-delete-btn";
  deleteBtn.title = "Delete Klip";
  deleteBtn.style.display = isOwnKlip(klip) ? "flex" : "none";
  deleteBtn.innerHTML = `
    <svg class="rail-action-icon" viewBox="0 0 24 24" width="24" height="24" fill="none">
      <path d="${TRASH_PATH}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span class="rail-action-count">Delete</span>
  `;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openDeleteConfirm(klip);
  });
  rail.appendChild(deleteBtn);

  // Audio Disc
  const disc = document.createElement("div");
  disc.className = "rail-audio-disc";
  disc.textContent = "♪";
  rail.appendChild(disc);

  slide.appendChild(rail);

  // 5. Bottom-Left Info Overlay
  const info = document.createElement("div");
  info.className = "bottom-info-overlay";

  if (klip.isPhotoPost) {
    const badge = document.createElement("div");
    badge.className = "photo-badge-pill";
    badge.textContent = klip.photoBadgeText;
    info.appendChild(badge);
  }

  const handleEl = document.createElement("div");
  handleEl.className = "klip-creator-handle";
  handleEl.textContent = klip.CreatorHandle;
  handleEl.addEventListener("click", (e) => {
    e.stopPropagation();
    openCreatorProfile(klip);
  });
  info.appendChild(handleEl);

  if (klip.Caption) {
    const capEl = document.createElement("div");
    capEl.className = "klip-caption-text";
    capEl.textContent = klip.Caption;
    info.appendChild(capEl);
  }

  if (klip.hashtags) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "klip-hashtags-text";
    tagsEl.textContent = klip.hashtags;
    tagsEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const firstTag = klip.Tags[0] || klip.hashtags;
      pushSubpage("SearchPage", { query: firstTag });
    });
    info.appendChild(tagsEl);
  }

  const soundRow = document.createElement("div");
  soundRow.className = "klip-sound-row";
  soundRow.setAttribute("role", "button");
  soundRow.setAttribute("tabindex", "0");
  soundRow.setAttribute("aria-label", "View sound details");
  const displaySoundTitle = klip.SoundTitle || `Original Sound - ${klip.CreatorHandle || "@user"}`;
  soundRow.innerHTML = `
    <span class="klip-sound-icon">♫</span>
    <span class="klip-sound-title">${escapeHtml(displaySoundTitle)}</span>
  `;

  let lastSoundOpenTime = 0;
  const triggerSoundOpen = (e) => {
    if (e) {
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastSoundOpenTime < 400) return;
    lastSoundOpenTime = now;

    pushSubpage("SoundDetailPage", {
      soundTitle: displaySoundTitle,
      soundId: klip.SoundId || `sound_${klip.Id}`,
      creatorHandle: klip.CreatorHandle || "@user",
      creatorUid: klip.CreatorUid || "",
      audioUrl: klip.SoundAudioUrl || klip.VideoUrl || "",
      klip: klip,
    });
  };

  soundRow.addEventListener("click", triggerSoundOpen);
  soundRow.addEventListener("touchend", triggerSoundOpen);
  soundRow.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      triggerSoundOpen(e);
    }
  });
  info.appendChild(soundRow);

  slide.appendChild(info);

  // 6. Single-Tap vs Double-Tap Surface Handler (Matches MainPage.xaml.cs lines 411-449)
  let lastTapTime = 0;
  let singleTapTimer = null;

  slide.addEventListener("click", (e) => {
    // Ignore clicks on interactive buttons
    if (
      e.target.closest(".right-action-rail") ||
      e.target.closest(".klip-creator-handle") ||
      e.target.closest(".klip-hashtags-text") ||
      e.target.closest(".klip-sound-row") ||
      e.target.closest(".photo-nav-btn")
    ) {
      return;
    }

    const now = Date.now();
    const isDoubleTap = now - lastTapTime <= 320;
    lastTapTime = now;

    if (isDoubleTap) {
      if (singleTapTimer) {
        clearTimeout(singleTapTimer);
        singleTapTimer = null;
      }
      const rootGrid =
        contextType === "detail"
          ? document.getElementById("detailRootGrid")
          : document.getElementById("homeRootGrid");
      const heartOverlay =
        contextType === "detail"
          ? document.getElementById("detailDoubleTapHeart")
          : document.getElementById("mainDoubleTapHeart");
      handleVideoDoubleTap(klip, e, rootGrid, heartOverlay);
      return;
    }

    if (klip.isPhotoPost) {
      return;
    }

    if (singleTapTimer) clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      const videoEl = slide.querySelector("video.klip-video-element");
      if (!videoEl) return;

      // If this tap just unlocked browser auto-mute (or the video is still muted while playing),
      // unmute and keep playing with sound instead of pausing the video!
      if (
        Date.now() - (state.lastAutoUnmuteAt || 0) < 420 ||
        (!videoEl.paused && (state.autoMuted || (videoEl.muted && !state.userMuted)))
      ) {
        state.autoMuted = false;
        state.userMuted = false;
        updateSoundIcons();
        videoEl.defaultMuted = false;
        videoEl.muted = false;
        videoEl.volume = 1.0;
        klip.IsPausedByUser = false;
        klip.IsPaused = false;
        playIndicator.style.display = "none";
        const audioDisc = slide.querySelector(".rail-audio-disc");
        if (videoEl.paused) {
          playVideoSafely(videoEl, audioDisc);
        } else {
          audioDisc?.classList.add("spinning");
        }
        return;
      }

      const nextPaused = !videoEl.paused;
      klip.IsPausedByUser = nextPaused;
      klip.IsPaused = nextPaused;
      playIndicator.style.display = nextPaused ? "flex" : "none";
      const audioDisc = slide.querySelector(".rail-audio-disc");

      if (nextPaused) {
        videoEl.pause();
        audioDisc?.classList.remove("spinning");
      } else {
        playVideoSafely(videoEl, audioDisc);
      }
    }, 230);
  });

  return slide;
}

// User gesture unlock for desktop & mobile browsers when initial unmuted autoplay is blocked
let gestureUnlockArmed = false;
function unlockAudioFromUserGesture(e) {
  if (e?.type === "keydown" && (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta")) {
    return;
  }
  gestureUnlockArmed = false;
  window.removeEventListener("pointerdown", unlockAudioFromUserGesture, true);
  window.removeEventListener("mousedown", unlockAudioFromUserGesture, true);
  window.removeEventListener("touchstart", unlockAudioFromUserGesture, true);
  window.removeEventListener("touchend", unlockAudioFromUserGesture, true);
  window.removeEventListener("click", unlockAudioFromUserGesture, true);
  window.removeEventListener("keydown", unlockAudioFromUserGesture, true);

  if (!state.userMuted) {
    const wasAutoMuted = state.autoMuted;
    state.autoMuted = false;
    updateSoundIcons();
    if (wasAutoMuted) {
      state.lastAutoUnmuteAt = Date.now();
    }
    document
      .querySelectorAll('video.klip-video-element[data-active="1"]')
      .forEach((v) => {
        ensureAudioTracksEnabled(v);
        v.defaultMuted = false;
        v.muted = false;
        v.volume = 1.0;
        const slide = v.closest(".feed-slide");
        const disc = slide?.querySelector(".rail-audio-disc");
        if (v.paused) {
          playVideoSafely(v, disc);
        }
      });
  }
}

function registerUserGestureUnlock() {
  if (gestureUnlockArmed) return;
  gestureUnlockArmed = true;
  window.addEventListener("pointerdown", unlockAudioFromUserGesture, { capture: true });
  window.addEventListener("mousedown", unlockAudioFromUserGesture, { capture: true });
  window.addEventListener("touchstart", unlockAudioFromUserGesture, { capture: true });
  window.addEventListener("touchend", unlockAudioFromUserGesture, { capture: true });
  window.addEventListener("click", unlockAudioFromUserGesture, { capture: true });
  window.addEventListener("keydown", unlockAudioFromUserGesture, { capture: true });
}

// Recover stuck/stopped playback when the connection returns or the tab becomes visible again.
function recoverActiveVideos() {
  document
    .querySelectorAll('video.klip-video-element[data-active="1"]')
    .forEach((v) => {
      if (!v.isConnected || !v.dataset.src) return;
      if (!v.getAttribute("src") || v.error || v.readyState < 2) {
        v._klipReload?.();
      }
    });
}
window.addEventListener("online", recoverActiveVideos);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    document.querySelectorAll("video.klip-video-element").forEach((v) => {
      if (!v.paused) v.pause();
    });
  } else {
    const page = getActivePageId();
    if (page === "MainPage") activateCurrentFeedVideo();
    else if (page === "VideoDetailPage") activateCurrentDetailVideo();
    recoverActiveVideos();
  }
});

async function playVideoSafely(videoEl, audioDisc) {
  if (!videoEl) return;
  const callId = (videoEl._klipPlayCallId = (videoEl._klipPlayCallId || 0) + 1);
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.setAttribute("autoplay", "");
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("webkit-playsinline", "true");
  videoEl.setAttribute("x5-playsinline", "true");
  videoEl.volume = 1.0;
  ensureAudioTracksEnabled(videoEl);

  const slide = videoEl.closest(".feed-slide");
  const playOverlay = slide?.querySelector(".center-play-indicator");
  if (playOverlay) playOverlay.style.display = "none";

  // Always try unmuted playback first unless the user explicitly clicked Mute
  const wantMuted = Boolean(state.userMuted);
  videoEl.defaultMuted = wantMuted;
  videoEl.muted = wantMuted;
  if (wantMuted) {
    videoEl.setAttribute("muted", "");
  } else {
    videoEl.removeAttribute("muted");
  }

  try {
    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      await playPromise;
    }
    if (videoEl._klipPlayCallId !== callId) return;
    if (!wantMuted) {
      state.autoMuted = false;
      updateSoundIcons();
      videoEl.defaultMuted = false;
      videoEl.muted = false;
      videoEl.removeAttribute("muted");
      videoEl.volume = 1.0;
    }
    if (playOverlay) playOverlay.style.display = "none";
    audioDisc?.classList.add("spinning");
  } catch (err) {
    if (videoEl._klipPlayCallId !== callId) return;
    // play() interrupted by a pause()/load()/src change (normal while scrolling
    // or recovering) or the source can't be decoded: this is NOT an autoplay
    // block, so don't force-mute the whole app or show the play overlay.
    if (err?.name === "AbortError" || err?.name === "NotSupportedError") {
      return;
    }
    // Browser blocked unmuted autoplay before first user gesture:
    // fall back to muted autoplay with explicit DOM attribute so it starts IMMEDIATELY (never start paused).
    videoEl.defaultMuted = true;
    videoEl.muted = true;
    videoEl.setAttribute("muted", "");
    registerUserGestureUnlock();
    try {
      const retryPromise = videoEl.play();
      if (retryPromise !== undefined) {
        await retryPromise;
      }
      if (videoEl._klipPlayCallId !== callId) return;
      if (playOverlay) playOverlay.style.display = "none";
      audioDisc?.classList.add("spinning");
    } catch (retryErr) {
      if (videoEl._klipPlayCallId !== callId) return;
      if (retryErr?.name === "AbortError" || retryErr?.name === "NotSupportedError") {
        return;
      }
      // Browser strictly requires user touch gesture: show play overlay so user can tap
      registerUserGestureUnlock();
      if (videoEl.paused && playOverlay) {
        playOverlay.style.display = "flex";
      }
    }
  }
}

// Attach video source with adaptive HLS streaming (Cloudflare Stream) and MP4 fallback
function attachVideoToElement(v, src) {
  if (!v || !src) return;
  if (v._currentLoadedSrc === src && (v.getAttribute("src") || v._hlsInstance)) return;
  v._currentLoadedSrc = src;

  if (v._hlsInstance) {
    try {
      v._hlsInstance.destroy();
    } catch (_) {}
    v._hlsInstance = null;
  }

  const isHls = src.includes(".m3u8") || src.includes("cloudflarestream.com");
  if (isHls) {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        startFragPrefetch: true,
        progressive: true,
        backBufferLength: 15,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        testBandwidth: false,
        fpsDroppedMonitoring: false,
      });
      hls.loadSource(src);
      hls.attachMedia(v);
      v._hlsInstance = hls;
    } else if (v.canPlayType && v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
    } else {
      v.src = src;
    }
  } else {
    v.src = src;
  }
}

// Detach a video's network source (aborts any in-flight download, frees decoder memory).
function unloadVideoElement(v) {
  v._klipClearWatchdog?.();
  v.dataset.active = "0";
  if (!v.paused) v.pause();

  if (v._hlsInstance) {
    try {
      v._hlsInstance.destroy();
    } catch (_) {}
    v._hlsInstance = null;
  }
  v._currentLoadedSrc = "";

  if (v.getAttribute("src")) {
    v.removeAttribute("src");
    v.preload = "none";
    v.load();
  }
  v._klipHideSpinner?.();
  const slide = v.closest(".feed-slide");
  const placeholder = slide?.querySelector(".feed-slide-placeholder");
  if (placeholder) {
    placeholder.style.display = "flex";
    placeholder.style.opacity = "1";
  }
}

// In-memory & session-persistent cache for static video thumbnails
const staticThumbnailCache = new Map();
try {
  const saved = sessionStorage.getItem("klip_thumbs_v2");
  if (saved) {
    const parsed = JSON.parse(saved);
    for (const [k, v] of Object.entries(parsed)) {
      if (k && v) staticThumbnailCache.set(k, v);
    }
  }
} catch (_) {}

function saveThumbnailToCache(klipId, dataUrl) {
  if (!klipId || !dataUrl) return;
  staticThumbnailCache.set(klipId, dataUrl);
  try {
    if (staticThumbnailCache.size <= 80) {
      const obj = Object.fromEntries(staticThumbnailCache);
      sessionStorage.setItem("klip_thumbs_v2", JSON.stringify(obj));
    }
  } catch (_) {}
}

let activeTileVideoLoadCount = 0;
const MAX_CONCURRENT_TILE_LOADS = 6;
let pendingTileVideoLoads = [];

function pumpTileVideoQueue() {
  while (activeTileVideoLoadCount < MAX_CONCURRENT_TILE_LOADS && pendingTileVideoLoads.length > 0) {
    const v = pendingTileVideoLoads.shift();
    if (!v || !v.isConnected || v.getAttribute("src")) continue;
    activeTileVideoLoadCount++;
    loadTileVideoFrame(v, () => {
      activeTileVideoLoadCount = Math.max(0, activeTileVideoLoadCount - 1);
      pumpTileVideoQueue();
    });
  }
}

function loadTileVideoFrame(v, onDone) {
  const klipId = v.dataset.klipId;
  const src = v.dataset.src;
  if (!src) {
    if (onDone) onDone();
    return;
  }

  // 1. Instant cache check
  if (klipId && staticThumbnailCache.has(klipId)) {
    replaceVideoWithImage(v, staticThumbnailCache.get(klipId));
    if (onDone) onDone();
    return;
  }

  let completed = false;
  let safetyTimer = null;

  const finish = (imgDataUrl = null) => {
    if (completed) return;
    completed = true;
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (imgDataUrl && klipId) {
      saveThumbnailToCache(klipId, imgDataUrl);
      replaceVideoWithImage(v, imgDataUrl);
      try {
        FirebaseService.saveKlipThumbnailAsync(klipId, imgDataUrl);
      } catch (_) {}
    }
    if (onDone) onDone();
  };

  // 2. Safety timeout: never hang the queue even if network drops
  safetyTimer = setTimeout(() => {
    finish(null);
  }, 4000);

  // 3. Setup video element for initial frame decode
  v.crossOrigin = "anonymous";
  v.preload = "auto";
  v.muted = true;
  v.playsInline = true;

  const capture = () => {
    try {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const w = Math.min(260, v.videoWidth);
        const h = Math.min(360, v.videoHeight);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(v, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        if (dataUrl && dataUrl.length > 500) {
          finish(dataUrl);
          return;
        }
      }
    } catch (_) {
      // If canvas is tainted or cannot be exported, the video element remains in DOM displaying the frame
    }
    finish(null);
  };

  v.onloadeddata = () => {
    if (v.currentTime >= 0.05) {
      capture();
    } else {
      try {
        v.currentTime = 0.1;
      } catch (_) {
        capture();
      }
    }
  };

  v.onseeked = () => capture();
  v.onerror = () => finish(null);

  v.src = src;
}

function replaceVideoWithImage(v, imgUrl) {
  if (!v || !v.parentNode) return;
  const img = document.createElement("img");
  img.className = "klip-grid-tile-media";
  img.src = imgUrl;
  img.loading = "lazy";
  v.parentNode.replaceChild(img, v);
  try {
    v.removeAttribute("src");
    v.load();
  } catch (_) {}
}

function clearPendingTileVideoLoads() {
  pendingTileVideoLoads = [];
}

// Detached <video> elements keep downloading until GC; always release before removing.
function releaseVideosIn(containerEl) {
  if (!containerEl) return;
  clearPendingTileVideoLoads();
  containerEl.querySelectorAll("video").forEach((v) => {
    if (v._klipClearWatchdog) v._klipClearWatchdog();
    if (!v.paused) v.pause();
    if (v.getAttribute("src")) {
      v.removeAttribute("src");
      v.load();
    }
    if (tileVideoObserver) tileVideoObserver.unobserve(v);
  });
}

// Grid thumbnails: only fetch a video's first frame once its tile is near the viewport, throttled!
const tileVideoObserver =
  typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const v = entry.target;
          tileVideoObserver.unobserve(v);
          if (v.dataset.src && !v.getAttribute("src")) {
            const klipId = v.dataset.klipId;
            if (klipId && staticThumbnailCache.has(klipId)) {
              replaceVideoWithImage(v, staticThumbnailCache.get(klipId));
            } else {
              pendingTileVideoLoads.push(v);
              pumpTileVideoQueue();
            }
          }
        });
      },
      { rootMargin: "150px" }
    )
    : null;

function pauseAllCarouselVideos(carouselEl, unload = false) {
  if (!carouselEl) return;
  carouselEl.querySelectorAll(".feed-slide").forEach((slide) => {
    const v = slide.querySelector("video.klip-video-element");
    if (v) {
      v.dataset.active = "0";
      v._klipClearWatchdog?.();
      if (unload) unloadVideoElement(v);
      else if (!v.paused) v.pause();
    }
    const disc = slide.querySelector(".rail-audio-disc");
    disc?.classList.remove("spinning");
  });
}

// ==================== SYNC VIDEO STATE ACROSS ALL LISTS & DOM ====================
function syncVideoAcrossAllViews(source) {
  const lists = [
    state.feedItems,
    state.followingItems,
    state.femaleItems,
    state.detailPlaylist,
    state.profileDisplayedKlips,
    state.creatorKlips,
    state.searchFilteredKlips,
  ];

  for (const list of lists) {
    for (const item of list) {
      if (item.Id === source.Id && item !== source) {
        item.IsLiked = source.IsLiked;
        item.LikesCount = source.LikesCount;
        item.IsBookmarked = source.IsBookmarked;
        item.BookmarksCount = source.BookmarksCount;
        item.ViewsCount = Math.max(
          Number(item.ViewsCount) || 0,
          Number(source.ViewsCount) || 0
        );
        source.ViewsCount = Math.max(
          Number(source.ViewsCount) || 0,
          Number(item.ViewsCount) || 0
        );
        item.IsFollowed = source.IsFollowed;
        item.CreatorAvatarUrl = source.CreatorAvatarUrl;
      }
    }
  }

  // Update all rendered DOM slides with this klipId
  document
    .querySelectorAll(`.feed-slide[data-klip-id="${CSS.escape(source.Id)}"]`)
    .forEach((slide) => {
      const heartPath = slide.querySelector(".heart-path");
      if (heartPath) {
        heartPath.setAttribute("fill", source.IsLiked ? "#FF2D55" : "#FFFFFF");
      }
      const likeCount = slide.querySelector(".like-count-label");
      if (likeCount) {
        likeCount.textContent = String(source.LikesCount);
      }
      const commentCount = slide.querySelector(".comments-count-label");
      if (commentCount) {
        commentCount.textContent = String(source.CommentsCount ?? 0);
      }
      const bookmarkPath = slide.querySelector(".bookmark-path");
      if (bookmarkPath) {
        bookmarkPath.setAttribute(
          "fill",
          source.IsBookmarked ? "#FACC15" : "#FFFFFF"
        );
      }
      const bookmarkCount = slide.querySelector(".bookmark-count-label");
      if (bookmarkCount) {
        bookmarkCount.textContent = String(source.BookmarksCount);
      }
      const viewsCount = slide.querySelector(".views-count-label");
      if (viewsCount) {
        viewsCount.textContent = String(source.ViewsCount ?? 0);
      }
      const followBadge = slide.querySelector(".rail-follow-badge");
      if (followBadge) {
        followBadge.style.display = source.followBadgeVisible ? "flex" : "none";
      }
      const deleteBtn = slide.querySelector(".rail-delete-btn");
      if (deleteBtn) {
        deleteBtn.style.display = isOwnKlip(source) ? "flex" : "none";
      }

      // Sync Creator Avatar & Initials
      const railImg = slide.querySelector(".rail-creator-img");
      const railInit = slide.querySelector(".rail-avatar-initials");
      const avUrl = source.CreatorAvatarUrl || "";
      const hasAv = Boolean(avUrl && avUrl.trim());
      if (railImg) {
        if (hasAv) {
          if (railImg.src !== avUrl) railImg.src = avUrl;
          railImg.style.display = "block";
        } else {
          railImg.style.display = "none";
        }
      }
      if (railInit) {
        railInit.style.display = hasAv ? "none" : "inline";
      }
    });

  // Update any rendered grid tiles with this klipId
  document
    .querySelectorAll(`.klip-tile-bottom[data-klip-id="${CSS.escape(source.Id)}"]`)
    .forEach((row) => {
      const viewsEl = row.querySelector(".klip-tile-views-count");
      if (viewsEl) viewsEl.textContent = String(source.ViewsCount ?? 0);
      const likesEl = row.querySelector(".klip-tile-likes-count");
      if (likesEl) likesEl.textContent = String(source.LikesCount ?? 0);
    });
}

// ==================== DOUBLE-TAP HEART, LIKE, BOOKMARK, FOLLOW ACTIONS ====================
let heartAnimVersion = 0;

function handleVideoDoubleTap(klip, event, rootGrid, heartEl) {
  if (!klip.IsLiked) {
    klip.IsLiked = true;
    klip.LikesCount += 1;
    syncVideoAcrossAllViews(klip);
    FirebaseService.setLikeAsync(klip, true);
    RecommendationService.recordInteraction(klip, VideoInteractionType.Liked);
  }

  if (!rootGrid || !heartEl) return;
  const rect = rootGrid.getBoundingClientRect();
  const tapX = (event.clientX || rect.left + rect.width / 2) - rect.left;
  const tapY = (event.clientY || rect.top + rect.height / 2) - rect.top;

  const currentVer = ++heartAnimVersion;
  const rotation = Math.floor(Math.random() * 29) - 14;
  const baseX = tapX - 45;
  const baseY = tapY - 45;

  heartEl.style.display = "flex";
  heartEl.style.transition = "none";
  heartEl.style.opacity = "0.65";
  heartEl.style.transform = `translate(${baseX}px, ${baseY}px) rotate(${rotation}deg) scale(0.4)`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (currentVer !== heartAnimVersion) return;
      heartEl.style.transition =
        "transform 130ms cubic-bezier(0.22, 1, 0.36, 1), opacity 130ms ease-out";
      heartEl.style.opacity = "1";
      heartEl.style.transform = `translate(${baseX}px, ${baseY}px) rotate(${rotation}deg) scale(1.15)`;

      setTimeout(() => {
        if (currentVer !== heartAnimVersion) return;
        heartEl.style.transition = "transform 70ms ease-in";
        heartEl.style.transform = `translate(${baseX}px, ${baseY}px) rotate(${rotation}deg) scale(1.0)`;

        setTimeout(() => {
          if (currentVer !== heartAnimVersion) return;
          heartEl.style.transition =
            "transform 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 340ms ease-in";
          heartEl.style.transform = `translate(${baseX}px, ${baseY - 55}px) rotate(${rotation}deg) scale(1.3)`;
          heartEl.style.opacity = "0";

          setTimeout(() => {
            if (currentVer === heartAnimVersion) {
              heartEl.style.display = "none";
            }
          }, 350);
        }, 70);
      }, 130);
    });
  });
}

function triggerIconBounce(svgEl) {
  if (!svgEl) return;
  svgEl.classList.remove("pop-anim");
  void svgEl.offsetWidth;
  svgEl.classList.add("pop-anim");
}

function handleLikeClicked(klip, btnEl) {
  if (!FirebaseService.isLoggedIn) {
    showToast("Sign in on the Profile tab to give a Shkoyach ♥");
    switchRootTab("ProfilePage");
    return;
  }

  klip.IsLiked = !klip.IsLiked;
  klip.LikesCount = Math.max(0, klip.LikesCount + (klip.IsLiked ? 1 : -1));
  syncVideoAcrossAllViews(klip);

  // Dynamically update creator / profile Shkoyach counter if on screen
  if (state.creatorUid && state.creatorUid === klip.CreatorUid) {
    const creatorShkoyachEl = document.getElementById("creatorShkoyachCount");
    if (creatorShkoyachEl) {
      const cur = Number(creatorShkoyachEl.textContent) || 0;
      creatorShkoyachEl.textContent = String(Math.max(0, cur + (klip.IsLiked ? 1 : -1)));
    }
  }
  if (FirebaseService.currentUid && FirebaseService.currentUid === klip.CreatorUid) {
    const profileShkoyachEl = document.getElementById("profileShkoyachCount");
    if (profileShkoyachEl) {
      const cur = Number(profileShkoyachEl.textContent) || 0;
      profileShkoyachEl.textContent = String(Math.max(0, cur + (klip.IsLiked ? 1 : -1)));
    }
  }

  FirebaseService.setLikeAsync(klip, klip.IsLiked);
  if (klip.IsLiked) {
    RecommendationService.recordInteraction(klip, VideoInteractionType.Liked);
  }

  const svg = btnEl.querySelector(".heart-svg");
  triggerIconBounce(svg);
}

function handleBookmarkClicked(klip, btnEl) {
  if (!FirebaseService.isLoggedIn) {
    showToast("Sign in on the Profile tab to save Klips");
    switchRootTab("ProfilePage");
    return;
  }

  klip.IsBookmarked = !klip.IsBookmarked;
  klip.BookmarksCount = Math.max(
    0,
    klip.BookmarksCount + (klip.IsBookmarked ? 1 : -1)
  );
  syncVideoAcrossAllViews(klip);
  FirebaseService.setBookmarkAsync(klip, klip.IsBookmarked);

  const svg = btnEl.querySelector(".bookmark-svg");
  triggerIconBounce(svg);
}

async function handleFollowBadgeClicked(klip, badgeEl) {
  if (!FirebaseService.isLoggedIn) {
    showToast("Sign in on the Profile tab to follow creators");
    switchRootTab("ProfilePage");
    return;
  }
  if (klip.IsFollowed) return;

  const pathEl = badgeEl.querySelector(".follow-badge-path");
  if (pathEl) {
    pathEl.setAttribute("d", CHECKMARK_PATH);
  }

  FirebaseService.followCreatorAsync(klip.CreatorUid);
  RecommendationService.recordInteraction(
    klip,
    VideoInteractionType.FollowedCreator
  );

  badgeEl.style.transform = "translateX(-50%) scale(1.3)";
  await new Promise((r) => setTimeout(r, 130));
  badgeEl.style.transform = "translateX(-50%) scale(1.0)";
  await new Promise((r) => setTimeout(r, 320));
  badgeEl.style.transform = "translateX(-50%) scale(0)";
  badgeEl.style.opacity = "0";
  await new Promise((r) => setTimeout(r, 180));

  for (const item of state.feedItems) {
    if (item.CreatorUid === klip.CreatorUid) {
      item.IsFollowed = true;
      if (!state.followingItems.some((f) => f.Id === item.Id)) {
        state.followingItems.push(item.createTabClone());
      }
    }
  }
  renderCarouselList(
    document.getElementById("followingCarousel"),
    state.followingItems,
    "main"
  );
  syncVideoAcrossAllViews(klip);
}

function openCreatorProfile(klip) {
  pushSubpage("CreatorProfilePage", {
    uid: klip.CreatorUid || "",
    handle: klip.CreatorHandle || "@user",
    initials: klip.CreatorInitials || "KL",
  });
}

// ==================== MAIN PAGE (HOME FEED) CONTROLLER ====================
let hasPlayedLaunchSplash = false;

function isCurrentUserFemale() {
  const profile = FirebaseService.currentUser;
  if (profile) {
    return (
      !profile.isMale ||
      String(profile.Gender || "").toLowerCase() === "female"
    );
  }
  const savedGender = localStorage.getItem("fb_gender") || "Male";
  return String(savedGender).toLowerCase() === "female";
}

function updateFemaleTabVisibility() {
  const isFemale = isCurrentUserFemale();
  const tabsContainer = document.getElementById("feedTabsContainer");
  const femaleTabCell = document.getElementById("femaleTabCell");
  const femaleCarousel = document.getElementById("femaleCarousel");

  if (tabsContainer) {
    tabsContainer.classList.toggle("has-female-tab", isFemale);
  }
  if (femaleTabCell) {
    femaleTabCell.style.display = isFemale ? "block" : "none";
  }
  if (!isFemale && state.activeFeedTab === "Female") {
    switchHomeFeedTab("ForYou");
  }
}

async function onMainPageAppearing() {
  updateFemaleTabVisibility();
  if (!hasPlayedLaunchSplash) {
    hasPlayedLaunchSplash = true;
    const splashOverlay = document.getElementById("launchSplashOverlay");
    const logoCard = document.getElementById("launchLogoCard");
    const tabBar = document.getElementById("bottomTabBar");

    if (tabBar) tabBar.style.opacity = "0";

    // If we have a cached feed snapshot in localStorage, rank & render it
    // immediately with explicit refresh randomization while the fresh network sync runs in parallel!
    const cachedSnapshot = FirebaseService.getCachedKlipsSnapshot().filter(
      (k) => (k.isVideoPost && k.VideoUrl) || (k.isPhotoPost && k.PhotoUrls?.length > 0)
    );
    if (cachedSnapshot.length > 0 && state.feedItems.length === 0) {
      applyFeedDataToCarousels(cachedSnapshot, new Set(), {
        isExplicitRefresh: true,
      });
    }

    const introPromise = (async () => {
      requestAnimationFrame(() => {
        logoCard?.classList.add("intro");
      });
      await new Promise((r) => setTimeout(r, cachedSnapshot.length > 0 ? 120 : 220));
    })();

    const feedPromise = refreshFeedsAsync({
      isExplicitRefresh: cachedSnapshot.length === 0,
    });
    if (cachedSnapshot.length > 0) {
      await introPromise;
    } else {
      await Promise.all([introPromise, feedPromise]);
    }

    logoCard?.classList.add("outro");
    splashOverlay?.classList.add("hidden");
    if (tabBar) tabBar.style.opacity = "1";
    await new Promise((r) => setTimeout(r, 120));
    if (splashOverlay) splashOverlay.style.display = "none";
  } else {
    await refreshFeedsAsync();
  }

  activateCurrentFeedVideo();
}

function renderCarouselList(carouselEl, items, contextType) {
  if (!carouselEl) return;

  const existingSlides = Array.from(carouselEl.querySelectorAll(".feed-slide"));
  const sameSequence =
    existingSlides.length === items.length &&
    existingSlides.every((el, idx) => el.dataset.klipId === items[idx].Id);

  if (sameSequence) {
    items.forEach((item) => syncVideoAcrossAllViews(item));
    return;
  }

  releaseVideosIn(carouselEl);
  carouselEl.innerHTML = "";
  items.forEach((klip, index) => {
    const slide = createFeedSlideElement(klip, contextType, index);
    carouselEl.appendChild(slide);
  });
}

async function triggerFeedRefreshAsync() {
  if (state.isFeedRefreshing) return;
  state.isFeedRefreshing = true;

  try {
    if (state.activeFeedTab !== "ForYou") {
      await switchHomeFeedTab("ForYou");
    }

    const feedCarousel = document.getElementById("feedCarousel");
    const visibleSlide = getVisibleSlideInCarousel(feedCarousel);
    const currentTopId =
      visibleSlide?.dataset.klipId || state.feedItems[0]?.Id || null;

    const [allKlips, followedUids] = await Promise.all([
      FirebaseService.getFeedKlipsAsync(true),
      FirebaseService.getFollowingUidsAsync(),
    ]);

    applyFeedDataToCarousels(allKlips, followedUids, {
      avoidFirstVideoId: currentTopId,
      isExplicitRefresh: true,
    });

    if (feedCarousel) {
      feedCarousel.scrollTo({ top: 0, behavior: "instant" });
    }
    state.videoStartTime = Date.now();
    state.currentKlipInView = state.feedItems[0] || null;
    activateCurrentFeedVideo();
  } catch {
    // Ignore transient refresh errors
  } finally {
    state.isFeedRefreshing = false;
  }
}

async function refreshFeedsAsync(options = {}) {
  updateFemaleTabVisibility();

  const [allKlips, followedUids] = await Promise.all([
    FirebaseService.getFeedKlipsAsync(),
    FirebaseService.getFollowingUidsAsync(),
  ]);

  applyFeedDataToCarousels(allKlips, followedUids, options);
}

function applyFeedDataToCarousels(allKlips, followedUids, options = {}) {
  const shouldReRankForYou =
    state.feedItems.length === 0 || Boolean(options.isExplicitRefresh);

  // Filter out any invalid items missing both video and photo media
  const validKlips = (allKlips || []).filter(
    (k) => (k.isVideoPost && k.VideoUrl) || (k.isPhotoPost && k.PhotoUrls?.length > 0)
  );

  // STRICT COMMUNITY PARTITIONING (Matching mobile Klip app):
  // 1. For You feed is personalized & ranked via RecommendationService (which also excludes Female-only Klips)
  const forYouKlips = shouldReRankForYou
    ? RecommendationService.rankForYouFeed(
      validKlips,
      options.avoidFirstVideoId || null,
      Boolean(options.isExplicitRefresh)
    )
    : validKlips.filter((k) => !k.IsFemaleOnly);

  // 2. Following feed MUST NEVER contain any Female-only Klips
  const desiredFollowing = validKlips.filter(
    (k) => !k.IsFemaleOnly && followedUids.has(k.CreatorUid)
  );

  // 3. Female tab feed contains ONLY Female Klips
  const femaleKlips = validKlips.filter((k) => k.IsFemaleOnly);

  // Sync FeedItems (For You)
  if (shouldReRankForYou) {
    state.feedItems = forYouKlips.map((k) => {
      k.IsPaused = true;
      return k;
    });
  } else {
    const desiredIds = new Set(forYouKlips.map((k) => k.Id));
    state.feedItems = state.feedItems.filter((item) => desiredIds.has(item.Id));
    for (const fresh of forYouKlips) {
      const existing = state.feedItems.find((x) => x.Id === fresh.Id);
      if (existing) {
        if (fresh.VideoUrl && existing.VideoUrl !== fresh.VideoUrl) {
          existing.VideoUrl = fresh.VideoUrl;
        }
        if (Array.isArray(fresh.MediaUrls) && fresh.MediaUrls.length > 0) {
          existing.MediaUrls = fresh.MediaUrls;
        }
        existing.LikesCount = fresh.LikesCount;
        existing.BookmarksCount = fresh.BookmarksCount;
        existing.ViewsCount = Math.max(
          existing.ViewsCount || 0,
          fresh.ViewsCount || 0
        );
        existing.IsLiked = fresh.IsLiked;
        existing.IsBookmarked = fresh.IsBookmarked;
        existing.IsFollowed = fresh.IsFollowed;
        existing.CreatorAvatarUrl = fresh.CreatorAvatarUrl;
        syncVideoAcrossAllViews(existing);
      } else {
        fresh.IsPaused = true;
        state.feedItems.unshift(fresh);
      }
    }
  }

  // Sync FollowingItems
  const desiredFollowingIds = new Set(desiredFollowing.map((k) => k.Id));
  state.followingItems = state.followingItems.filter((item) =>
    desiredFollowingIds.has(item.Id)
  );
  for (const src of desiredFollowing) {
    const existingFollow = state.followingItems.find((x) => x.Id === src.Id);
    if (existingFollow) {
      existingFollow.LikesCount = src.LikesCount;
      existingFollow.BookmarksCount = src.BookmarksCount;
      existingFollow.ViewsCount = Math.max(
        existingFollow.ViewsCount || 0,
        src.ViewsCount || 0
      );
      existingFollow.IsLiked = src.IsLiked;
      existingFollow.IsBookmarked = src.IsBookmarked;
      existingFollow.IsFollowed = src.IsFollowed;
      existingFollow.CreatorAvatarUrl = src.CreatorAvatarUrl;
    } else {
      state.followingItems.push(src.createTabClone());
    }
  }

  // Sync FemaleItems
  const desiredFemaleIds = new Set(femaleKlips.map((k) => k.Id));
  state.femaleItems = state.femaleItems.filter((item) =>
    desiredFemaleIds.has(item.Id)
  );
  for (const src of femaleKlips) {
    const existingFemale = state.femaleItems.find((x) => x.Id === src.Id);
    if (existingFemale) {
      existingFemale.LikesCount = src.LikesCount;
      existingFemale.BookmarksCount = src.BookmarksCount;
      existingFemale.ViewsCount = Math.max(
        existingFemale.ViewsCount || 0,
        src.ViewsCount || 0
      );
      existingFemale.IsLiked = src.IsLiked;
      existingFemale.IsBookmarked = src.IsBookmarked;
      existingFemale.IsFollowed = src.IsFollowed;
      existingFemale.CreatorAvatarUrl = src.CreatorAvatarUrl;
    } else {
      state.femaleItems.push(src.createTabClone());
    }
  }

  renderCarouselList(
    document.getElementById("feedCarousel"),
    state.feedItems,
    "main"
  );
  renderCarouselList(
    document.getElementById("followingCarousel"),
    state.followingItems,
    "main"
  );
  renderCarouselList(
    document.getElementById("femaleCarousel"),
    state.femaleItems,
    "main"
  );

  updateMainEmptyState();
  activateCurrentFeedVideo();
}

function updateMainEmptyState() {
  const container = document.getElementById("emptyFeedContainer");
  const title = document.getElementById("emptyFeedTitle");
  const subtitle = document.getElementById("emptyFeedSubtitle");
  if (!container || !title || !subtitle) return;

  if (state.activeFeedTab === "Following") {
    container.style.display =
      state.followingItems.length === 0 ? "flex" : "none";
    title.textContent = "No Following Klips Yet";
    subtitle.textContent =
      "Follow creators on For You to see their Klips here.";
  } else if (state.activeFeedTab === "Female") {
    container.style.display =
      state.femaleItems.length === 0 ? "flex" : "none";
    title.textContent = "No Female Klips Yet";
    subtitle.textContent = "Approved female creators will appear here.";
  } else {
    container.style.display = state.feedItems.length === 0 ? "flex" : "none";
    title.textContent = "No Klips Yet";
    subtitle.textContent = "Tap Post (+) below to upload the first Klip!";
  }
}

function getVisibleSlideInCarousel(carouselEl) {
  if (!carouselEl) return null;
  const slides = Array.from(carouselEl.querySelectorAll(".feed-slide"));
  if (slides.length === 0) return null;

  // Use bounding rect center overlap for 100% precision across mobile viewports and subpages
  const cRect = carouselEl.getBoundingClientRect();
  const centerY = cRect.top + cRect.height / 2;

  let bestSlide = null;
  let minDiff = Infinity;
  for (const slide of slides) {
    const sRect = slide.getBoundingClientRect();
    const sCenter = sRect.top + sRect.height / 2;
    const diff = Math.abs(sCenter - centerY);
    if (diff < minDiff) {
      minDiff = diff;
      bestSlide = slide;
    }
  }

  if (bestSlide) return bestSlide;

  const h = carouselEl.clientHeight || 1;
  const idx = Math.min(
    Math.max(Math.round(carouselEl.scrollTop / h), 0),
    slides.length - 1
  );
  return slides[idx];
}

function activateCurrentFeedVideo() {
  if (getActivePageId() !== "MainPage") {
    pauseAllCarouselVideos(document.getElementById("feedCarousel"));
    pauseAllCarouselVideos(document.getElementById("followingCarousel"));
    pauseAllCarouselVideos(document.getElementById("femaleCarousel"));
    return;
  }

  const feedCarousel = document.getElementById("feedCarousel");
  const followingCarousel = document.getElementById("followingCarousel");
  const femaleCarousel = document.getElementById("femaleCarousel");

  if (state.activeFeedTab === "Following") {
    pauseAllCarouselVideos(feedCarousel, true);
    pauseAllCarouselVideos(femaleCarousel, true);
    activateSlideInCarousel(followingCarousel, state.followingItems);
  } else if (state.activeFeedTab === "Female") {
    pauseAllCarouselVideos(feedCarousel, true);
    pauseAllCarouselVideos(followingCarousel, true);
    activateSlideInCarousel(femaleCarousel, state.femaleItems);
  } else {
    pauseAllCarouselVideos(followingCarousel, true);
    pauseAllCarouselVideos(femaleCarousel, true);
    activateSlideInCarousel(feedCarousel, state.feedItems);
  }
}

// Smart video loader. Only ONE video downloads at full priority (the visible one).
//  - active slide     : src attached, preload=auto, plays immediately
//  - next video slide : looks ahead past any photo slides; upgraded to preload=auto
//                       as soon as the active video can play (or immediately if
//                       the active slide is a photo post)
//  - prev video slide : kept in memory only if already idle/buffered; if still
//                       actively downloading (networkState === 2), unloaded so it
//                       never steals bandwidth from the visible slide
//  - everything else  : source detached (aborts download, frees memory)
function activateSlideInCarousel(carouselEl, itemsList, forcedActiveSlide = null) {
  if (!carouselEl) return;
  const slides = Array.from(carouselEl.querySelectorAll(".feed-slide"));
  const activeSlide = forcedActiveSlide || getVisibleSlideInCarousel(carouselEl);
  const activeIndex = slides.indexOf(activeSlide);

  // Track watch duration & immediate swipes on the For You feed (matching OnFeedCarouselItemChanged in MainPage.xaml.cs)
  if (carouselEl.id === "feedCarousel" && activeSlide) {
    const curr = itemsList.find((x) => x.Id === activeSlide.dataset.klipId) || null;
    const prev = state.currentKlipInView;
    if (curr && (!prev || prev.Id !== curr.Id)) {
      if (prev) {
        const watchSeconds = (Date.now() - state.videoStartTime) / 1000;
        if (watchSeconds < 2.2) {
          RecommendationService.recordInteraction(
            prev,
            VideoInteractionType.SwipedImmediately,
            watchSeconds
          );
        } else if (watchSeconds >= 7.0) {
          RecommendationService.recordInteraction(
            prev,
            VideoInteractionType.WatchedMost,
            watchSeconds
          );
        }
      }
      state.videoStartTime = Date.now();
      state.currentKlipInView = curr;
    }
  }

  // Locate the next upcoming video slide (looking ahead up to 5 slides past photos)
  // and the immediately preceding video slide (within 2 slides back).
  let nextVideoSlide = null;
  let nextNextVideoSlide = null;
  let prevVideoSlide = null;
  if (activeIndex !== -1) {
    for (let i = activeIndex + 1; i < slides.length && i <= activeIndex + 6; i++) {
      if (slides[i].querySelector("video.klip-video-element")) {
        if (!nextVideoSlide) {
          nextVideoSlide = slides[i];
        } else if (!nextNextVideoSlide) {
          nextNextVideoSlide = slides[i];
          break;
        }
      }
    }
    for (let i = activeIndex - 1; i >= 0 && i >= activeIndex - 2; i--) {
      if (slides[i].querySelector("video.klip-video-element")) {
        prevVideoSlide = slides[i];
        break;
      }
    }
  }

  const loadSlideImages = (slideEl) => {
    if (!slideEl) return;
    slideEl.querySelectorAll("img[data-src]").forEach((img) => {
      if (!img.getAttribute("src") && img.dataset.src) {
        img.src = img.dataset.src;
        img.addEventListener("load", () => {
          const ph = slideEl.querySelector(".feed-slide-placeholder");
          if (ph) {
            ph.style.opacity = "0";
            setTimeout(() => { if (ph.parentNode) ph.style.display = "none"; }, 300);
          }
        }, { once: true });
      }
    });
  };

  // Load images on the active slide immediately
  if (activeSlide) {
    loadSlideImages(activeSlide);
  }

  const activeVideo = activeSlide?.querySelector("video.klip-video-element") || null;

  slides.forEach((slide) => {
    const v = slide.querySelector("video.klip-video-element");
    const disc = slide.querySelector(".rail-audio-disc");
    const playOverlay = slide.querySelector(".center-play-indicator");
    const klip = itemsList.find((x) => x.Id === slide.dataset.klipId);

    if (slide === activeSlide) {
      if (klip) {
        FirebaseService.incrementViewCountAsync(klip);
        syncVideoAcrossAllViews(klip);
      }
      if (v) {
        const wasActive = v.dataset.active === "1";
        v.dataset.active = "1";

        if (!v.getAttribute("src") && !v._hlsInstance && v.dataset.src) {
          v.preload = "auto";
          attachVideoToElement(v, v.dataset.src);
          v.load();
          v._klipShowSpinner?.();
        } else if (v.preload !== "auto") {
          v.preload = "auto";
        }

        if (klip) {
          klip.IsPaused = false;
          if (playOverlay) playOverlay.style.display = "none";
          const desiredMuted = Boolean(state.userMuted || state.autoMuted);
          if (v.paused || !wasActive || v.muted !== desiredMuted) {
            playVideoSafely(v, disc);
          } else {
            ensureAudioTracksEnabled(v);
            v.volume = 1.0;
          }
        }

        if (v.readyState < 3) {
          v._klipArmWatchdog?.();
        }
      }
    } else {
      if (klip) {
        klip.IsPaused = true;
        klip.IsPausedByUser = false;
      }
      if (playOverlay) playOverlay.style.display = "none";
      disc?.classList.remove("spinning");
      if (v) {
        if (forcedActiveSlide && slide === forcedActiveSlide) {
          return;
        }
        v.dataset.active = "0";
        v.muted = true;
        v._klipClearWatchdog?.();
        v._klipHideSpinner?.();
        if (!v.paused) v.pause();

        if (slide === nextVideoSlide) {
          // Preload upcoming video with HLS attachment so it starts buffering immediately
          if (!activeVideo || activeVideo.readyState >= 2) {
            if (!v._hlsInstance && !v.getAttribute("src") && v.dataset.src) {
              v.muted = true;
              v.preload = "auto";
              attachVideoToElement(v, v.dataset.src);
            } else if (v.preload !== "auto") {
              v.preload = "auto";
            }
          }
        } else if (slide === prevVideoSlide && v.getAttribute("src") && v.networkState === 1) {
          // Keep already-buffered previous video in memory for instant scroll-back,
          // but if it was still actively downloading (networkState === 2), unload it
          // below so a huge file never steals bandwidth from the visible slide.
          v.preload = "metadata";
        } else if (v.getAttribute("src")) {
          unloadVideoElement(v);
        }
      }
    }
  });

  // Once the active slide is ready (or immediately if it's a photo slide),
  // pre-load neighbor slide images and pre-buffer only the single immediate next video.
  const warmUpNeighbors = () => {
    if (activeIndex !== -1) {
      loadSlideImages(slides[activeIndex + 1]);
      loadSlideImages(slides[activeIndex - 1]);
    }
    const nextVid = nextVideoSlide?.querySelector("video.klip-video-element");
    if (nextVid && nextVid.dataset.active !== "1") {
      nextVid.muted = true;
      if (!nextVid._hlsInstance && !nextVid.getAttribute("src") && nextVid.dataset.src) {
        nextVid.preload = "auto";
        attachVideoToElement(nextVid, nextVid.dataset.src);
      }
    }
  };

  if (!activeVideo || activeVideo.readyState >= 2) {
    warmUpNeighbors();
  } else {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      activeVideo.removeEventListener("canplay", once);
      activeVideo.removeEventListener("loadeddata", once);
      activeVideo.removeEventListener("playing", once);
      clearTimeout(timer);
      if (activeVideo.dataset.active === "1") warmUpNeighbors();
    };
    const timer = setTimeout(once, 1200);
    activeVideo.addEventListener("loadeddata", once, { once: true });
    activeVideo.addEventListener("canplay", once, { once: true });
    activeVideo.addEventListener("playing", once, { once: true });
  }
}

async function switchHomeFeedTab(targetTab) {
  if (state.isTabTransitioning) {
    return;
  }
  if (state.activeFeedTab === targetTab) {
    if (targetTab === "ForYou") {
      await triggerFeedRefreshAsync();
    }
    return;
  }

  state.isTabTransitioning = true;
  const fromTab = state.activeFeedTab || "ForYou";
  state.activeFeedTab = targetTab;

  const tabOrder = { Following: 0, Female: 1, ForYou: 2 };
  const fromIndex = tabOrder[fromTab] ?? 2;
  const targetIndex = tabOrder[targetTab] ?? 2;
  const slideFromLeft = targetIndex < fromIndex;

  const feedCarousel = document.getElementById("feedCarousel");
  const followingCarousel = document.getElementById("followingCarousel");
  const femaleCarousel = document.getElementById("femaleCarousel");
  const followingLabel = document.getElementById("followingTabLabel");
  const femaleLabel = document.getElementById("femaleTabLabel");
  const forYouLabel = document.getElementById("forYouTabLabel");
  const indicator = document.getElementById("feedTabIndicator");

  pauseAllCarouselVideos(feedCarousel);
  pauseAllCarouselVideos(followingCarousel);
  pauseAllCarouselVideos(femaleCarousel);

  followingLabel?.classList.toggle("active", targetTab === "Following");
  femaleLabel?.classList.toggle("active", targetTab === "Female");
  forYouLabel?.classList.toggle("active", targetTab === "ForYou");

  if (indicator) {
    indicator.classList.remove("following-active", "female-active");
    if (targetTab === "Following") {
      indicator.classList.add("following-active");
    } else if (targetTab === "Female") {
      indicator.classList.add("female-active");
    }
  }

  const carouselMap = {
    Following: followingCarousel,
    Female: femaleCarousel,
    ForYou: feedCarousel,
  };

  const targetCarouselEl = carouselMap[targetTab];
  const fromCarouselEl = carouselMap[fromTab];

  updateMainEmptyState();

  if (targetCarouselEl && fromCarouselEl && targetCarouselEl !== fromCarouselEl) {
    targetCarouselEl.style.display = "block";
    targetCarouselEl.style.transform = slideFromLeft
      ? "translateX(-100%)"
      : "translateX(100%)";

    // Force layout reflow before triggering transition
    void targetCarouselEl.offsetWidth;

    requestAnimationFrame(() => {
      targetCarouselEl.style.transform = "translateX(0%)";
      fromCarouselEl.style.transform = slideFromLeft
        ? "translateX(100%)"
        : "translateX(-100%)";
    });

    await new Promise((r) => setTimeout(r, 260));
    fromCarouselEl.style.display = "none";
  } else if (targetCarouselEl) {
    targetCarouselEl.style.display = "block";
    targetCarouselEl.style.transform = "translateX(0%)";
  }

  activateCurrentFeedVideo();
  state.isTabTransitioning = false;
}

// ==================== CREATE / POST PAGE CONTROLLER ====================
async function onCreatePageAppearing() {
  await checkPostingPermissionAsync();

  const previewVid = document.getElementById("previewVideoPlayer");
  if (!state.isPhotoMode && state.selectedVideoFile && previewVid) {
    previewVid.play().catch(() => { });
    document.getElementById("previewPausedOverlay").style.display = "none";
  }
}

async function checkPostingPermissionAsync() {
  const lockedView = document.getElementById("lockedPostingView");
  const uploadGrid = document.getElementById("uploadFormGrid");
  const badge = document.getElementById("accountHandleBadge");
  const handleText = document.getElementById("accountHandleText");

  if (!FirebaseService.currentUid) {
    if (handleText) handleText.textContent = "Sign in on the Profile tab first";
    else if (badge) badge.textContent = "Sign in on the Profile tab first";
    if (uploadGrid) uploadGrid.style.display = "none";
    if (lockedView) lockedView.style.display = "flex";
    return;
  }

  let profile =
    FirebaseService.currentUser ||
    (await FirebaseService.getUserProfileAsync(FirebaseService.currentUid));
  if (profile) applyPermissionUI(profile);

  const fresh = await FirebaseService.getUserProfileAsync(
    FirebaseService.currentUid,
    true
  );
  if (fresh) applyPermissionUI(fresh);
}

function applyPermissionUI(profile) {
  const lockedView = document.getElementById("lockedPostingView");
  const uploadGrid = document.getElementById("uploadFormGrid");
  const badge = document.getElementById("accountHandleBadge");
  const handleText = document.getElementById("accountHandleText");
  const chip = document.getElementById("creatorHandleChip");

  if (handleText) handleText.textContent = `Your account: ${profile.Handle}`;
  else if (badge) badge.textContent = `Your account: ${profile.Handle}`;
  if (chip) chip.textContent = profile.Handle;

  const allowed = Boolean(profile.CanPost);
  if (uploadGrid) uploadGrid.style.display = allowed ? "flex" : "none";
  if (lockedView) lockedView.style.display = allowed ? "none" : "flex";
}

function setCreatePostMode(photoMode) {
  state.isPhotoMode = photoMode;

  const videoTab = document.getElementById("videoModeTabBtn");
  const photoTab = document.getElementById("photoModeTabBtn");
  const videoStage = document.getElementById("videoStageGroup");
  const photoStage = document.getElementById("photoStageGroup");
  const postBtn = document.getElementById("postKlipBtn");
  const clearBtn = document.getElementById("clearMediaBtn");
  const previewVid = document.getElementById("previewVideoPlayer");

  if (!photoMode) {
    videoTab.className = "segment-btn active-blue";
    photoTab.className = "segment-btn";
    videoStage.style.display = "block";
    photoStage.style.display = "none";
    postBtn.textContent = "Post Video Klip";
    postBtn.classList.remove("purple");
    clearBtn.style.display = state.selectedVideoFile ? "block" : "none";
    if (state.selectedVideoFile && previewVid) {
      previewVid.play().catch(() => { });
      document.getElementById("previewPausedOverlay").style.display = "none";
    }
  } else {
    if (previewVid) previewVid.pause();
    photoTab.className = "segment-btn active-purple";
    videoTab.className = "segment-btn";
    videoStage.style.display = "none";
    photoStage.style.display = "block";
    postBtn.textContent = "Post Photo Slideshow";
    postBtn.classList.add("purple");
    clearBtn.style.display =
      state.selectedPhotoFiles.length > 0 ? "block" : "none";
  }
}

function handleVideoFilePicked(file) {
  if (!file) return;

  // Security & stability validation: File size limit (500 MB) and MIME type
  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
  if (!file.type.startsWith("video/")) {
    showToast("Invalid file: Please select a valid video file (MP4, MOV, WebM).");
    return;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    showToast("Video exceeds the 500 MB limit. Please choose a smaller video.");
    return;
  }

  state.selectedVideoFile = file;
  if (state.selectedVideoObjectUrl) {
    URL.revokeObjectURL(state.selectedVideoObjectUrl);
  }
  state.selectedVideoObjectUrl = URL.createObjectURL(file);

  const mb = (file.size / (1024 * 1024)).toFixed(1);
  document.getElementById("selectedFileLabel").textContent =
    `${file.name} (${mb} MB)`;
  document.getElementById("emptyVideoPromptView").style.display = "none";
  document.getElementById("videoPreviewContainer").style.display = "block";
  document.getElementById("clearMediaBtn").style.display = "block";
  document.getElementById("uploadStatusBanner").style.display = "none";

  const previewVid = document.getElementById("previewVideoPlayer");
  previewVid.src = state.selectedVideoObjectUrl;
  previewVid.onloadedmetadata = () => {
    state.videoDuration = Math.round(previewVid.duration) || 0;
    updateTrimmerConstraints();
  };
  previewVid.play().catch(() => { });
  document.getElementById("previewPausedOverlay").style.display = "none";
}

function handlePhotoFilesPicked(fileList) {
  if (!fileList || fileList.length === 0) return;
  document.getElementById("uploadStatusBanner").style.display = "none";

  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB limit per photo

  for (const file of Array.from(fileList)) {
    if (state.selectedPhotoFiles.length >= 10) {
      showToast("Maximum of 10 photos per Klip reached.");
      break;
    }
    if (!file.type.startsWith("image/")) {
      showToast(`Skipped ${file.name}: Not an image.`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast(`Skipped ${file.name}: Image exceeds 10 MB limit.`);
      continue;
    }
    state.selectedPhotoFiles.push(file);
    state.previewPhotoUrls.push(URL.createObjectURL(file));
  }

  updatePhotoStageUI();
}

function updatePhotoStageUI() {
  const hasPhotos = state.previewPhotoUrls.length > 0;
  const isMulti = state.previewPhotoUrls.length > 1;

  document.getElementById("emptyPhotoPromptView").style.display = hasPhotos
    ? "none"
    : "flex";
  document.getElementById("photoPreviewContainer").style.display = hasPhotos
    ? "block"
    : "none";
  document.getElementById("clearMediaBtn").style.display = hasPhotos
    ? "block"
    : "none";

  const counterBorder = document.getElementById("previewPhotoCounterBorder");
  const indicator = document.getElementById("previewPhotoIndicator");
  counterBorder.style.display = isMulti ? "block" : "none";
  indicator.style.display = isMulti ? "flex" : "none";

  const carousel = document.getElementById("previewPhotoCarousel");
  carousel.innerHTML = "";
  indicator.innerHTML = "";

  state.previewPhotoUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "photo-slide-item";
    const img = document.createElement("img");
    img.src = url;
    item.appendChild(img);
    carousel.appendChild(item);

    const dot = document.createElement("div");
    dot.className = `photo-dot${idx === 0 ? " active" : ""}`;
    indicator.appendChild(dot);
  });

  state.previewPhotoIndex = 0;
  if (isMulti) {
    document.getElementById("photoCountSummaryLabel").textContent =
      `1/${state.previewPhotoUrls.length}`;
  }
}

function resetUploadForm() {
  const previewVid = document.getElementById("previewVideoPlayer");
  if (previewVid) {
    previewVid.pause();
    previewVid.removeAttribute("src");
  }
  if (state.selectedVideoObjectUrl) {
    URL.revokeObjectURL(state.selectedVideoObjectUrl);
    state.selectedVideoObjectUrl = null;
  }
  state.selectedVideoFile = null;

  state.previewPhotoUrls.forEach((u) => URL.revokeObjectURL(u));
  state.previewPhotoUrls = [];
  state.selectedPhotoFiles = [];
  state.previewPhotoIndex = 0;

  document.getElementById("videoPreviewContainer").style.display = "none";
  document.getElementById("emptyVideoPromptView").style.display = "flex";
  document.getElementById("photoPreviewContainer").style.display = "none";
  document.getElementById("emptyPhotoPromptView").style.display = "flex";
  document.getElementById("clearMediaBtn").style.display = "none";
  document.getElementById("previewPausedOverlay").style.display = "none";
  document.getElementById("captionEditor").value = "";
  document.getElementById("captionCountLabel").textContent = "0 / 150";
  document.getElementById("uploadStatusBanner").style.display = "none";
  document.getElementById("videoFileInput").value = "";
  document.getElementById("photoFilesInput").value = "";
  const postAudioNameInput = document.getElementById("postAudioNameInput");
  if (postAudioNameInput) postAudioNameInput.value = "";
  state.videoDuration = 0;
  clearSelectedSound();
}

// ==================== BACKGROUND UPLOAD CONTROLLER ====================
let currentUploadJob = null;
let uploadDismissTimer = null;

function showGlobalUploadPill(title, progressPct = 15) {
  const pill = document.getElementById("globalUploadPill");
  const titleEl = document.getElementById("globalUploadTitle");
  const barEl = document.getElementById("globalUploadProgressBar");
  const spinner = document.getElementById("globalUploadSpinner");
  const doneIcon = document.getElementById("globalUploadDoneIcon");
  const errIcon = document.getElementById("globalUploadErrIcon");

  if (uploadDismissTimer) {
    clearTimeout(uploadDismissTimer);
    uploadDismissTimer = null;
  }

  if (pill) {
    pill.classList.remove("upload-success", "upload-error");
    pill.style.display = "flex";
  }
  if (titleEl) titleEl.textContent = title;
  if (barEl) barEl.style.width = `${Math.max(5, Math.min(100, progressPct))}%`;
  if (spinner) spinner.style.display = "block";
  if (doneIcon) doneIcon.style.display = "none";
  if (errIcon) errIcon.style.display = "none";
}

function updateGlobalUploadPill(title, progressPct) {
  const titleEl = document.getElementById("globalUploadTitle");
  const barEl = document.getElementById("globalUploadProgressBar");
  if (titleEl && title) titleEl.textContent = title;
  if (barEl && progressPct !== undefined) {
    barEl.style.width = `${Math.max(5, Math.min(100, progressPct))}%`;
  }
}

function finishGlobalUploadPill(success, message) {
  const pill = document.getElementById("globalUploadPill");
  const titleEl = document.getElementById("globalUploadTitle");
  const barEl = document.getElementById("globalUploadProgressBar");
  const spinner = document.getElementById("globalUploadSpinner");
  const doneIcon = document.getElementById("globalUploadDoneIcon");
  const errIcon = document.getElementById("globalUploadErrIcon");

  if (spinner) spinner.style.display = "none";

  if (success) {
    if (pill) pill.classList.add("upload-success");
    if (titleEl) titleEl.textContent = message || "Klip posted successfully! 🎉";
    if (barEl) barEl.style.width = "100%";
    if (doneIcon) doneIcon.style.display = "inline";
    if (errIcon) errIcon.style.display = "none";

    showToast("Your Klip is now live!");

    uploadDismissTimer = setTimeout(() => {
      dismissGlobalUploadPill();
    }, 3800);
  } else {
    if (pill) pill.classList.add("upload-error");
    if (titleEl) titleEl.textContent = message || "Upload failed. Tap to retry.";
    if (errIcon) errIcon.style.display = "inline";
    if (doneIcon) doneIcon.style.display = "none";
  }
}

function dismissGlobalUploadPill() {
  const pill = document.getElementById("globalUploadPill");
  if (pill) pill.style.display = "none";
  if (uploadDismissTimer) {
    clearTimeout(uploadDismissTimer);
    uploadDismissTimer = null;
  }
}

async function startBackgroundKlipUpload(job) {
  currentUploadJob = job;
  showGlobalUploadPill(job.isPhotoMode ? "Uploading (5%)..." : "Uploading (5%)...", 5);

  try {
    // 1. Process Sound if needed
    let soundMeta = null;
    if (job.selectedSound) {
      let finalAudioUrl = job.selectedSound.audioUrl || "";
      if (job.selectedSound.isCustomUpload && job.selectedSound.audioFile) {
        updateGlobalUploadPill("Uploading (25%)...", 25);
        const audioUploadRes = await FirebaseService.uploadAudioAsync(job.selectedSound.audioFile);
        if (audioUploadRes.success && audioUploadRes.url) {
          finalAudioUrl = audioUploadRes.url;
        }
      }
      soundMeta = {
        id: job.selectedSound.id || `sound_${Date.now()}`,
        title: job.customAudioName || job.selectedSound.title || `Original Sound - ${FirebaseService.currentUser?.Handle || "@user"}`,
        audioUrl: finalAudioUrl,
        startTime: Number(job.selectedSound.startTime) || 0,
        endTime: Number(job.selectedSound.endTime) || 0,
      };
    } else if (job.customAudioName) {
      soundMeta = {
        id: `sound_${Date.now()}`,
        title: job.customAudioName,
        audioUrl: "",
        startTime: 0,
        endTime: 0,
      };
    }

    if (job.isPhotoMode) {
      updateGlobalUploadPill("Uploading (50%)...", 50);
      const { success, error } = await FirebaseService.uploadAndCreatePhotoSlideshowAsync(
        job.photoFiles,
        job.caption,
        soundMeta
      );

      if (!success) {
        throw new Error(error || "Photo slideshow upload failed.");
      }
    } else {
      // 2. Upload Video IMMEDIATELY (no blocking watermark delay!)
      updateGlobalUploadPill("Uploading (5%)...", 5);
      const { success, error, klipId } = await FirebaseService.uploadAndCreateKlipAsync(
        job.videoFile,
        job.caption,
        null, // Non-blocking: watermark is attached asynchronously so post is immediate!
        soundMeta,
        (percent) => {
          updateGlobalUploadPill(`Uploading (${percent}%)...`, Math.min(95, Math.max(5, percent)));
        }
      );

      if (!success) {
        throw new Error(error || "Video upload failed.");
      }

      // 3. Asynchronously render and attach watermark in background (non-blocking!)
      if (klipId && job.videoFile) {
        const handle = FirebaseService.currentUser?.Handle || "@user";
        FirebaseService.generateAndAttachWatermarkInBackgroundAsync(
          klipId,
          job.videoFile,
          handle,
          renderWatermarkedVideoBlobAsync
        ).catch((wmErr) => {
          console.warn("[Watermark] Background attachment skipped:", wmErr);
        });
      }
    }

    // Success!
    updateGlobalUploadPill("Uploading (100%)...", 100);
    finishGlobalUploadPill(true, "Klip posted successfully! 🎉");
    currentUploadJob = null;

    // Refresh feeds and profile so new Klip is visible immediately
    refreshFeedsAsync({ isExplicitRefresh: true }).catch(() => {});
    if (FirebaseService.isLoggedIn && FirebaseService.currentUid) {
      loadLoggedInProfileAsync().catch(() => {});
    }
  } catch (err) {
    console.error("Background upload failed:", err);
    finishGlobalUploadPill(false, err.message || "Upload failed. Tap to retry.");
  }
}

// ==================== PROFILE PAGE & AUTH CONTROLLER ====================
async function onProfilePageAppearing() {
  await refreshProfileViewAsync();
}

async function refreshProfileViewAsync() {
  if (!FirebaseService.isLoggedIn) {
    await FirebaseService.tryRestoreSessionAsync();
  }
  const guestView = document.getElementById("guestAuthView");
  const loggedInView = document.getElementById("loggedInProfileView");

  updateSidebarUserCard();

  if (!FirebaseService.isLoggedIn) {
    guestView.style.display = "block";
    loggedInView.style.display = "none";
    if (typeof window.__updateAuthModeUI === "function") {
      window.__updateAuthModeUI();
    }
    return;
  }

  guestView.style.display = "none";
  loggedInView.style.display = "block";
  await loadLoggedInProfileAsync();
}

async function loadLoggedInProfileAsync() {
  if (!FirebaseService.currentUid) return;

  if (FirebaseService.currentUser) {
    bindProfileUI(FirebaseService.currentUser);
  }
  bindProfileKlipsGrid(FirebaseService.getCachedKlipsSnapshot());

  const [profile, klips] = await Promise.all([
    FirebaseService.getUserProfileAsync(FirebaseService.currentUid, true),
    FirebaseService.getFeedKlipsAsync(),
  ]);

  let resolvedProfile = profile;
  if (!resolvedProfile && FirebaseService.currentUser) {
    resolvedProfile = FirebaseService.currentUser;
    await FirebaseService.saveUserProfileAsync(resolvedProfile);
  }

  if (resolvedProfile) {
    bindProfileUI(resolvedProfile);
    updateSidebarUserCard();
  }

  bindProfileKlipsGrid(klips);
}

function bindProfileUI(profile) {
  document.getElementById("profileHandleHeader").textContent = profile.Handle;
  document.getElementById("profileInitialsLabel").textContent = profile.Initials;
  document.getElementById("profileDisplayNameLabel").textContent =
    profile.DisplayName;
  document.getElementById("profileBioLabel").textContent = profile.Bio;
  document.getElementById("profileFollowingCount").textContent = String(
    profile.FollowingCount
  );
  document.getElementById("profileFollowersCount").textContent = String(
    profile.FollowersCount
  );
  document.getElementById("profileShkoyachCount").textContent = String(
    profile.ShkoyachCount
  );

  const imgEl = document.getElementById("profileAvatarImg");
  const initialsEl = document.getElementById("profileInitialsLabel");
  if (profile.hasAvatar) {
    imgEl.src = profile.AvatarUrl;
    imgEl.style.display = "block";
    initialsEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    initialsEl.style.display = "inline";
  }
}

function renderKlipsThumbnailGrid(gridEl, klipsList, playlistSource, showCreatorHandle = false) {
  if (!gridEl) return;
  releaseVideosIn(gridEl);
  gridEl.innerHTML = "";

  klipsList.forEach((klip, index) => {
    const tile = document.createElement("div");
    tile.className = "klip-grid-tile";
    tile.dataset.klipId = klip.Id;
    tile.style.backgroundColor = klip.PlaceholderColor || "#172554";

    if (klip.isPhotoPost && klip.firstPhotoUrl) {
      const img = document.createElement("img");
      img.className = "klip-grid-tile-media";
      img.src = klip.firstPhotoUrl;
      img.loading = "lazy";
      tile.appendChild(img);
    } else if (klip.isVideoPost && klip.VideoUrl) {
      const staticThumb = klip.ThumbnailUrl || staticThumbnailCache.get(klip.Id);
      if (staticThumb) {
        // Bandwidth Saver: 100% static image tile, zero video network traffic!
        const img = document.createElement("img");
        img.className = "klip-grid-tile-media";
        img.src = staticThumb;
        img.loading = "lazy";
        tile.appendChild(img);
      } else {
        const vid = document.createElement("video");
        vid.className = "klip-grid-tile-media";
        vid.dataset.src = klip.VideoUrl;
        vid.dataset.klipId = klip.Id;
        vid.preload = "none";
        vid.muted = true;
        vid.playsInline = true;
        tile.appendChild(vid);
        if (index < 12) {
          pendingTileVideoLoads.push(vid);
          pumpTileVideoQueue();
        } else if (tileVideoObserver) {
          tileVideoObserver.observe(vid);
        } else {
          loadTileVideoFrame(vid);
        }
      }
    }

    const scrim = document.createElement("div");
    scrim.className = "klip-grid-tile-scrim";
    tile.appendChild(scrim);

    const topRow = document.createElement("div");
    topRow.className = "klip-tile-top";
    if (showCreatorHandle) {
      topRow.innerHTML = `
        <span class="klip-tile-handle">${escapeHtml(klip.CreatorHandle)}</span>
        ${klip.isPhotoPost ? `<span style="font-size: 11px;">📷</span>` : ""}
      `;
    } else {
      topRow.innerHTML = `
        <span class="klip-tile-caption">${escapeHtml(klip.Caption)}</span>
        ${klip.isPhotoPost ? `<span style="font-size: 11px;">📷</span>` : ""}
      `;
    }
    tile.appendChild(topRow);

    if (showCreatorHandle && klip.Caption) {
      const midCap = document.createElement("div");
      midCap.className = "klip-tile-caption";
      midCap.style.position = "relative";
      midCap.style.zIndex = "2";
      midCap.textContent = klip.Caption;
      tile.appendChild(midCap);
    }

    const bottomRow = document.createElement("div");
    bottomRow.className = "klip-tile-bottom";
    bottomRow.dataset.klipId = klip.Id;
    bottomRow.innerHTML = `
      <span class="klip-tile-stat">
        <span style="font-size: 9px;">▶</span>
        <span class="klip-tile-views-count">${klip.ViewsCount ?? 0}</span>
      </span>
      <span class="klip-tile-stat">
        <span style="font-size: 10px;">♥</span>
        <span class="klip-tile-likes-count">${klip.LikesCount}</span>
      </span>
    `;
    tile.appendChild(bottomRow);

    if (isOwnKlip(klip)) {
      tile.classList.add("has-delete");
      const delBtn = document.createElement("button");
      delBtn.className = "klip-tile-delete-btn";
      delBtn.title = "Delete Klip";
      delBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="${TRASH_PATH}" />
        </svg>
      `;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteConfirm(klip);
      });
      tile.appendChild(delBtn);
    }

    tile.addEventListener("click", () => {
      clearPendingTileVideoLoads();
      pushSubpage("VideoDetailPage", {
        playlist: playlistSource,
        selected: klip,
      });
    });

    gridEl.appendChild(tile);
  });
}

function bindProfileKlipsGrid(allKlips) {
  const isFemale = isCurrentUserFemale();
  const filtered = state.showingSaved
    ? allKlips.filter((k) => k.IsBookmarked && (!k.IsFemaleOnly || isFemale))
    : allKlips.filter((k) => k.CreatorUid === FirebaseService.currentUid);

  state.profileDisplayedKlips = filtered;

  const emptyEl = document.getElementById("emptyProfileKlipsLabel");
  const gridEl = document.getElementById("profileKlipsGrid");

  emptyEl.style.display = filtered.length === 0 ? "block" : "none";
  emptyEl.textContent = state.showingSaved
    ? "No saved Klips yet"
    : "You haven't posted any Klips yet";
  gridEl.style.display = filtered.length > 0 ? "grid" : "none";

  renderKlipsThumbnailGrid(gridEl, filtered, state.profileDisplayedKlips, false);
}

// ==================== CREATOR PROFILE PAGE CONTROLLER ====================
async function loadCreatorProfileAsync() {
  const handleHeader = document.getElementById("creatorHandleHeader");
  const displayNameEl = document.getElementById("creatorDisplayNameLabel");
  const initialsEl = document.getElementById("creatorInitialsLabel");
  const avatarImg = document.getElementById("creatorAvatarImg");
  const bioEl = document.getElementById("creatorBioLabel");
  const followingEl = document.getElementById("creatorFollowingCount");
  const followersEl = document.getElementById("creatorFollowersCount");
  const shkoyachEl = document.getElementById("creatorShkoyachCount");
  const followBtn = document.getElementById("creatorFollowActionBtn");

  if (state.creatorFallbackHandle) {
    handleHeader.textContent = state.creatorFallbackHandle;
    displayNameEl.textContent = state.creatorFallbackHandle.replace(/^@/, "");
  }
  if (state.creatorFallbackInitials) {
    initialsEl.textContent = state.creatorFallbackInitials;
  }

  if (!state.creatorUid) return;

  // Immediately render from cached snapshot so creator's videos display with zero lag
  const cachedKlips = FirebaseService.getCachedKlipsSnapshot();
  bindCreatorKlips(cachedKlips);

  try {
    const [profile, followedUids, klips] = await Promise.all([
      FirebaseService.getUserProfileAsync(state.creatorUid, true),
      FirebaseService.getFollowingUidsAsync(),
      FirebaseService.getCreatorKlipsAsync(state.creatorUid),
    ]);

    if (profile) {
      handleHeader.textContent = profile.Handle;
      initialsEl.textContent = profile.Initials;
      displayNameEl.textContent = profile.DisplayName;
      bioEl.textContent = profile.Bio;
      followingEl.textContent = String(profile.FollowingCount);
      followersEl.textContent = String(profile.FollowersCount);
      shkoyachEl.textContent = String(profile.ShkoyachCount);

      if (profile.hasAvatar) {
        avatarImg.src = profile.AvatarUrl;
        avatarImg.style.display = "block";
        initialsEl.style.display = "none";
      } else {
        avatarImg.style.display = "none";
        initialsEl.style.display = "inline";
      }
    }

    state.creatorIsFollowing = followedUids.has(state.creatorUid);
    followBtn.style.display =
      state.creatorUid !== FirebaseService.currentUid ? "block" : "none";
    updateCreatorFollowBtnUI();

    bindCreatorKlips(klips);
  } catch (err) {
    console.warn("loadCreatorProfileAsync error:", err);
  }
}

function updateCreatorFollowBtnUI() {
  const followBtn = document.getElementById("creatorFollowActionBtn");
  if (!followBtn) return;
  if (state.creatorIsFollowing) {
    followBtn.textContent = "Unfollow";
    followBtn.classList.add("following");
  } else {
    followBtn.textContent = "Follow";
    followBtn.classList.remove("following");
  }
}

function bindCreatorKlips(allKlips) {
  const isFemaleViewer = isCurrentUserFemale();
  const filtered = allKlips.filter(
    (k) => k.CreatorUid === state.creatorUid && (!k.IsFemaleOnly || isFemaleViewer)
  );
  state.creatorKlips = filtered;

  const emptyEl = document.getElementById("emptyCreatorKlipsLabel");
  const gridEl = document.getElementById("creatorKlipsGrid");

  emptyEl.style.display = filtered.length === 0 ? "block" : "none";
  gridEl.style.display = filtered.length > 0 ? "grid" : "none";

  renderKlipsThumbnailGrid(gridEl, filtered, state.creatorKlips, false);
}

// ==================== EDIT PROFILE & AVATAR CROPPER CONTROLLER ====================
const CROP_VIEWPORT_SIZE = 260;

async function onEditProfileAppearing() {
  if (!FirebaseService.currentUid) return;

  const profile =
    (await FirebaseService.getUserProfileAsync(
      FirebaseService.currentUid,
      true
    )) || FirebaseService.currentUser;
  if (!profile) return;

  document.getElementById("editHandleEntry").value = profile.Handle;
  document.getElementById("editDisplayNameEntry").value = profile.DisplayName;
  document.getElementById("editAvatarInitialsLabel").textContent =
    profile.Initials;
  document.getElementById("editStatusLabel").style.display = "none";

  // Profile picture option ONLY shown for Male accounts
  const changePhotoBtn = document.getElementById("changePhotoBtn");
  changePhotoBtn.style.display = profile.isMale ? "inline-block" : "none";

  const avatarImg = document.getElementById("editAvatarPreviewImg");
  const initialsEl = document.getElementById("editAvatarInitialsLabel");
  if (profile.hasAvatar) {
    avatarImg.src = profile.AvatarUrl;
    avatarImg.style.display = "block";
    initialsEl.style.display = "none";
  } else {
    avatarImg.style.display = "none";
    initialsEl.style.display = "inline";
  }

  const bioEditor = document.getElementById("editBioEditor");
  const bioLock = document.getElementById("editBioLockBadge");
  const bioHint = document.getElementById("editBioHintLabel");

  if (profile.CanPost) {
    bioEditor.value = profile.Bio;
    bioEditor.disabled = false;
    bioEditor.style.color = "#FFFFFF";
    bioLock.style.display = "none";
    bioHint.style.display = "none";
  } else {
    bioEditor.value = DEFAULT_BIO;
    bioEditor.disabled = true;
    bioEditor.style.color = "#64748B";
    bioLock.style.display = "inline";
    bioHint.style.display = "block";
  }
}

async function preparePhotoForCropping(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1440;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w <= 0 || h <= 0) {
        resolve(false);
        return;
      }
      const longest = Math.max(w, h);
      if (longest > maxDim) {
        const scale = maxDim / longest;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      state.cropSourceCanvas = canvas;
      refreshCropPreviewFromCanvas();
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

function refreshCropPreviewFromCanvas() {
  const canvas = state.cropSourceCanvas;
  if (!canvas) return;

  const imgW = Math.max(1, canvas.width);
  const imgH = Math.max(1, canvas.height);
  const baseScale = Math.max(
    CROP_VIEWPORT_SIZE / imgW,
    CROP_VIEWPORT_SIZE / imgH
  );

  state.cropBaseWidth = imgW * baseScale;
  state.cropBaseHeight = imgH * baseScale;

  const targetImg = document.getElementById("cropTargetImage");
  targetImg.style.width = `${state.cropBaseWidth}px`;
  targetImg.style.height = `${state.cropBaseHeight}px`;
  targetImg.src = canvas.toDataURL("image/jpeg", 0.92);

  resetCropTransform();
}

function resetCropTransform() {
  state.cropScale = 1.0;
  state.cropOffsetX = 0;
  state.cropOffsetY = 0;

  const slider = document.getElementById("cropZoomSlider");
  const label = document.getElementById("cropZoomValueLabel");
  if (slider) slider.value = "1";
  if (label) label.textContent = "1.0x";

  applyCropTransform();
}

function applyCropTransform() {
  const scaledW = state.cropBaseWidth * state.cropScale;
  const scaledH = state.cropBaseHeight * state.cropScale;

  const maxOffsetX = Math.max(0, (scaledW - CROP_VIEWPORT_SIZE) / 2.0);
  const maxOffsetY = Math.max(0, (scaledH - CROP_VIEWPORT_SIZE) / 2.0);

  state.cropOffsetX = Math.min(
    Math.max(state.cropOffsetX, -maxOffsetX),
    maxOffsetX
  );
  state.cropOffsetY = Math.min(
    Math.max(state.cropOffsetY, -maxOffsetY),
    maxOffsetY
  );

  const targetImg = document.getElementById("cropTargetImage");
  if (targetImg) {
    targetImg.style.transform = `translate(${state.cropOffsetX}px, ${state.cropOffsetY}px) scale(${state.cropScale})`;
  }
}

function rotateCropCanvas90() {
  const src = state.cropSourceCanvas;
  if (!src) return;

  const rotated = document.createElement("canvas");
  rotated.width = src.height;
  rotated.height = src.width;
  const ctx = rotated.getContext("2d");
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);

  state.cropSourceCanvas = rotated;
  refreshCropPreviewFromCanvas();
}

async function renderCroppedAvatarBlobAsync() {
  const src = state.cropSourceCanvas;
  if (!src) return null;

  const outputSize = 512;
  const viewportToOutput = outputSize / CROP_VIEWPORT_SIZE;

  const drawW = state.cropBaseWidth * state.cropScale * viewportToOutput;
  const drawH = state.cropBaseHeight * state.cropScale * viewportToOutput;

  const centerX =
    (CROP_VIEWPORT_SIZE / 2.0 + state.cropOffsetX) * viewportToOutput;
  const centerY =
    (CROP_VIEWPORT_SIZE / 2.0 + state.cropOffsetY) * viewportToOutput;

  const left = centerX - drawW / 2;
  const top = centerY - drawH / 2;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outputSize;
  outCanvas.height = outputSize;
  const ctx = outCanvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, left, top, drawW, drawH);

  return new Promise((resolve) => {
    outCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
  });
}

function closeCropModal() {
  const modal = document.getElementById("cropModalOverlay");
  if (modal) modal.style.display = "none";
  state.cropSourceCanvas = null;
  document.getElementById("avatarFileInput").value = "";
}

// ==================== FOLLOW LIST PAGE CONTROLLER ====================
async function onFollowListAppearing() {
  const isFollowers =
    String(state.followListMode).toLowerCase() === "followers";
  document.getElementById("followListTitleLabel").textContent = isFollowers
    ? "Followers"
    : "Following";

  const container = document.getElementById("followListContainer");
  const emptyEl = document.getElementById("followListEmptyLabel");
  container.innerHTML = "";

  const list = isFollowers
    ? await FirebaseService.getFollowerProfilesAsync(state.followListUid)
    : await FirebaseService.getFollowingProfilesAsync(state.followListUid);

  emptyEl.textContent = isFollowers
    ? "No followers yet"
    : "Not following anyone yet";
  emptyEl.style.display = list.length === 0 ? "block" : "none";

  list.forEach((u) => {
    const row = document.createElement("div");
    row.className = "user-row-card";
    row.innerHTML = `
      <div class="user-row-avatar" style="width: 48px; height: 48px; border-radius: 24px;">
        ${u.hasAvatar
        ? `<img src="${escapeHtml(u.AvatarUrl)}" alt="" />`
        : `<span>${escapeHtml(u.Initials)}</span>`
      }
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="color: white; font-size: 15px; font-weight: 700;">${escapeHtml(u.Handle)}</span>
        <span style="color: #94A3B8; font-size: 13px;">${escapeHtml(u.DisplayName)}</span>
      </div>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9,6 L15,12 L9,18" />
      </svg>
    `;
    row.addEventListener("click", () => {
      pushSubpage("CreatorProfilePage", {
        uid: u.Uid,
        handle: u.Handle,
        initials: u.Initials,
      });
    });
    container.appendChild(row);
  });
}

// ==================== INBOX NOTIFICATION BADGE COUNTER ====================
let cachedInboxCount = 0;

function formatBadgeCount(count) {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

function updateInboxBadgeUI(count) {
  cachedInboxCount = count;
  const text = formatBadgeCount(count);
  const show = count > 0;

  const tabBadge = document.getElementById("tabbarInboxBadge");
  if (tabBadge) {
    tabBadge.textContent = text;
    tabBadge.style.display = show ? "inline-flex" : "none";
  }

  const sidebarBadge = document.getElementById("sidebarInboxBadge");
  if (sidebarBadge) {
    sidebarBadge.textContent = text;
    sidebarBadge.style.display = show ? "inline-flex" : "none";
  }

  const profileBadge = document.getElementById("profileInboxBadge");
  if (profileBadge) {
    profileBadge.textContent = text;
    profileBadge.style.display = show ? "inline-flex" : "none";
  }
}

function markInboxAsViewed() {
  if (!FirebaseService.currentUid) return;
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    localStorage.setItem(`inbox_last_viewed_${FirebaseService.currentUid}`, String(nowSec));
  } catch {
    // ignore
  }
  updateInboxBadgeUI(0);
}

function getInboxLastViewedTime() {
  if (!FirebaseService.currentUid) return 0;
  try {
    return Number(localStorage.getItem(`inbox_last_viewed_${FirebaseService.currentUid}`)) || 0;
  } catch {
    return 0;
  }
}

async function refreshInboxBadgeCountAsync() {
  if (!FirebaseService.isLoggedIn || !FirebaseService.currentUid) {
    updateInboxBadgeUI(0);
    return;
  }

  // If inbox is currently open on screen, keep badge at 0
  if (getActivePageId() === "InboxPage") {
    updateInboxBadgeUI(0);
    return;
  }

  try {
    const rawItems = await FirebaseService.getNotificationsAsync();
    const lastViewed = getInboxLastViewedTime();
    // Only count notifications created after the user last viewed the inbox
    const unread = rawItems.filter((n) => (Number(n.CreatedAtUnix) || 0) > lastViewed);
    const grouped = groupInboxNotifications(unread);
    updateInboxBadgeUI(grouped.length);
  } catch {
    // ignore
  }
}

// ==================== INBOX PAGE CONTROLLER ====================
function groupInboxNotifications(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const grouped = [];
  const likeGroupsByUser = new Map();

  items.forEach((n) => {
    // Only group "like" notifications from the same user
    if (n.Type === "like" && n.FromUid) {
      if (!likeGroupsByUser.has(n.FromUid)) {
        const groupEntry = {
          ...n,
          isGroupedLikes: true,
          count: 1,
          klipIds: n.KlipId ? [n.KlipId] : [],
          latestTimestamp: n.CreatedAtUnix || 0,
        };
        likeGroupsByUser.set(n.FromUid, groupEntry);
        grouped.push(groupEntry);
      } else {
        const existing = likeGroupsByUser.get(n.FromUid);
        existing.count += 1;
        if (n.KlipId && !existing.klipIds.includes(n.KlipId)) {
          existing.klipIds.push(n.KlipId);
        }
        if ((n.CreatedAtUnix || 0) > existing.latestTimestamp) {
          existing.latestTimestamp = n.CreatedAtUnix;
          existing.CreatedAtUnix = n.CreatedAtUnix;
          if (n.KlipId) existing.KlipId = n.KlipId;
        }
        existing.Message = `${existing.FromHandle} liked ${existing.count} of your Klips ♥`;
      }
    } else {
      grouped.push(n);
    }
  });

  // Keep chronological order by latest timestamp
  grouped.sort((a, b) => (Number(b.CreatedAtUnix) || 0) - (Number(a.CreatedAtUnix) || 0));
  return grouped;
}

async function onInboxAppearing() {
  // Mark inbox as viewed immediately so counter disappears
  markInboxAsViewed();

  const emptyEl = document.getElementById("emptyInboxLabel");
  const scrollWrap = document.getElementById("inboxListScroll");
  const listEl = document.getElementById("notificationsList");
  listEl.innerHTML = "";

  const [rawItems, allKlips, userLikesMap] = await Promise.all([
    FirebaseService.getNotificationsAsync(),
    FirebaseService.getFeedKlipsAsync(),
    FirebaseService.getUserLikesMapAsync(),
  ]);
  const items = groupInboxNotifications(rawItems);

  const myUid = FirebaseService.currentUid;
  const myKlips = allKlips.filter((k) => k.CreatorUid === myUid);
  const myKlipMap = new Map(myKlips.map((k) => [k.Id, k]));

  emptyEl.style.display = items.length === 0 ? "block" : "none";
  scrollWrap.style.display = items.length > 0 ? "block" : "none";

  items.forEach((n) => {
    const card = document.createElement("div");
    card.className = "notification-card";

    // Collect all associated Klip IDs
    const targetKlipIds = Array.isArray(n.klipIds) && n.klipIds.length > 0
      ? [...n.klipIds]
      : n.KlipId ? [n.KlipId] : [];

    // If this notification was from before KlipId was recorded, resolve the actual distinct klips this user liked
    if (targetKlipIds.length === 0 && n.Type === "like" && n.FromUid && userLikesMap && userLikesMap[n.FromUid]) {
      const likerMap = userLikesMap[n.FromUid];
      for (const kid of Object.keys(likerMap)) {
        if (likerMap[kid] && myKlipMap.has(kid)) {
          targetKlipIds.push(kid);
        }
      }
    }

    // Find distinct Klips matching those IDs
    const matchedKlips = [];
    const seenIds = new Set();
    for (const id of targetKlipIds) {
      if (seenIds.has(id)) continue;
      const found = allKlips.find((k) => k.Id === id);
      if (found) {
        seenIds.add(id);
        matchedKlips.push(found);
      }
    }

    // If KlipId wasn't stored on older notifications, find creator's klips if applicable
    if (matchedKlips.length === 0 && (n.Type === "like" || n.Type === "comment" || n.Type === "comment_like") && myKlips.length > 0) {
      matchedKlips.push(myKlips[0]);
    }

    let thumbsClusterHtml = "";
    if (matchedKlips.length > 0) {
      // Display up to 3 thumbnails side-by-side for multiple videos (each distinct!)
      const displayKlips = matchedKlips.slice(0, 3);
      thumbsClusterHtml = `
        <div class="notification-thumbs-cluster">
          ${displayKlips
          .map((k) => {
            if (k.isPhotoPost && k.firstPhotoUrl) {
              return `
                  <div class="notification-thumb-box" data-klip-id="${escapeHtml(k.Id)}" title="View ${escapeHtml(k.Caption || "Klip")}">
                    <img class="notification-thumb-img" src="${escapeHtml(k.firstPhotoUrl)}" alt="" />
                  </div>
                `;
            }
            return `
                <div class="notification-thumb-box" data-klip-id="${escapeHtml(k.Id)}" title="View ${escapeHtml(k.Caption || "Klip")}">
                  <video class="notification-thumb-video" src="${escapeHtml(k.VideoUrl)}" preload="metadata" muted playsinline></video>
                  <div class="notification-thumb-badge">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="white">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  </div>
                </div>
              `;
          })
          .join("")}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="notification-left-group">
        <div class="notification-avatar">${escapeHtml(n.FromInitials)}</div>
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span style="color: white; font-size: 14px; font-weight: 700; word-break: break-word;">${escapeHtml(n.Message)}</span>
          <span style="color: #94A3B8; font-size: 12px;">${escapeHtml(n.timeAgo)}</span>
        </div>
      </div>
      ${thumbsClusterHtml}
    `;

    // Clicking individual thumbnail navigates specifically to that video
    card.querySelectorAll(".notification-thumb-box").forEach((thumbEl) => {
      thumbEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        const klipId = thumbEl.getAttribute("data-klip-id");
        const klip = matchedKlips.find((k) => k.Id === klipId) || matchedKlips[0];
        if (klip) {
          await pushSubpage("VideoDetailPage", {
            playlist: [klip],
            selected: klip,
            openComments: n.Type === "comment" || n.Type === "comment_like" || Boolean(n.CommentId),
          });
        }
      });
    });

    // Clicking the card body navigates to the first video (or user profile)
    card.addEventListener("click", async () => {
      if (matchedKlips.length > 0) {
        const topKlip = matchedKlips[0];
        await pushSubpage("VideoDetailPage", {
          playlist: [topKlip],
          selected: topKlip,
          openComments: n.Type === "comment" || n.Type === "comment_like" || Boolean(n.CommentId),
        });
        return;
      }

      if (n.FromUid) {
        pushSubpage("CreatorProfilePage", {
          uid: n.FromUid,
          handle: n.FromHandle || "@user",
          initials: n.FromInitials || "KL",
        });
      }
    });

    listEl.appendChild(card);
  });
}

// ==================== SEARCH PAGE CONTROLLER ====================
async function onSearchPageAppearing(initialQuery) {
  const searchEntry = document.getElementById("searchEntry");
  if (typeof initialQuery === "string") {
    searchEntry.value = initialQuery;
    document.getElementById("searchClearBtn").style.display = initialQuery
      ? "block"
      : "none";
    if (initialQuery.trim()) {
      RecommendationService.recordSearch(initialQuery.trim());
    }
  }

  const cachedKlips = FirebaseService.getCachedKlipsSnapshot();
  const cachedUsers = FirebaseService.getCachedUsersSnapshot();
  if (cachedKlips.length > 0 || cachedUsers.length > 0) {
    state.searchAllKlips = cachedKlips.filter((k) => !k.IsFemaleOnly);
    state.searchAllUsers = cachedUsers;
    applySearchFilter(searchEntry.value);
  }

  const [klips, users] = await Promise.all([
    FirebaseService.getFeedKlipsAsync(),
    FirebaseService.getAllUsersAsync(),
  ]);

  state.searchAllKlips = klips.filter((k) => !k.IsFemaleOnly);
  state.searchAllUsers = users;
  applySearchFilter(searchEntry.value);
}

function setSearchActiveTab(tab) {
  state.searchActiveTab = tab;
  document
    .getElementById("searchTabAll")
    .classList.toggle("active", tab === "All");
  document
    .getElementById("searchTabAccounts")
    .classList.toggle("active", tab === "Accounts");
  document
    .getElementById("searchTabKlips")
    .classList.toggle("active", tab === "Klips");

  applySearchFilter(document.getElementById("searchEntry").value);
}

function applySearchFilter(rawQuery) {
  const q = String(rawQuery || "").trim();
  const qLower = q.toLowerCase();
  const cleanHandleQ = qLower.replace(/^@/, "");

  state.searchFilteredUsers = !q
    ? [...state.searchAllUsers]
    : state.searchAllUsers.filter((u) => {
      const h = (u.Handle || "").toLowerCase();
      const dn = (u.DisplayName || "").toLowerCase();
      return (
        h.includes(qLower) ||
        (cleanHandleQ && h.includes(cleanHandleQ)) ||
        dn.includes(qLower) ||
        (cleanHandleQ && dn.includes(cleanHandleQ))
      );
    });

  state.searchFilteredKlips = !q
    ? [...state.searchAllKlips]
    : state.searchAllKlips.filter((k) => {
      const cap = (k.Caption || "").toLowerCase();
      const ch = (k.CreatorHandle || "").toLowerCase();
      const tags = (k.hashtags || "").toLowerCase();
      return (
        cap.includes(qLower) ||
        ch.includes(qLower) ||
        (cleanHandleQ && ch.includes(cleanHandleQ)) ||
        tags.includes(qLower)
      );
    });

  const hasUsers = state.searchFilteredUsers.length > 0;
  const hasKlips = state.searchFilteredKlips.length > 0;

  const accountsSection = document.getElementById("searchAccountsSection");
  const accountsHeader = document.getElementById("searchAccountsHeader");
  const accountsList = document.getElementById("searchAccountsList");
  const klipsSection = document.getElementById("searchKlipsSection");
  const klipsHeader = document.getElementById("searchKlipsHeader");
  const klipsGrid = document.getElementById("searchResultsGrid");
  const emptyLabel = document.getElementById("emptySearchLabel");

  // Render Accounts
  accountsList.innerHTML = "";
  state.searchFilteredUsers.forEach((u) => {
    const row = document.createElement("div");
    row.className = "user-row-card";
    row.innerHTML = `
      <div class="user-row-avatar">
        ${u.hasAvatar
        ? `<img src="${escapeHtml(u.AvatarUrl)}" alt="" />`
        : `<span>${escapeHtml(u.Initials)}</span>`
      }
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="color: white; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(u.DisplayName)}
        </span>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
          <span style="color: #38BDF8; font-weight: 700;">${escapeHtml(u.Handle)}</span>
          <span style="color: #64748B;">•</span>
          <span style="color: #94A3B8;">${escapeHtml(u.followersSummary)}</span>
        </div>
      </div>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9,6 L15,12 L9,18" />
      </svg>
    `;
    row.addEventListener("click", () => {
      if (!u.Uid) return;
      pushSubpage("CreatorProfilePage", {
        uid: u.Uid,
        handle: u.Handle,
        initials: u.Initials,
      });
    });
    accountsList.appendChild(row);
  });

  // Render Klips
  renderKlipsThumbnailGrid(
    klipsGrid,
    state.searchFilteredKlips,
    state.searchFilteredKlips,
    true
  );

  if (state.searchActiveTab === "All") {
    const showAccountsInAll = hasUsers && (Boolean(q) || !hasKlips);
    accountsSection.style.display = showAccountsInAll ? "block" : "none";
    accountsHeader.style.display = "block";
    klipsSection.style.display = hasKlips ? "block" : "none";
    klipsHeader.style.display = showAccountsInAll && hasKlips ? "block" : "none";
    emptyLabel.style.display = !showAccountsInAll && !hasKlips ? "block" : "none";
    emptyLabel.textContent = "No matching accounts or Klips found";
  } else if (state.searchActiveTab === "Accounts") {
    accountsSection.style.display = hasUsers ? "block" : "none";
    accountsHeader.style.display = "none";
    klipsSection.style.display = "none";
    emptyLabel.style.display = !hasUsers ? "block" : "none";
    emptyLabel.textContent = "No matching accounts found";
  } else {
    accountsSection.style.display = "none";
    klipsSection.style.display = hasKlips ? "block" : "none";
    klipsHeader.style.display = "none";
    emptyLabel.style.display = !hasKlips ? "block" : "none";
    emptyLabel.textContent = "No matching Klips found";
  }
}

// ==================== VIDEO DETAIL PAGE CONTROLLER ====================
async function onVideoDetailAppearing(playlist, selected, autoOpenComments = false) {
  let sourceList = [];
  if (Array.isArray(playlist) && playlist.length > 0) {
    sourceList = playlist;
  } else if (selected) {
    sourceList = [selected];
  }

  const targetId = selected?.Id || "";
  let targetIndex = 0;

  state.detailPlaylist = sourceList.map((item, i) => {
    const clone = item.createTabClone();
    // Fresh clone must be ready to play immediately when active
    clone.IsPaused = false;
    clone.IsPausedByUser = false;
    if (clone.Id === targetId) targetIndex = i;
    return clone;
  });

  const carouselEl = document.getElementById("detailFeedCarousel");
  releaseVideosIn(carouselEl);
  carouselEl.innerHTML = "";
  state.detailPlaylist.forEach((klip, index) => {
    carouselEl.appendChild(createFeedSlideElement(klip, "detail", index));
  });

  const slides = Array.from(carouselEl.querySelectorAll(".feed-slide"));
  const targetSlide = slides[targetIndex] || slides[0];

  // Immediately prepare the selected target video synchronously within the user gesture tick!
  if (targetSlide) {
    const targetVid = targetSlide.querySelector("video.klip-video-element");
    if (targetVid) {
      targetVid.dataset.active = "1";
      targetVid.preload = "auto";
      if (!targetVid.getAttribute("src") && !targetVid._hlsInstance && targetVid.dataset.src) {
        attachVideoToElement(targetVid, targetVid.dataset.src);
      }
      targetVid.defaultMuted = Boolean(state.userMuted);
      targetVid.muted = Boolean(state.userMuted);
      targetVid.volume = 1.0;
      // Start play attempt synchronously inside this touch/click user activation
      playVideoSafely(targetVid, targetSlide.querySelector(".rail-audio-disc"));
    }
  }

  const alignAndActivate = () => {
    if (targetSlide) {
      if (typeof targetSlide.scrollIntoView === "function") {
        targetSlide.scrollIntoView({ behavior: "instant", block: "start" });
      }
      carouselEl.scrollTop = targetSlide.offsetTop;
    } else {
      const h = carouselEl.clientHeight || window.innerHeight || 1;
      carouselEl.scrollTop = targetIndex * h;
    }
    activateCurrentDetailVideo(targetSlide);

    if (autoOpenComments) {
      const activeKlip = state.detailPlaylist[targetIndex] || selected;
      if (activeKlip) {
        setTimeout(() => openCommentsModal(activeKlip), 160);
      }
    }
  };

  // Align immediately and also after next frame for smooth layout settle
  alignAndActivate();
  requestAnimationFrame(alignAndActivate);
}

function activateCurrentDetailVideo(forcedSlide = null) {
  if (getActivePageId() !== "VideoDetailPage") {
    pauseAllCarouselVideos(document.getElementById("detailFeedCarousel"));
    return;
  }
  const carouselEl = document.getElementById("detailFeedCarousel");
  activateSlideInCarousel(carouselEl, state.detailPlaylist, forcedSlide);
}

// ==================== SOUND DETAIL PAGE CONTROLLER ====================
let currentSoundDetailParams = null;
let soundDetailPlaylist = [];
let pendingRenameKlip = null;

function formatStatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function openRenameSoundDialog(klip, currentTitle) {
  pendingRenameKlip = klip;
  const dialog = document.getElementById("renameSoundDialog");
  const input = document.getElementById("renameSoundTitleInput");
  const errorEl = document.getElementById("renameSoundError");
  if (errorEl) errorEl.style.display = "none";
  if (input) {
    input.value = currentTitle || "";
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }
  if (dialog) dialog.style.display = "flex";
}

function closeRenameSoundDialog() {
  const dialog = document.getElementById("renameSoundDialog");
  if (dialog) dialog.style.display = "none";
  pendingRenameKlip = null;
}

async function onSoundDetailAppearing(params = {}) {
  currentSoundDetailParams = params;
  const navTitle = document.getElementById("soundDetailNavTitle");
  const heroTitle = document.getElementById("soundHeroTitle");
  const heroCreator = document.getElementById("soundHeroCreator");
  const heroCount = document.getElementById("soundHeroCount");
  const gridPill = document.getElementById("soundGridVideosCountPill");
  const gridEl = document.getElementById("soundVideosGrid");
  const emptyEl = document.getElementById("soundEmptyState");
  const discWrap = document.getElementById("soundDiscBtn");
  const discVinyl = document.getElementById("soundDiscVinyl");
  const audioEl = document.getElementById("soundDetailAudio");
  const renameBtn = document.getElementById("soundHeroRenameBtn");

  const title = params.soundTitle || "Original Sound";
  const creator = params.creatorHandle || "@user";
  if (navTitle) navTitle.textContent = title;
  if (heroTitle) heroTitle.textContent = title;
  if (heroCreator) {
    heroCreator.textContent = creator;
    heroCreator.onclick = () => {
      pushSubpage("CreatorProfilePage", {
        uid: params.creatorUid || "",
        handle: creator,
        initials: getInitials(creator),
      });
    };
  }

  // Find all videos using this sound across feed, following, cached
  const pool = [
    ...(state.feedItems || []),
    ...(state.followingItems || []),
    ...(Array.isArray(FirebaseService._cachedFeedKlips) ? FirebaseService._cachedFeedKlips : []),
  ];

  const seenIds = new Set();
  const matching = [];
  const targetId = params.soundId || (params.klip ? (params.klip.SoundId || `sound_${params.klip.Id}`) : "");
  const originKlipId = params.klip?.Id || "";

  pool.forEach((k) => {
    if (!k || !k.Id || seenIds.has(k.Id)) return;
    const kSoundId = k.SoundId || `sound_${k.Id}`;

    const isOrigin = originKlipId && (k.Id === originKlipId);
    const isIdMatch = targetId && (k.SoundId === targetId || kSoundId === targetId);

    if (isOrigin || isIdMatch) {
      seenIds.add(k.Id);
      matching.push(k);
    }
  });

  if (params.klip && !seenIds.has(params.klip.Id)) {
    matching.unshift(params.klip);
    seenIds.add(params.klip.Id);
  }

  soundDetailPlaylist = matching;
  const countText = `${matching.length} video${matching.length === 1 ? "" : "s"}`;
  if (heroCount) heroCount.textContent = countText;
  if (gridPill) gridPill.textContent = String(matching.length);

  // If logged-in user is the creator of this clip/sound, show Rename button
  const primaryKlip = params.klip || matching[0];
  const myUid = FirebaseService.currentUid || "";
  const isCreator = FirebaseService.isLoggedIn && myUid && (
    (params.creatorUid && params.creatorUid === myUid) ||
    (primaryKlip && primaryKlip.CreatorUid === myUid)
  );

  if (renameBtn) {
    if (isCreator && primaryKlip && primaryKlip.Id) {
      renameBtn.style.display = "inline-flex";
      renameBtn.onclick = () => {
        openRenameSoundDialog(primaryKlip, primaryKlip.SoundTitle || title);
      };
    } else {
      renameBtn.style.display = "none";
    }
  }

  // Render 3-col video grid using standard optimized thumbnail grid
  if (gridEl) {
    if (matching.length === 0) {
      if (emptyEl) emptyEl.style.display = "flex";
      gridEl.innerHTML = "";
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      renderKlipsThumbnailGrid(gridEl, matching, soundDetailPlaylist, true);
    }
  }

  // Reset scroll so hero card is visible at the top
  const scrollBody = document.querySelector(".sound-detail-scroll-body");
  if (scrollBody) scrollBody.scrollTop = 0;

  // Setup Sound Audio Preview on Disc
  const audioSrc = params.audioUrl || (matching[0] && (matching[0].SoundAudioUrl || matching[0].VideoUrl)) || "";
  if (audioEl) {
    audioEl.pause();
    if (audioSrc) {
      audioEl.src = audioSrc;
    } else {
      audioEl.removeAttribute("src");
    }
  }

  if (discVinyl) discVinyl.classList.remove("playing");
  if (discWrap) {
    discWrap.onclick = () => {
      if (!audioEl || !audioEl.src) return;
      if (audioEl.paused) {
        audioEl.play().then(() => {
          discVinyl?.classList.add("playing");
        }).catch(() => { });
      } else {
        audioEl.pause();
        discVinyl?.classList.remove("playing");
      }
    };
  }

  if (audioEl) {
    audioEl.onended = () => {
      discVinyl?.classList.remove("playing");
    };
  }

  // Floating button: "Use this sound"
  const useBtn = document.getElementById("useThisSoundBtn");
  if (useBtn) {
    useBtn.onclick = () => {
      cleanupSoundDetailAudio();
      applySoundToCreation({
        id: targetId || (primaryKlip ? (primaryKlip.SoundId || `sound_${primaryKlip.Id}`) : `snd_${Date.now()}`),
        title: title,
        artist: creator,
        audioUrl: audioSrc,
        duration: 30,
      });
      popSubpage();
      switchRootTab("CreatePage");
    };
  }

  // Header Back button
  const backBtn = document.getElementById("soundDetailBackBtn");
  if (backBtn) {
    backBtn.onclick = () => popSubpage();
  }

  // Share Sound button
  const shareBtn = document.getElementById("soundDetailShareBtn");
  if (shareBtn) {
    shareBtn.onclick = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).catch(() => { });
      }
      showToast("Sound link copied!");
    };
  }
}

function cleanupSoundDetailAudio() {
  const audioEl = document.getElementById("soundDetailAudio");
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
  const discVinyl = document.getElementById("soundDiscVinyl");
  if (discVinyl) discVinyl.classList.remove("playing");
}

// ==================== SOUND PICKER & TRIMMER CONTROLLER ====================
let customUploadedAudioFile = null;

function openSoundPickerModal() {
  const modal = document.getElementById("soundPickerModalOverlay");
  if (!modal) return;
  modal.style.display = "flex";

  // Default to Audios tab
  switchSoundPickerTab("community");
  renderCommunitySoundCatalog();
}

function closeSoundPickerModal() {
  const modal = document.getElementById("soundPickerModalOverlay");
  if (modal) modal.style.display = "none";
  pauseSoundPickerPreview();
}

function pauseSoundPickerPreview() {
  const audio = document.getElementById("soundPickerAudio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
  }
  document.querySelectorAll(".sound-catalog-play-btn").forEach((btn) => {
    btn.classList.remove("playing");
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8,5 V19 L19,12 Z"/></svg>`;
  });
}

function switchSoundPickerTab(tab) {
  const uploadTabBtn = document.getElementById("tabUploadSoundBtn");
  const communityTabBtn = document.getElementById("tabCommunitySoundsBtn");
  const uploadView = document.getElementById("soundUploadView");
  const communityList = document.getElementById("communitySoundsList");
  const searchWrap = document.getElementById("soundSearchWrap");

  pauseSoundPickerPreview();

  if (tab === "upload") {
    uploadTabBtn?.classList.add("active");
    communityTabBtn?.classList.remove("active");

    if (uploadView) uploadView.style.display = "flex";
    if (communityList) communityList.style.display = "none";
    if (searchWrap) searchWrap.style.display = "none";
  } else {
    communityTabBtn?.classList.add("active");
    uploadTabBtn?.classList.remove("active");

    if (uploadView) uploadView.style.display = "none";
    if (communityList) communityList.style.display = "flex";
    if (searchWrap) searchWrap.style.display = "flex";
  }
}

function renderCommunitySoundCatalog(filterText = "") {
  const listEl = document.getElementById("communitySoundsList");
  if (!listEl) return;
  listEl.innerHTML = "";

  const pool = [
    ...(state.feedItems || []),
    ...(state.followingItems || []),
    ...(Array.isArray(FirebaseService._cachedFeedKlips) ? FirebaseService._cachedFeedKlips : []),
  ];

  const uniqueSoundsMap = new Map();
  pool.forEach((k) => {
    if (!k || !k.Id) return;
    const soundId = k.SoundId || `sound_${k.Id}`;
    const soundTitle = k.SoundTitle || `Original Sound - ${k.CreatorHandle || "@user"}`;
    const audioUrl = k.SoundAudioUrl || k.VideoUrl || "";

    if (!uniqueSoundsMap.has(soundId)) {
      uniqueSoundsMap.set(soundId, {
        id: soundId,
        title: soundTitle,
        artist: k.CreatorHandle || "@user",
        audioUrl: audioUrl,
        duration: 30,
        usesCount: 1,
      });
    } else {
      uniqueSoundsMap.get(soundId).usesCount += 1;
    }
  });

  const query = (filterText || "").trim().toLowerCase();
  const list = Array.from(uniqueSoundsMap.values()).filter((s) => {
    if (!query) return true;
    return s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query);
  });

  if (list.length === 0) {
    listEl.innerHTML = `<div style="text-align: center; color: #64748B; padding: 28px 0; font-size: 13px;">${query ? `No audios found matching "${escapeHtml(filterText)}"` : "No audios available yet"}</div>`;
    return;
  }

  list.forEach((sound) => {
    const row = document.createElement("div");
    row.className = "sound-catalog-item";
    row.innerHTML = `
      <div class="sound-catalog-left">
        <button type="button" class="sound-catalog-play-btn" title="Play preview">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8,5 V19 L19,12 Z"/></svg>
        </button>
        <div class="sound-catalog-info">
          <span class="sound-catalog-title">${escapeHtml(sound.title)}</span>
          <span class="sound-catalog-sub">${escapeHtml(sound.artist)} • ${sound.usesCount} Klip${sound.usesCount === 1 ? "" : "s"}</span>
        </div>
      </div>
      <button type="button" class="sound-catalog-use-btn">Use</button>
    `;

    const playBtn = row.querySelector(".sound-catalog-play-btn");
    playBtn.addEventListener("click", () => {
      const audio = document.getElementById("soundPickerAudio");
      if (!audio || !sound.audioUrl) return;
      if (playBtn.classList.contains("playing")) {
        audio.pause();
        playBtn.classList.remove("playing");
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8,5 V19 L19,12 Z"/></svg>`;
      } else {
        pauseSoundPickerPreview();
        audio.src = sound.audioUrl;
        audio.play().then(() => {
          playBtn.classList.add("playing");
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6,5 H10 V19 H6 Z M14,5 H18 V19 H14 Z"/></svg>`;
        }).catch(() => { });
        audio.onended = () => {
          playBtn.classList.remove("playing");
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8,5 V19 L19,12 Z"/></svg>`;
        };
      }
    });

    const useBtn = row.querySelector(".sound-catalog-use-btn");
    useBtn.addEventListener("click", () => {
      closeSoundPickerModal();
      applySoundToCreation({
        id: sound.id,
        title: sound.title,
        artist: sound.artist,
        audioUrl: sound.audioUrl,
        duration: sound.duration || 30,
      });
    });

    listEl.appendChild(row);
  });
}

function applySoundToCreation(sound) {
  if (!sound) return;

  const totalDur = sound.duration || 60;
  state.selectedSound = {
    id: sound.id || `sound_${Date.now()}`,
    title: sound.title || "Selected Sound",
    artist: sound.artist || "@user",
    audioUrl: sound.audioUrl || "",
    audioFile: sound.audioFile || null,
    isCustomUpload: Boolean(sound.isCustomUpload),
    duration: totalDur,
    startTime: 0,
    endTime: Math.min(totalDur, Math.max(state.videoDuration || 15, 15)),
  };

  const panel = document.getElementById("createSoundPanel");
  const label = document.getElementById("createSoundLabel");
  const sub = document.getElementById("createSoundSub");
  const actionText = document.getElementById("createSoundActionText");
  const removeBtn = document.getElementById("removeSelectedSoundBtn");
  const trimTriggerBtn = document.getElementById("openTrimmerModalBtn");
  const audioNameGroup = document.getElementById("postAudioNameGroup");
  const audioNameInput = document.getElementById("postAudioNameInput");

  if (panel) panel.classList.add("has-sound");
  if (label) label.textContent = state.selectedSound.title;
  if (sub) sub.textContent = state.selectedSound.artist;
  if (actionText) actionText.textContent = "Change";
  if (removeBtn) removeBtn.style.display = "block";
  if (trimTriggerBtn) {
    trimTriggerBtn.style.display = "inline-flex";
    const dur = (state.selectedSound.endTime - state.selectedSound.startTime).toFixed(1);
    trimTriggerBtn.textContent = `✂ Trim (${dur}s)`;
  }
  if (audioNameGroup) audioNameGroup.style.display = "block";
  if (audioNameInput && state.selectedSound.isCustomUpload) {
    audioNameInput.value = state.selectedSound.title || "";
  }

  initTrimmerControls();
  updateTrimmerConstraints();
  updateTrimmerUI();
}

function openSoundTrimmerModal() {
  if (!state.selectedSound) return;
  const overlay = document.getElementById("soundTrimmerModalOverlay");
  const titleEl = document.getElementById("soundTrimmerModalSoundTitle");
  const artistEl = document.getElementById("soundTrimmerModalSoundArtist");

  if (titleEl) titleEl.textContent = state.selectedSound.title || "Original Sound";
  if (artistEl) artistEl.textContent = state.selectedSound.artist || "@user";

  // Backup current points in case user cancels
  state.selectedSound._backupStart = state.selectedSound.startTime || 0;
  state.selectedSound._backupEnd = state.selectedSound.endTime || 15;

  initTrimmerControls();
  updateTrimmerConstraints();
  updateTrimmerUI();

  if (overlay) overlay.style.display = "flex";
}

function closeSoundTrimmerModal(applyChanges = true) {
  const overlay = document.getElementById("soundTrimmerModalOverlay");
  if (overlay) overlay.style.display = "none";
  pauseTrimmerPreview();

  if (!applyChanges && state.selectedSound && state.selectedSound._backupStart !== undefined) {
    state.selectedSound.startTime = state.selectedSound._backupStart;
    state.selectedSound.endTime = state.selectedSound._backupEnd;
  }

  updateTrimmerConstraints();
  updateTrimmerUI();
}

function clearSelectedSound() {
  state.selectedSound = null;
  const panel = document.getElementById("createSoundPanel");
  const label = document.getElementById("createSoundLabel");
  const sub = document.getElementById("createSoundSub");
  const actionText = document.getElementById("createSoundActionText");
  const removeBtn = document.getElementById("removeSelectedSoundBtn");
  const trimTriggerBtn = document.getElementById("openTrimmerModalBtn");
  const audioNameGroup = document.getElementById("postAudioNameGroup");
  const audioNameInput = document.getElementById("postAudioNameInput");

  if (panel) panel.classList.remove("has-sound");
  if (label) label.textContent = "Add Sound";
  if (sub) sub.textContent = "Choose from audios or upload";
  if (actionText) actionText.textContent = "Select";
  if (removeBtn) removeBtn.style.display = "none";
  if (trimTriggerBtn) trimTriggerBtn.style.display = "none";
  if (audioNameGroup) audioNameGroup.style.display = "none";
  if (audioNameInput) audioNameInput.value = "";

  closeSoundTrimmerModal(false);
}

function initTrimmerControls() {
  if (!state.selectedSound) return;
  const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
  if (state.selectedSound.startTime === undefined || state.selectedSound.startTime === null) {
    state.selectedSound.startTime = 0;
  }
  if (!state.selectedSound.endTime) {
    state.selectedSound.endTime = Math.min(maxDur, Math.max(state.videoDuration || 15, 15));
  }
  updateTrimmerConstraints();
}

function updateTrimmerConstraints() {
  if (!state.selectedSound) return;

  const minVideoDur = Math.max(0, state.videoDuration || 0);
  const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
  const hintEl = document.getElementById("trimmerConstraintHint");
  const minDurLabel = document.getElementById("trimmerMinVideoDurLabel");

  if (state.selectedSound.startTime < 0) state.selectedSound.startTime = 0;
  if (state.selectedSound.endTime > maxDur) state.selectedSound.endTime = maxDur;

  if (minVideoDur > 0) {
    if (minDurLabel) minDurLabel.textContent = `${minVideoDur}s`;
    if (hintEl) hintEl.style.display = "block";

    let cropDur = state.selectedSound.endTime - state.selectedSound.startTime;
    if (cropDur < minVideoDur) {
      if (state.selectedSound.startTime + minVideoDur <= maxDur) {
        state.selectedSound.endTime = state.selectedSound.startTime + minVideoDur;
      } else {
        state.selectedSound.endTime = maxDur;
        state.selectedSound.startTime = Math.max(0, maxDur - minVideoDur);
      }
    }
  } else {
    if (hintEl) hintEl.style.display = "none";
    if (state.selectedSound.endTime <= state.selectedSound.startTime) {
      state.selectedSound.endTime = Math.min(maxDur, state.selectedSound.startTime + 1);
    }
  }

  updateTrimmerUI();
}

function updateTrimmerUI() {
  if (!state.selectedSound) return;

  const startValEl = document.getElementById("trimmerStartVal");
  const endValEl = document.getElementById("trimmerEndVal");
  const durValEl = document.getElementById("trimmerDurationVal");
  const highlight = document.getElementById("trimmerRangeHighlight");
  const handleStart = document.getElementById("trimmerHandleStart");
  const handleEnd = document.getElementById("trimmerHandleEnd");

  const start = Math.max(0, Number(state.selectedSound.startTime) || 0);
  const end = Math.max(0, Number(state.selectedSound.endTime) || 0);
  const cropDur = Math.max(0, Math.round((end - start) * 10) / 10);
  const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));

  const formatMinSec = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (startValEl) startValEl.textContent = formatMinSec(start);
  if (endValEl) endValEl.textContent = formatMinSec(end);
  if (durValEl) durValEl.textContent = `${cropDur.toFixed(1)}s`;
  const trimTriggerBtn = document.getElementById("openTrimmerModalBtn");
  if (trimTriggerBtn) {
    trimTriggerBtn.textContent = `✂ Trim (${cropDur.toFixed(1)}s)`;
  }

  const leftPct = (start / maxDur) * 100;
  const widthPct = ((end - start) / maxDur) * 100;

  if (highlight) {
    highlight.style.left = `${Math.max(0, leftPct)}%`;
    highlight.style.width = `${Math.max(0, Math.min(100 - leftPct, widthPct))}%`;
  }
  if (handleStart) {
    handleStart.style.left = `${Math.max(0, Math.min(100, leftPct))}%`;
  }
  if (handleEnd) {
    handleEnd.style.left = `${Math.max(0, Math.min(100, leftPct + widthPct))}%`;
  }
}

let trimmerPreviewTimer = null;
function toggleTrimmerPreview() {
  if (!state.selectedSound || !state.selectedSound.audioUrl) {
    showToast("No audio source available to preview.");
    return;
  }

  const audio = document.getElementById("soundPickerAudio");
  const btn = document.getElementById("trimmerPlayPauseBtn");
  if (!audio) return;

  if (!audio.paused) {
    pauseTrimmerPreview();
    return;
  }

  const start = Number(state.selectedSound.startTime) || 0;
  const end = Number(state.selectedSound.endTime) || 15;
  const durationMs = Math.max(1000, (end - start) * 1000);

  audio.src = state.selectedSound.audioUrl;
  audio.currentTime = start;
  audio.play().then(() => {
    if (btn) btn.textContent = "⏸ Pause";
    if (trimmerPreviewTimer) clearTimeout(trimmerPreviewTimer);
    trimmerPreviewTimer = setTimeout(() => {
      pauseTrimmerPreview();
    }, durationMs);
  }).catch(() => { });
}

function pauseTrimmerPreview() {
  const audio = document.getElementById("soundPickerAudio");
  const btn = document.getElementById("trimmerPlayPauseBtn");
  if (audio) audio.pause();
  if (btn) btn.textContent = "▶ Play Preview";
  if (trimmerPreviewTimer) {
    clearTimeout(trimmerPreviewTimer);
    trimmerPreviewTimer = null;
  }
}

// ==================== COMMENTS BOTTOM SHEET CONTROLLER ====================
let activeCommentKlip = null;
let isPostingComment = false;
let currentCommentsList = [];

function formatCommentTimeAgo(unixSeconds) {
  if (!unixSeconds) return "Just now";
  const diffSec = Math.floor(Date.now() / 1000) - Number(unixSeconds);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ==================== AUTH PROMPT DIALOG CONTROLLER ====================
function showAuthPrompt(title = "Sign in to Klip", message = "Join the Klip community to post, comment, like, and follow creators.") {
  const dialog = document.getElementById("authPromptDialog");
  const titleEl = document.getElementById("authPromptTitle");
  const textEl = document.getElementById("authPromptText");
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = message;
  if (dialog) dialog.style.display = "flex";
}

function closeAuthPrompt() {
  const dialog = document.getElementById("authPromptDialog");
  if (dialog) dialog.style.display = "none";
}

async function openCommentsModal(klip) {
  if (!klip) return;

  if (!FirebaseService.isLoggedIn) {
    showAuthPrompt("Sign in to Comment", "Join Klip to view and leave kosher comments on videos and photos.");
    return;
  }

  activeCommentKlip = klip;

  const overlay = document.getElementById("commentModalOverlay");
  const title = document.getElementById("commentModalTitle");
  const input = document.getElementById("commentInputEntry");
  const emptyState = document.getElementById("commentEmptyState");
  const loading = document.getElementById("commentLoadingIndicator");
  const listEl = document.getElementById("commentsList");

  if (title) {
    const count = Number(klip.CommentsCount) || 0;
    title.textContent = count > 0 ? `Comments (${count})` : "Comments";
  }
  if (input) input.value = "";
  if (emptyState) emptyState.style.display = "none";
  if (loading) loading.style.display = "flex";
  if (listEl) listEl.innerHTML = "";
  currentCommentsList = [];

  if (overlay) {
    overlay.style.display = "flex";
  }

  await loadCommentsForActiveKlipAsync();
}

// ==================== COMMENT REPLY CONTROLLER ====================
let activeReplyTarget = null; // { parentCommentId, replyToHandle, replyToUid }
let expandedReplyParentIds = new Set(); // IDs of parent comments whose replies are expanded

function setReplyTarget(parentCommentId, replyToHandle, replyToUid) {
  activeReplyTarget = { parentCommentId, replyToHandle, replyToUid };
  const banner = document.getElementById("commentReplyBanner");
  const nameEl = document.getElementById("commentReplyTargetName");
  const input = document.getElementById("commentInputEntry");
  if (banner && nameEl) {
    nameEl.textContent = replyToHandle || "@user";
    banner.style.display = "flex";
  }
  if (input) {
    input.placeholder = `Reply to ${replyToHandle || "@user"}...`;
    input.focus();
  }
}

function clearReplyTarget() {
  activeReplyTarget = null;
  const banner = document.getElementById("commentReplyBanner");
  const input = document.getElementById("commentInputEntry");
  if (banner) banner.style.display = "none";
  if (input) input.placeholder = "Add a kosher comment...";
}

function closeCommentsModal() {
  const overlay = document.getElementById("commentModalOverlay");
  if (!overlay || overlay.style.display === "none") return;

  const input = document.getElementById("commentInputEntry");
  if (input) input.blur();

  overlay.style.display = "none";
  activeCommentKlip = null;
  currentCommentsList = [];
  clearReplyTarget();
  expandedReplyParentIds.clear(); // unexpands all comment threads on exit
}

async function loadCommentsForActiveKlipAsync() {
  if (!activeCommentKlip) return;
  const klipId = activeCommentKlip.Id;

  const loading = document.getElementById("commentLoadingIndicator");
  const emptyState = document.getElementById("commentEmptyState");
  const title = document.getElementById("commentModalTitle");

  try {
    const comments = await FirebaseService.getCommentsAsync(klipId);
    if (!activeCommentKlip || activeCommentKlip.Id !== klipId) return;

    currentCommentsList = comments;
    renderCommentsList(comments);

    if (loading) loading.style.display = "none";
    if (emptyState) {
      emptyState.style.display = comments.length === 0 ? "flex" : "none";
    }
    if (title) {
      title.textContent = comments.length > 0 ? `Comments (${comments.length})` : "Comments";
    }
  } catch {
    if (loading) loading.style.display = "none";
    if (emptyState) emptyState.style.display = "flex";
  }
}

function createCommentItemElement(c, isReply = false, rootParentId = null) {
  const item = document.createElement("div");
  item.className = `comment-item ${isReply ? "comment-reply-item" : ""}`;
  item.dataset.commentId = c.Id;
  item.dataset.userUid = c.UserUid || c.UserId || "";

  const myUid = FirebaseService.currentUid || "";
  const hasAvatar = Boolean(c.UserAvatarUrl && c.UserAvatarUrl.trim());
  const initials = c.UserInitials || getInitials(c.UserHandle || "KL");
  const isOwner = myUid && (c.UserUid === myUid || (activeCommentKlip && activeCommentKlip.CreatorUid === myUid));
  const isLiked = Boolean(c.IsLiked);
  const likesCount = Math.max(0, Number(c.LikesCount) || 0);

  // User Handle header: if reply with ReplyToHandle: "YourName > ReplyName"
  let handleHtml = `<span class="comment-user-handle author-handle">${escapeHtml(c.UserHandle || "@user")}</span>`;
  if (isReply && c.ReplyToHandle) {
    handleHtml = `
      <span class="comment-user-handle author-handle">${escapeHtml(c.UserHandle || "@user")}</span>
      <span class="comment-reply-arrow">&gt;</span>
      <span class="comment-user-handle target-handle">${escapeHtml(c.ReplyToHandle)}</span>
    `;
  }

  item.innerHTML = `
    <div class="comment-avatar-box">
      ${hasAvatar
      ? `<img class="comment-avatar-img" src="${escapeHtml(c.UserAvatarUrl)}" alt="" />`
      : `<span class="comment-avatar-initials">${escapeHtml(initials)}</span>`
    }
    </div>
    <div class="comment-content-col">
      <div class="comment-meta-row">
        ${handleHtml}
        <span class="comment-bullet">•</span>
        <span class="comment-time-ago">${formatCommentTimeAgo(c.CreatedAtUnix)}</span>
        <button type="button" class="comment-reply-action-btn">Reply</button>
      </div>
      <div class="comment-text">${escapeHtml(c.Text || "")}</div>
    </div>
    <div class="comment-actions-col">
      <button class="comment-like-btn ${isLiked ? "liked" : ""}" title="Like comment" aria-label="Like comment">
        <svg viewBox="0 0 24 24">
          <path d="M12,21.35 L10.55,20.03 C5.4,15.36 2,12.27 2,8.5 C2,5.41 4.42,3 7.5,3 C9.24,3 10.91,3.81 12,5.08 C13.09,3.81 14.76,3 16.5,3 C19.58,3 22,5.41 22,8.5 C22,12.27 18.6,15.36 13.45,20.03 L12,21.35 Z" />
        </svg>
        <span class="comment-like-count" style="${likesCount > 0 ? "" : "display: none;"}">${likesCount > 0 ? likesCount : ""}</span>
      </button>
      ${isOwner
      ? `<button class="comment-delete-btn" title="Delete comment" aria-label="Delete comment">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19,4 H15.5 L14.5,3 H9.5 L8.5,4 H5 V6 H19 M6,19 A2,2 0 0,0 8,21 H16 A2,2 0 0,0 18,19 V7 H6 V19 Z"/>
              </svg>
            </button>`
      : ""
    }
    </div>
  `;

  // Profile click on author
  item.querySelector(".author-handle")?.addEventListener("click", () => {
    closeCommentsModal();
    pushSubpage("CreatorProfilePage", {
      uid: c.UserUid || "",
      handle: c.UserHandle || "@user",
      initials: initials,
    });
  });

  // Profile click on target handle (if replying to a reply)
  item.querySelector(".target-handle")?.addEventListener("click", () => {
    closeCommentsModal();
    pushSubpage("CreatorProfilePage", {
      uid: c.ReplyToUid || "",
      handle: c.ReplyToHandle || "@user",
      initials: getInitials(c.ReplyToHandle || "KL"),
    });
  });

  // Reply button click
  const replyActionBtn = item.querySelector(".comment-reply-action-btn");
  replyActionBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const effectiveParentId = rootParentId || c.Id;
    setReplyTarget(effectiveParentId, c.UserHandle || "@user", c.UserUid || "");
  });

  // Like comment button
  const likeBtn = item.querySelector(".comment-like-btn");
  likeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleToggleCommentLike(c, likeBtn);
  });

  // Delete comment button
  if (isOwner) {
    item.querySelector(".comment-delete-btn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleDeleteComment(c);
    });
  }

  return item;
}

function renderCommentsList(comments) {
  const listEl = document.getElementById("commentsList");
  if (!listEl) return;
  listEl.innerHTML = "";

  const commentMap = new Map();
  comments.forEach((c) => commentMap.set(c.Id, c));

  const topLevel = [];
  const repliesMap = new Map();

  comments.forEach((c) => {
    if (c.ParentCommentId && commentMap.has(c.ParentCommentId)) {
      if (!repliesMap.has(c.ParentCommentId)) {
        repliesMap.set(c.ParentCommentId, []);
      }
      repliesMap.get(c.ParentCommentId).push(c);
    } else {
      topLevel.push(c);
    }
  });

  topLevel.forEach((parent) => {
    const parentEl = createCommentItemElement(parent, false, parent.Id);
    listEl.appendChild(parentEl);

    const replies = repliesMap.get(parent.Id) || [];
    if (replies.length === 1) {
      // If 1 reply, show it directly indented beneath parent comment
      listEl.appendChild(createCommentItemElement(replies[0], true, parent.Id));
    } else if (replies.length > 1) {
      // If more than 1 reply, show expander toggle
      const isExpanded = expandedReplyParentIds.has(parent.Id);
      if (isExpanded) {
        replies.forEach((reply) => {
          listEl.appendChild(createCommentItemElement(reply, true, parent.Id));
        });

        const hideBtn = document.createElement("button");
        hideBtn.type = "button";
        hideBtn.className = "comment-replies-expander-btn";
        hideBtn.textContent = "Hide replies";
        hideBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          expandedReplyParentIds.delete(parent.Id);
          renderCommentsList(currentCommentsList);
        });
        listEl.appendChild(hideBtn);
      } else {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "comment-replies-expander-btn";
        viewBtn.textContent = `View ${replies.length} replies`;
        viewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          expandedReplyParentIds.add(parent.Id);
          renderCommentsList(currentCommentsList);
        });
        listEl.appendChild(viewBtn);
      }
    }
  });
}

function handleToggleCommentLike(comment, btnEl) {
  if (!comment || !activeCommentKlip) return;

  if (!FirebaseService.isLoggedIn) {
    showAuthPrompt("Sign in to like comments");
    return;
  }

  const willLike = !comment.IsLiked;
  comment.IsLiked = willLike;
  const currentCount = Math.max(0, Number(comment.LikesCount) || 0);
  comment.LikesCount = Math.max(0, currentCount + (willLike ? 1 : -1));

  btnEl.classList.toggle("liked", willLike);
  const countEl = btnEl.querySelector(".comment-like-count");
  if (countEl) {
    countEl.textContent = comment.LikesCount > 0 ? String(comment.LikesCount) : "";
    countEl.style.display = comment.LikesCount > 0 ? "" : "none";
  }

  const svg = btnEl.querySelector("svg");
  if (svg) {
    svg.style.transform = "scale(1.35)";
    setTimeout(() => {
      svg.style.transform = "scale(1)";
    }, 150);
  }

  FirebaseService.setCommentLikeAsync(comment, willLike);
}

async function handlePostComment() {
  if (isPostingComment || !activeCommentKlip) return;
  const input = document.getElementById("commentInputEntry");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  if (!FirebaseService.isLoggedIn) {
    showToast("Please sign in to comment.");
    return;
  }

  isPostingComment = true;
  const sendBtn = document.getElementById("commentSendBtn");
  if (sendBtn) sendBtn.disabled = true;

  try {
    const video = activeCommentKlip;
    const parentId = activeReplyTarget?.parentCommentId || null;
    const replyHandle = activeReplyTarget?.replyToHandle || null;
    const replyUid = activeReplyTarget?.replyToUid || null;

    const { success, comment, error } = await FirebaseService.addCommentAsync(
      video,
      text,
      parentId,
      replyHandle,
      replyUid
    );

    if (success && comment) {
      input.value = "";
      if (parentId) {
        expandedReplyParentIds.add(parentId);
      }
      clearReplyTarget();

      currentCommentsList.push(comment);
      renderCommentsList(currentCommentsList);

      const emptyState = document.getElementById("commentEmptyState");
      if (emptyState) emptyState.style.display = "none";

      const title = document.getElementById("commentModalTitle");
      if (title) title.textContent = `Comments (${currentCommentsList.length})`;

      syncVideoAcrossAllViews(video);

      // Scroll to bottom of comments
      const body = document.querySelector(".comments-body");
      if (body) body.scrollTop = body.scrollHeight;
    } else {
      console.error("Post comment error:", error);
      showToast(error || "Could not post comment.");
    }
  } catch (err) {
    console.error("Post comment unexpected error:", err);
    showToast(err?.message || "Could not post comment.");
  } finally {
    isPostingComment = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function handleDeleteComment(comment) {
  if (!activeCommentKlip || !comment) return;
  const confirmed = window.confirm("Are you sure you want to delete this comment?");
  if (!confirmed) return;

  const video = activeCommentKlip;
  const { success, error } = await FirebaseService.deleteCommentAsync(video, comment);

  if (success) {
    currentCommentsList = currentCommentsList.filter((x) => x.Id !== comment.Id);
    renderCommentsList(currentCommentsList);

    const emptyState = document.getElementById("commentEmptyState");
    if (emptyState) {
      emptyState.style.display = currentCommentsList.length === 0 ? "flex" : "none";
    }

    const title = document.getElementById("commentModalTitle");
    if (title) {
      title.textContent =
        currentCommentsList.length > 0 ? `Comments (${currentCommentsList.length})` : "Comments";
    }

    syncVideoAcrossAllViews(video);
    showToast("Comment deleted.");
  } else {
    showToast(error || "Could not delete comment.");
  }
}

// ==================== SHARE & DOWNLOAD MODAL CONTROLLER ====================
let pendingShareKlip = null;
let isDownloadingMedia = false;

function openShareModal(klip) {
  if (!klip) return;
  pendingShareKlip = klip;
  RecommendationService.recordInteraction(klip, VideoInteractionType.Shared);

  const dialog = document.getElementById("shareModalDialog");
  const downloadBtn = document.getElementById("shareDownloadBtn");
  const downloadLabel = document.getElementById("shareDownloadLabel");
  const progressEl = document.getElementById("shareDownloadProgress");
  const titleEl = document.getElementById("shareSheetTitle");
  const subEl = document.getElementById("shareSheetSubtitle");

  if (titleEl) {
    titleEl.textContent = klip.isVideoPost ? "Share Video" : "Share Photo";
  }
  if (subEl) {
    subEl.textContent = `by ${klip.CreatorHandle || "@user"}`;
  }
  if (downloadLabel) {
    downloadLabel.textContent = "Download";
  }
  if (downloadBtn) {
    downloadBtn.style.display = klip.VideoUrl || (klip.isPhotoPost && klip.PhotoUrls?.length > 0) ? "flex" : "none";
  }
  if (progressEl) {
    progressEl.style.display = "none";
  }

  if (dialog) dialog.style.display = "flex";
}

function closeShareModal() {
  const dialog = document.getElementById("shareModalDialog");
  if (dialog) dialog.style.display = "none";
  pendingShareKlip = null;
}

let cachedKlipLogoImg = null;
function getKlipLogoImage() {
  if (!cachedKlipLogoImg && typeof Image !== "undefined") {
    cachedKlipLogoImg = new Image();
    cachedKlipLogoImg.src = "./assets/klip_logo.png";
  }
  return cachedKlipLogoImg;
}

function createKlipWatermarkBadge(width, height, creatorHandle) {
  const handleText = String(creatorHandle || "@user").trim();
  const pad = Math.round(width * 0.035);
  const boxW = Math.max(160, Math.round(width * 0.32));
  const boxH = Math.max(50, Math.round(boxW * 0.34));
  const x = width - boxW - pad;
  const y = height - boxH - pad - Math.round(height * 0.09);

  const badgeCanvas = document.createElement("canvas");
  badgeCanvas.width = boxW + 4;
  badgeCanvas.height = boxH + 4;
  const bCtx = badgeCanvas.getContext("2d");
  if (!bCtx) return null;

  // Draw pill onto offscreen canvas (offset by 2px for stroke border)
  bCtx.fillStyle = "rgba(11, 14, 23, 0.78)";
  bCtx.beginPath();
  if (typeof bCtx.roundRect === "function") {
    bCtx.roundRect(2, 2, boxW, boxH, 14);
  } else {
    bCtx.rect(2, 2, boxW, boxH);
  }
  bCtx.fill();
  bCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  bCtx.lineWidth = 1.5;
  bCtx.stroke();

  // Draw Klip Logo Icon on the left side of the pill
  const logoImg = getKlipLogoImage();
  const logoSize = Math.round(boxH * 0.65);
  const logoX = 2 + Math.round(boxH * 0.2);
  const logoY = 2 + Math.round((boxH - logoSize) / 2);

  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    bCtx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
  } else {
    bCtx.fillStyle = "#38BDF8";
    bCtx.beginPath();
    bCtx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.fillStyle = "#0B0E17";
    bCtx.font = `bold ${Math.round(logoSize * 0.65)}px system-ui, sans-serif`;
    bCtx.textAlign = "center";
    bCtx.textBaseline = "middle";
    bCtx.fillText("K", logoX + logoSize / 2, logoY + logoSize / 2);
  }

  // Text layout to the right of logo
  const textLeft = logoX + logoSize + Math.round(boxW * 0.06);

  // "KLIP" Title
  bCtx.fillStyle = "#38BDF8";
  bCtx.textAlign = "left";
  bCtx.textBaseline = "middle";
  bCtx.font = `bold ${Math.round(boxH * 0.36)}px system-ui, -apple-system, sans-serif`;
  bCtx.fillText("KLIP", textLeft, 2 + Math.round(boxH * 0.34));

  // Creator Handle
  bCtx.fillStyle = "#FFFFFF";
  bCtx.font = `600 ${Math.round(boxH * 0.24)}px system-ui, -apple-system, sans-serif`;
  bCtx.fillText(handleText, textLeft, 2 + Math.round(boxH * 0.72));

  return {
    canvas: badgeCanvas,
    x: x - 2,
    y: y - 2,
  };
}

function drawKlipWatermarkOnCanvas(ctx, width, height, creatorHandle) {
  const badge = createKlipWatermarkBadge(width, height, creatorHandle);
  if (badge && ctx) {
    ctx.drawImage(badge.canvas, badge.x, badge.y);
  }
}

async function renderWatermarkedPhotoBlobAsync(photoUrl, creatorHandle) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawKlipWatermarkOnCanvas(ctx, canvas.width, canvas.height, creatorHandle);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load photo for watermarking"));
    img.src = photoUrl;
  });
}

async function renderWatermarkedVideoBlobAsync(videoUrl, creatorHandle, onProgress) {
  if (typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("captureStream not supported in this browser");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder not supported in this browser");
  }

  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.playsInline = true;
  v.muted = false; // Must NOT be muted so audioCtx can extract audio track cleanly!
  v.volume = 1.0;
  v.preload = "auto";
  v.src = videoUrl;

  await new Promise((resolve, reject) => {
    v.onloadedmetadata = resolve;
    v.onerror = () => reject(new Error("Failed to load video stream"));
    setTimeout(() => reject(new Error("Timeout loading video metadata")), 9000);
  });

  // Downscale high-resolution videos (1080p, 4K) to 720p HD max to speed up encoding 4x-9x
  const MAX_W = 720;
  const MAX_H = 1280;
  let rawW = v.videoWidth || 720;
  let rawH = v.videoHeight || 1280;
  const scale = Math.min(1, Math.min(MAX_W / rawW, MAX_H / rawH));
  let width = Math.round(rawW * scale);
  let height = Math.round(rawH * scale);
  if (width % 2 !== 0) width -= 1;
  if (height % 2 !== 0) height -= 1;

  const duration = v.duration && isFinite(v.duration) ? v.duration : 15;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  // Pre-generate watermark badge ONCE into an offscreen canvas for instant blitting on every frame
  const watermarkBadge = createKlipWatermarkBadge(width, height, creatorHandle);

  // Record at smooth 30 FPS for fast encoding & optimal performance
  const canvasStream = canvas.captureStream(30);
  let audioCtx = null;
  let combinedStream = canvasStream;

  // Capture audio track into recorded stream
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => { });
      }
      const source = audioCtx.createMediaElementSource(v);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      // Do NOT connect to audioCtx.destination so user doesn't hear double audio during background record!
      const track = dest.stream.getAudioTracks()[0];
      if (track) {
        combinedStream.addTrack(track);
      }
    }
  } catch (err) {
    console.warn("Audio capture bypassed:", err);
  }

  const candidateTypes = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType = candidateTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";
  // Balanced 2.5 Mbps bitrate for fast encoding and lightweight downloads
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2500000,
  });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const recordingPromise = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const outBlob = new Blob(chunks, { type: mimeType });
        resolve({ blob: outBlob, mimeType });
      } catch (e) {
        reject(e);
      }
    };
    recorder.onerror = (e) => reject(e?.error || new Error("Recorder error"));
  });

  v.currentTime = 0;
  v.playbackRate = 1.0;

  // Wait for the video to decode and start playing before beginning recording
  await new Promise((resolve) => {
    let resolved = false;
    const onStart = () => {
      if (resolved) return;
      resolved = true;
      v.removeEventListener("playing", onStart);
      v.removeEventListener("timeupdate", onStart);
      resolve();
    };
    v.addEventListener("playing", onStart);
    v.addEventListener("timeupdate", onStart);
    v.play().catch(() => { });
    setTimeout(onStart, 1200); // Safety fallback
  });

  recorder.start(100);

  let isCancelled = false;
  let animId = null;

  return new Promise((resolve, reject) => {
    const renderLoop = () => {
      if (isCancelled) return;
      try {
        ctx.drawImage(v, 0, 0, width, height);
        if (watermarkBadge) {
          ctx.drawImage(watermarkBadge.canvas, watermarkBadge.x, watermarkBadge.y);
        }

        const progressPercent = Math.min(99, Math.round((v.currentTime / duration) * 100));
        onProgress?.(progressPercent);

        if (v.currentTime >= duration - 0.1 || v.ended) {
          v.pause();
          if (recorder.state === "recording") {
            recorder.stop();
          }
          return;
        }
        animId = requestAnimationFrame(renderLoop);
      } catch (err) {
        isCancelled = true;
        reject(err);
      }
    };

    v.onended = () => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    };

    recordingPromise
      .then((res) => {
        isCancelled = true;
        if (animId) cancelAnimationFrame(animId);
        if (audioCtx) audioCtx.close().catch(() => { });
        resolve(res);
      })
      .catch((err) => {
        isCancelled = true;
        if (animId) cancelAnimationFrame(animId);
        if (audioCtx) audioCtx.close().catch(() => { });
        reject(err);
      });

    renderLoop();
  });
}

async function triggerKlipDownloadAsync(klip) {
  if (!klip || isDownloadingMedia) return;
  isDownloadingMedia = true;

  const progressEl = document.getElementById("shareDownloadProgress");
  const statusText = document.getElementById("shareDownloadStatusText");
  const downloadBtn = document.getElementById("shareDownloadBtn");

  if (progressEl) progressEl.style.display = "flex";
  if (downloadBtn) downloadBtn.disabled = true;

  try {
    const rawUrl = klip.isVideoPost ? klip.VideoUrl : klip.firstPhotoUrl;
    if (!rawUrl) {
      showToast("Download URL not found");
      return;
    }

    const cleanHandle = String(klip.CreatorHandle || "klip").replace(/[^a-zA-Z0-9_]/g, "");

    // 1. Photo Posts: Watermark the photo with Klip branding & creator handle
    if (klip.isPhotoPost) {
      if (statusText) statusText.textContent = "Downloading...";
      const watermarkedBlob = await renderWatermarkedPhotoBlobAsync(rawUrl, klip.CreatorHandle);
      const filename = `klip_${cleanHandle}_${klip.Id || Date.now()}.jpg`;
      const objectUrl = URL.createObjectURL(watermarkedBlob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

      showToast("Downloaded!");
      setTimeout(() => closeShareModal(), 800);
      return;
    }

    // 2. Video Posts: Download the pre-rendered watermarked video immediately if available!
    const effectiveVideoUrl = klip.WatermarkedVideoUrl || rawUrl;

    // If a pre-watermarked copy already exists in Storage, download it instantly without rendering!
    if (klip.WatermarkedVideoUrl) {
      if (statusText) statusText.textContent = "Downloading...";
      const ext = klip.WatermarkedVideoUrl.includes(".webm") ? "webm" : "mp4";
      const filename = `klip_${cleanHandle}_${klip.Id || Date.now()}.${ext}`;

      if (effectiveVideoUrl.startsWith("/api/media/")) {
        const downloadEndpoint = effectiveVideoUrl.replace(
          "/api/media/",
          "/api/media/download/"
        ) + `?filename=${encodeURIComponent(filename)}`;

        try {
          const res = await fetch(downloadEndpoint);
          if (res.ok) {
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

            showToast("Downloaded!");
            setTimeout(() => closeShareModal(), 800);
            return;
          }
        } catch {
          // fallback
        }
      }
    }

    // For videos without pre-rendered watermark (e.g. uploaded previously), render watermark client-side
    if (statusText) statusText.textContent = "Processing watermark (0%)...";

    let watermarkedResult = null;
    try {
      watermarkedResult = await renderWatermarkedVideoBlobAsync(
        rawUrl,
        klip.CreatorHandle,
        (percent) => {
          if (statusText) statusText.textContent = `Adding watermark (${percent}%)...`;
        }
      );
    } catch (wmErr) {
      console.warn("Client video watermarking failed, falling back to original:", wmErr);
    }

    if (watermarkedResult && watermarkedResult.blob && watermarkedResult.blob.size > 1024) {
      if (statusText) statusText.textContent = "Saving video...";
      const ext = watermarkedResult.mimeType.includes("mp4") ? "mp4" : "webm";
      const filename = `klip_${cleanHandle}_${klip.Id || Date.now()}.${ext}`;
      const objectUrl = URL.createObjectURL(watermarkedResult.blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

      showToast("Downloaded with watermark!");
      setTimeout(() => closeShareModal(), 800);
      return;
    }

    // Fallback: Download the original high-fidelity video directly if browser doesn't support captureStream/MediaRecorder
    if (statusText) statusText.textContent = "Downloading...";
    const filename = `klip_${cleanHandle}_${klip.Id || Date.now()}.mp4`;

    // Local /api/media/ stream -> use server download attachment endpoint
    if (rawUrl.startsWith("/api/media/")) {
      const downloadEndpoint = rawUrl.replace(
        "/api/media/",
        "/api/media/download/"
      ) + `?filename=${encodeURIComponent(filename)}`;

      // Fetch blob to trigger a clean file save without opening a new tab
      try {
        const res = await fetch(downloadEndpoint);
        if (res.ok) {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

          showToast("Downloaded!");
          setTimeout(() => closeShareModal(), 800);
          return;
        }
      } catch (fetchErr) {
        console.warn("Direct blob download failed, falling back to anchor:", fetchErr);
      }

      const link = document.createElement("a");
      link.href = downloadEndpoint;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("Download started!");
      setTimeout(() => closeShareModal(), 800);
      return;
    }

    // Direct Firebase / external URL
    try {
      const response = await fetch(rawUrl, { mode: "cors" });
      if (response.ok) {
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        showToast("Downloaded!");
        setTimeout(() => closeShareModal(), 800);
        return;
      }
    } catch {
      // CORS fallback
    }

    // Direct browser anchor fallback
    const directLink = document.createElement("a");
    directLink.href = rawUrl;
    directLink.target = "_blank";
    directLink.rel = "noopener noreferrer";
    directLink.download = filename;
    document.body.appendChild(directLink);
    directLink.click();
    directLink.remove();

    showToast("Download started!");
    setTimeout(() => closeShareModal(), 800);
  } catch (err) {
    console.error("Download error:", err);
    const targetUrl = klip.VideoUrl || klip.firstPhotoUrl;
    if (targetUrl) {
      window.open(targetUrl, "_blank");
      showToast("Opened video in new tab");
    } else {
      showToast("Could not download video.");
    }
  } finally {
    isDownloadingMedia = false;
    if (progressEl) progressEl.style.display = "none";
    if (downloadBtn) downloadBtn.disabled = false;
  }
}

// ==================== DELETE KLIP CONTROLLER ====================
let pendingDeleteKlip = null;

function openDeleteConfirm(klip) {
  if (!isOwnKlip(klip)) {
    showToast("You can only delete your own Klips.");
    return;
  }
  pendingDeleteKlip = klip;

  const dialog = document.getElementById("deleteConfirmDialog");
  const text = document.getElementById("deleteConfirmText");
  const errorEl = document.getElementById("deleteConfirmError");
  const confirmBtn = document.getElementById("deleteConfirmBtn");

  const kind = klip.isPhotoPost ? "photo slideshow" : "video";
  text.textContent = `This will permanently remove this ${kind} from Klip for everyone. This can't be undone.`;
  errorEl.style.display = "none";
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Delete";
  dialog.style.display = "flex";

  // Pause whatever is playing while the dialog is open
  document.querySelectorAll("video.klip-video-element").forEach((v) => {
    if (!v.paused) v.pause();
  });
}

function closeDeleteConfirm(resumePlayback = true) {
  document.getElementById("deleteConfirmDialog").style.display = "none";
  pendingDeleteKlip = null;
  if (resumePlayback) {
    const page = getActivePageId();
    if (page === "MainPage") activateCurrentFeedVideo();
    else if (page === "VideoDetailPage") activateCurrentDetailVideo();
  }
}

async function confirmDeletePendingKlip() {
  const klip = pendingDeleteKlip;
  if (!klip) return;

  const confirmBtn = document.getElementById("deleteConfirmBtn");
  const cancelBtn = document.getElementById("deleteCancelBtn");
  const errorEl = document.getElementById("deleteConfirmError");

  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  confirmBtn.textContent = "Deleting...";
  errorEl.style.display = "none";

  const { success, error } = await FirebaseService.deleteKlipAsync(klip);

  confirmBtn.disabled = false;
  cancelBtn.disabled = false;
  confirmBtn.textContent = "Delete";

  if (!success) {
    errorEl.textContent = error || "Could not delete Klip.";
    errorEl.style.display = "block";
    return;
  }

  closeDeleteConfirm(false);
  await removeKlipFromAllViews(klip.Id);
  showToast("Klip deleted");
}

async function removeKlipFromAllViews(klipId) {
  const notMatch = (k) => k.Id !== klipId;
  state.feedItems = state.feedItems.filter(notMatch);
  state.followingItems = state.followingItems.filter(notMatch);
  state.detailPlaylist = state.detailPlaylist.filter(notMatch);
  state.profileDisplayedKlips = state.profileDisplayedKlips.filter(notMatch);
  state.creatorKlips = state.creatorKlips.filter(notMatch);
  state.searchAllKlips = state.searchAllKlips.filter(notMatch);
  state.searchFilteredKlips = state.searchFilteredKlips.filter(notMatch);

  // Remove any rendered slides (stop their video first)
  document
    .querySelectorAll(`.feed-slide[data-klip-id="${CSS.escape(klipId)}"]`)
    .forEach((slide) => {
      const v = slide.querySelector("video.klip-video-element");
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      slide.remove();
    });

  updateMainEmptyState();

  // Re-render grids from the updated cache
  const cached = FirebaseService.getCachedKlipsSnapshot();
  if (FirebaseService.isLoggedIn) {
    bindProfileKlipsGrid(cached);
  }
  if (state.creatorUid) {
    bindCreatorKlips(cached);
  }
  applySearchFilter(document.getElementById("searchEntry")?.value || "");

  const page = getActivePageId();
  if (page === "VideoDetailPage") {
    if (state.detailPlaylist.length === 0) {
      await popSubpage();
    } else {
      activateCurrentDetailVideo();
    }
  } else if (page === "MainPage") {
    activateCurrentFeedVideo();
  } else if (page === "ProfilePage") {
    const u = FirebaseService.currentUser;
    if (u) bindProfileUI(u);
  }
}

// ==================== INITIALIZATION & EVENT BINDINGS ====================
function setupEventListeners() {
  // Bottom TabBar
  document.querySelectorAll(".tabbar-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchRootTab(tab);
    });
  });

  // Desktop Sidebar Navigation
  document.querySelectorAll(".sidebar-nav-btn[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-nav");
      if (
        target === "MainPage" ||
        target === "SearchPage" ||
        target === "CreatePage" ||
        target === "InboxPage" ||
        target === "ProfilePage"
      ) {
        if (target === "InboxPage" && !FirebaseService.isLoggedIn) {
          showToast("Sign in to view your Inbox");
          switchRootTab("ProfilePage");
          return;
        }
        switchRootTab(target);
      }
    });
  });

  document.getElementById("sidebarBrandBtn")?.addEventListener("click", () => {
    switchRootTab("MainPage");
  });

  document.getElementById("sidebarUserCard")?.addEventListener("click", () => {
    switchRootTab("ProfilePage");
  });

  // Wide Web Mode Toggle
  document.getElementById("toggleWideWebBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("wide-web-mode");
    const isWide = document.body.classList.contains("wide-web-mode");
    document.getElementById("toggleWideWebLabel").textContent = isWide
      ? "Switch to Phone View"
      : "Switch to Wide View";
  });

  // Subpage Back Buttons
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => popSubpage());
  });
  document
    .getElementById("detailBackBtn")
    ?.addEventListener("click", () => popSubpage());

  // Sound Mute/Unmute Toggle
  document.getElementById("soundToggleBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const currentlyMuted = Boolean(state.userMuted || state.autoMuted);
    setMutedState(!currentlyMuted, true);
  });

  // Home Top Navigation (Following | Female | For You | Search)
  document
    .getElementById("followingTabCell")
    ?.addEventListener("click", () => switchHomeFeedTab("Following"));
  document
    .getElementById("femaleTabCell")
    ?.addEventListener("click", () => switchHomeFeedTab("Female"));
  document
    .getElementById("forYouTabCell")
    ?.addEventListener("click", () => switchHomeFeedTab("ForYou"));
  document
    .getElementById("mainSearchBtn")
    ?.addEventListener("click", () => pushSubpage("SearchPage"));

  // Carousel Scroll Observers with immediate snap detection & quick debounce
  const bindFeedCarouselScroll = (carouselEl) => {
    if (!carouselEl) return;
    let scrollTimer = null;
    let lastSnapIdx = -1;
    let cachedH = 0;

    const updateH = () => {
      cachedH = carouselEl.clientHeight || 1;
    };
    updateH();
    window.addEventListener("resize", updateH, { passive: true });

    carouselEl.addEventListener(
      "scroll",
      () => {
        const h = cachedH || carouselEl.clientHeight || 1;
        const currentIdx = Math.round(carouselEl.scrollTop / h);
        if (currentIdx !== lastSnapIdx && Math.abs(carouselEl.scrollTop - currentIdx * h) < 6) {
          lastSnapIdx = currentIdx;
          if (scrollTimer) clearTimeout(scrollTimer);
          activateCurrentFeedVideo();
          return;
        }
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          lastSnapIdx = currentIdx;
          activateCurrentFeedVideo();
        }, 40);
      },
      { passive: true }
    );
  };

  bindFeedCarouselScroll(document.getElementById("feedCarousel"));
  bindFeedCarouselScroll(document.getElementById("followingCarousel"));
  bindFeedCarouselScroll(document.getElementById("femaleCarousel"));

  // Detail feed carousel (profile / search / notification video playback)
  const detailCarousel = document.getElementById("detailFeedCarousel");
  if (detailCarousel) {
    let detailScrollTimer = null;
    let lastDetailSnapIdx = -1;
    let cachedDetailH = 0;

    const updateDetailH = () => {
      cachedDetailH = detailCarousel.clientHeight || 1;
    };
    updateDetailH();
    window.addEventListener("resize", updateDetailH, { passive: true });

    detailCarousel.addEventListener(
      "scroll",
      () => {
        const h = cachedDetailH || detailCarousel.clientHeight || 1;
        const currentIdx = Math.round(detailCarousel.scrollTop / h);
        if (currentIdx !== lastDetailSnapIdx && Math.abs(detailCarousel.scrollTop - currentIdx * h) < 6) {
          lastDetailSnapIdx = currentIdx;
          if (detailScrollTimer) clearTimeout(detailScrollTimer);
          activateCurrentDetailVideo();
          return;
        }
        if (detailScrollTimer) clearTimeout(detailScrollTimer);
        detailScrollTimer = setTimeout(() => {
          lastDetailSnapIdx = currentIdx;
          activateCurrentDetailVideo();
        }, 40);
      },
      { passive: true }
    );
  }

  // Desktop Feed Prev/Next Arrows & Keyboard Shortcuts
  const scrollActiveCarousel = (delta) => {
    const activePage = getActivePageId();
    let carousel = null;
    if (activePage === "MainPage") {
      if (state.activeFeedTab === "Following") {
        carousel = document.getElementById("followingCarousel");
      } else if (state.activeFeedTab === "Female") {
        carousel = document.getElementById("femaleCarousel");
      } else {
        carousel = document.getElementById("feedCarousel");
      }
    } else if (activePage === "VideoDetailPage") {
      carousel = document.getElementById("detailFeedCarousel");
    }
    if (!carousel) return;
    const h = carousel.clientHeight || 1;
    const currentIdx = Math.round(carousel.scrollTop / h);
    carousel.scrollTo({
      top: Math.max(0, currentIdx + delta) * h,
      behavior: "smooth",
    });
  };

  document
    .getElementById("scrollPrevKlipBtn")
    ?.addEventListener("click", () => scrollActiveCarousel(-1));
  document
    .getElementById("scrollNextKlipBtn")
    ?.addEventListener("click", () => scrollActiveCarousel(1));

  window.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollActiveCarousel(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollActiveCarousel(-1);
    } else if (e.key === " ") {
      const activePage = getActivePageId();
      if (activePage === "MainPage" || activePage === "VideoDetailPage") {
        e.preventDefault();
        let carousel = null;
        if (activePage === "VideoDetailPage") {
          carousel = document.getElementById("detailFeedCarousel");
        } else if (state.activeFeedTab === "Following") {
          carousel = document.getElementById("followingCarousel");
        } else if (state.activeFeedTab === "Female") {
          carousel = document.getElementById("femaleCarousel");
        } else {
          carousel = document.getElementById("feedCarousel");
        }
        const slide = getVisibleSlideInCarousel(carousel);
        slide?.click();
      }
    }
  });

  // ==================== CREATE PAGE EVENTS ====================
  document
    .getElementById("refreshApprovalBtn")
    ?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `
        <div class="spinner-small" style="width: 14px; height: 14px; border-width: 2px;"></div>
        <span>Checking...</span>
      `;
      btn.disabled = true;
      await checkPostingPermissionAsync();
      const profile = FirebaseService.currentUser;
      if (profile && !profile.CanPost) {
        showToast("Account still awaiting creator approval.");
      }
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    });

  document
    .getElementById("videoModeTabBtn")
    ?.addEventListener("click", () => setCreatePostMode(false));
  document
    .getElementById("photoModeTabBtn")
    ?.addEventListener("click", () => setCreatePostMode(true));

  const videoInput = document.getElementById("videoFileInput");
  const photoInput = document.getElementById("photoFilesInput");

  document
    .getElementById("emptyVideoPromptView")
    ?.addEventListener("click", () => videoInput?.click());
  document
    .getElementById("changeVideoBtn")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      videoInput?.click();
    });

  videoInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleVideoFilePicked(file);
  });

  document
    .getElementById("previewVideoPlayer")
    ?.addEventListener("click", (e) => {
      const vid = e.currentTarget;
      const overlay = document.getElementById("previewPausedOverlay");
      if (vid.paused) {
        vid.play().catch(() => { });
        overlay.style.display = "none";
      } else {
        vid.pause();
        overlay.style.display = "flex";
      }
    });

  document
    .getElementById("emptyPhotoPromptView")
    ?.addEventListener("click", () => photoInput?.click());
  document
    .getElementById("addMorePhotosBtn")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      photoInput?.click();
    });

  photoInput?.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      handlePhotoFilesPicked(e.target.files);
    }
  });

  document
    .getElementById("previewPhotoCarousel")
    ?.addEventListener("scroll", (e) => {
      const track = e.currentTarget;
      const w = track.clientWidth || 1;
      const total = state.previewPhotoUrls.length;
      if (total <= 0) return;
      const idx = Math.min(Math.max(Math.round(track.scrollLeft / w), 0), total - 1);
      state.previewPhotoIndex = idx;
      document.getElementById("photoCountSummaryLabel").textContent =
        `${idx + 1}/${total}`;
      document
        .querySelectorAll("#previewPhotoIndicator .photo-dot")
        .forEach((d, i) => d.classList.toggle("active", i === idx));
    });

  document
    .getElementById("removeCurrentPhotoBtn")
    ?.addEventListener("click", () => {
      if (state.previewPhotoUrls.length === 0) return;
      const idx = Math.min(
        Math.max(state.previewPhotoIndex, 0),
        state.previewPhotoUrls.length - 1
      );
      URL.revokeObjectURL(state.previewPhotoUrls[idx]);
      state.previewPhotoUrls.splice(idx, 1);
      state.selectedPhotoFiles.splice(idx, 1);
      updatePhotoStageUI();
    });

  document
    .getElementById("clearMediaBtn")
    ?.addEventListener("click", () => resetUploadForm());

  const captionEditor = document.getElementById("captionEditor");
  captionEditor?.addEventListener("input", () => {
    document.getElementById("captionCountLabel").textContent =
      `${captionEditor.value.length} / 150`;
  });

  document.querySelectorAll(".hashtag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.getAttribute("data-tag");
      if (!tag || !captionEditor) return;
      const current = captionEditor.value || "";
      if (current.toLowerCase().includes(tag.toLowerCase())) return;
      const next = !current.trim()
        ? `${tag} `
        : `${current.trimEnd()} ${tag} `;
      if (next.length <= 150) {
        captionEditor.value = next;
        document.getElementById("captionCountLabel").textContent =
          `${next.length} / 150`;
      }
    });
  });

  document
    .getElementById("postKlipBtn")
    ?.addEventListener("click", async () => {
      const caption = (document.getElementById("captionEditor")?.value || "").trim();

      if (state.isPhotoMode) {
        if (!state.selectedPhotoFiles || state.selectedPhotoFiles.length === 0) {
          showToast("Please select at least 1 photo first.");
          return;
        }

        const customAudioName = (document.getElementById("postAudioNameInput")?.value || "").trim();
        const job = {
          isPhotoMode: true,
          photoFiles: [...state.selectedPhotoFiles],
          caption,
          customAudioName,
          selectedSound: state.selectedSound ? { ...state.selectedSound } : null,
        };

        resetUploadForm();
        await switchRootTab("MainPage");
        activateCurrentFeedVideo();
        showToast("Uploading (0%)...");
        startBackgroundKlipUpload(job);
        return;
      }

      if (!state.selectedVideoFile) {
        showToast("Please select a video first.");
        return;
      }

      const customAudioName = (document.getElementById("postAudioNameInput")?.value || "").trim();
      const job = {
        isPhotoMode: false,
        videoFile: state.selectedVideoFile,
        caption,
        customAudioName,
        selectedSound: state.selectedSound ? { ...state.selectedSound } : null,
      };

      resetUploadForm();
      await switchRootTab("MainPage");
      activateCurrentFeedVideo();
      showToast("Uploading (0%)...");
      startBackgroundKlipUpload(job);
    });

  // ==================== PROFILE & AUTH EVENTS ====================
  const updateAuthModeUI = () => {
    const errorLabel = document.getElementById("authErrorLabel");
    if (errorLabel) errorLabel.style.display = "none";
    const spinner = document.getElementById("authLoadingSpinner");
    if (spinner) spinner.style.display = "none";
    const submitBtn = document.getElementById("authSubmitBtn");
    if (submitBtn) submitBtn.disabled = false;

    const fieldsContainer = document.getElementById("signUpFieldsContainer");
    if (fieldsContainer) {
      fieldsContainer.style.display = state.isSignUpMode ? "flex" : "none";
    }

    const signUpBtn = document.getElementById("signUpSegmentBtn");
    if (signUpBtn) {
      signUpBtn.className = state.isSignUpMode
        ? "segment-btn active-blue"
        : "segment-btn";
    }

    const logInBtn = document.getElementById("logInSegmentBtn");
    if (logInBtn) {
      logInBtn.className = !state.isSignUpMode
        ? "segment-btn active-blue"
        : "segment-btn";
    }

    const subtitleLabel = document.getElementById("authSubtitleLabel");
    if (subtitleLabel) {
      subtitleLabel.textContent = state.isSignUpMode
        ? "Join the community to follow creators & save Klips"
        : "Welcome back! Sign in to your Klip account";
    }

    if (submitBtn) {
      submitBtn.textContent = state.isSignUpMode
        ? "Create Account"
        : "Log In";
    }

    const toggleFooter = document.getElementById("authToggleFooter");
    if (toggleFooter) {
      toggleFooter.innerHTML = state.isSignUpMode
        ? `Already have an account? <span style="color: var(--accent-blue); font-weight: 600; text-decoration: underline;">Log In</span>`
        : `Don't have an account? <span style="color: var(--accent-blue); font-weight: 600; text-decoration: underline;">Sign Up</span>`;
    }
  };
  window.__updateAuthModeUI = updateAuthModeUI;

  const setAuthMode = (isSignUp) => {
    state.isSignUpMode = Boolean(isSignUp);
    updateAuthModeUI();
  };

  // Live username sanitize & enforcement: English letters, numbers, and underscore (_) only
  const sanitizeHandleInput = (inputEl) => {
    if (!inputEl) return;
    inputEl.addEventListener("input", () => {
      let val = inputEl.value;
      const startsWithAt = val.startsWith("@");
      let core = startsWithAt ? val.slice(1) : val;
      // Strip any whitespace or non-English/non-digit/non-underscore characters
      core = core.replace(/[^a-zA-Z0-9_]/g, "");
      inputEl.value = startsWithAt ? `@${core}` : core;
    });
  };
  sanitizeHandleInput(document.getElementById("authHandleInput"));
  sanitizeHandleInput(document.getElementById("editHandleEntry"));

  document
    .getElementById("signUpSegmentBtn")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAuthMode(true);
    });

  document
    .getElementById("logInSegmentBtn")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAuthMode(false);
    });

  document
    .getElementById("authToggleFooter")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAuthMode(!state.isSignUpMode);
    });

  document.getElementById("maleGenderBtn")?.addEventListener("click", () => {
    state.selectedGender = "Male";
    document.getElementById("maleGenderBtn").classList.add("selected");
    document.getElementById("femaleGenderBtn").classList.remove("selected");
  });
  document.getElementById("femaleGenderBtn")?.addEventListener("click", () => {
    state.selectedGender = "Female";
    document.getElementById("femaleGenderBtn").classList.add("selected");
    document.getElementById("maleGenderBtn").classList.remove("selected");
  });

  document
    .getElementById("authForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorLabel = document.getElementById("authErrorLabel");
      const spinner = document.getElementById("authLoadingSpinner");
      const submitBtn = document.getElementById("authSubmitBtn");

      errorLabel.style.display = "none";

      const email = document.getElementById("authEmailInput").value.trim();
      const password = document.getElementById("authPasswordInput").value;
      const handle = document.getElementById("authHandleInput").value.trim();
      const displayName = document
        .getElementById("authDisplayNameInput")
        .value.trim();

      if (!email || !password) {
        errorLabel.textContent = "Please enter both email and password.";
        errorLabel.style.display = "block";
        return;
      }

      if (state.isSignUpMode) {
        const handleCheck = validateHandle(handle);
        if (!handleCheck.valid) {
          errorLabel.textContent = handleCheck.error;
          errorLabel.style.display = "block";
          return;
        }
      }

      spinner.style.display = "block";
      submitBtn.disabled = true;

      const { success, error } = state.isSignUpMode
        ? await FirebaseService.signUpAsync(
          email,
          password,
          handle,
          displayName,
          state.selectedGender
        )
        : await FirebaseService.signInAsync(email, password);

      spinner.style.display = "none";
      submitBtn.disabled = false;

      if (!success) {
        errorLabel.textContent = error || "Authentication failed.";
        errorLabel.style.display = "block";
        return;
      }

      document.getElementById("authPasswordInput").value = "";
      await refreshProfileViewAsync();
      refreshInboxBadgeCountAsync();
    if (FirebaseService.currentUser && FirebaseService.currentUser.AvatarUrl) {
      propagateAvatarUpdate(FirebaseService.currentUser.AvatarUrl);
    }
    });

  document.getElementById("myKlipsTabCol")?.addEventListener("click", () => {
    if (!state.showingSaved) return;
    state.showingSaved = false;
    document.getElementById("myKlipsTabCol").classList.add("active");
    document.getElementById("savedKlipsTabCol").classList.remove("active");
    bindProfileKlipsGrid(FirebaseService.getCachedKlipsSnapshot());
  });

  document.getElementById("savedKlipsTabCol")?.addEventListener("click", () => {
    if (state.showingSaved) return;
    state.showingSaved = true;
    document.getElementById("savedKlipsTabCol").classList.add("active");
    document.getElementById("myKlipsTabCol").classList.remove("active");
    bindProfileKlipsGrid(FirebaseService.getCachedKlipsSnapshot());
  });

  document
    .getElementById("profileFollowingStat")
    ?.addEventListener("click", () => {
      if (!FirebaseService.currentUid) return;
      pushSubpage("FollowListPage", {
        uid: FirebaseService.currentUid,
        mode: "following",
      });
    });

  document
    .getElementById("profileFollowersStat")
    ?.addEventListener("click", () => {
      if (!FirebaseService.currentUid) return;
      pushSubpage("FollowListPage", {
        uid: FirebaseService.currentUid,
        mode: "followers",
      });
    });

  document
    .getElementById("openEditProfileBtn")
    ?.addEventListener("click", () => pushSubpage("EditProfilePage"));

  document
    .getElementById("shareOwnProfileBtn")
    ?.addEventListener("click", async () => {
      const uid = FirebaseService.currentUid || "";
      const url = `${window.location.origin}${window.location.pathname}?creator=${encodeURIComponent(uid)}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast("Profile link copied to clipboard!");
      } catch {
        showToast(url);
      }
    });

  document
    .getElementById("profileInboxBtn")
    ?.addEventListener("click", () => pushSubpage("InboxPage"));

  document
    .getElementById("profileLogoutBtn")
    ?.addEventListener("click", async () => {
      FirebaseService.signOut();
      updateInboxBadgeUI(0);
      await refreshProfileViewAsync();
    });

  // ==================== CREATOR PROFILE EVENTS ====================
  document
    .getElementById("creatorFollowActionBtn")
    ?.addEventListener("click", async () => {
      if (!FirebaseService.isLoggedIn) {
        showToast("Sign in on the Profile tab to follow creators");
        switchRootTab("ProfilePage");
        return;
      }
      if (!state.creatorUid) return;

      const followersEl = document.getElementById("creatorFollowersCount");
      const currentCount = parseInt(followersEl.textContent || "0", 10) || 0;

      if (state.creatorIsFollowing) {
        state.creatorIsFollowing = false;
        updateCreatorFollowBtnUI();
        followersEl.textContent = String(Math.max(0, currentCount - 1));
        await FirebaseService.unfollowCreatorAsync(state.creatorUid);
      } else {
        state.creatorIsFollowing = true;
        updateCreatorFollowBtnUI();
        followersEl.textContent = String(currentCount + 1);
        await FirebaseService.followCreatorAsync(state.creatorUid);
      }
    });

  document
    .getElementById("creatorFollowingStat")
    ?.addEventListener("click", () => {
      if (!state.creatorUid) return;
      pushSubpage("FollowListPage", {
        uid: state.creatorUid,
        mode: "following",
      });
    });

  document
    .getElementById("creatorFollowersStat")
    ?.addEventListener("click", () => {
      if (!state.creatorUid) return;
      pushSubpage("FollowListPage", {
        uid: state.creatorUid,
        mode: "followers",
      });
    });

  // ==================== EDIT PROFILE & CROPPER EVENTS ====================
  document
    .getElementById("editProfileBackBtn")
    ?.addEventListener("click", () => {
      const modal = document.getElementById("cropModalOverlay");
      if (modal && modal.style.display !== "none") {
        closeCropModal();
        return;
      }
      popSubpage();
    });

  const avatarInput = document.getElementById("avatarFileInput");
  document.getElementById("changePhotoBtn")?.addEventListener("click", () => {
    if (!FirebaseService.currentUser || !FirebaseService.currentUser.isMale)
      return;
    avatarInput?.click();
  });

  avatarInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusLabel = document.getElementById("editStatusLabel");
    statusLabel.style.display = "none";

    const ok = await preparePhotoForCropping(file);
    if (!ok) {
      statusLabel.style.color = "#FF2D55";
      statusLabel.textContent = "Could not load selected photo.";
      statusLabel.style.display = "block";
      return;
    }

    document.getElementById("cropModalOverlay").style.display = "flex";
  });

  // Crop Pan (Pointer Drag) & Wheel Zoom
  const cropTouchArea = document.getElementById("cropTouchArea");
  let isDraggingCrop = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartOffsetX = 0;
  let panStartOffsetY = 0;

  cropTouchArea?.addEventListener("pointerdown", (e) => {
    isDraggingCrop = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartOffsetX = state.cropOffsetX;
    panStartOffsetY = state.cropOffsetY;
    cropTouchArea.setPointerCapture(e.pointerId);
  });

  cropTouchArea?.addEventListener("pointermove", (e) => {
    if (!isDraggingCrop) return;
    state.cropOffsetX = panStartOffsetX + (e.clientX - dragStartX);
    state.cropOffsetY = panStartOffsetY + (e.clientY - dragStartY);
    applyCropTransform();
  });

  const endCropDrag = () => {
    isDraggingCrop = false;
  };
  cropTouchArea?.addEventListener("pointerup", endCropDrag);
  cropTouchArea?.addEventListener("pointercancel", endCropDrag);

  cropTouchArea?.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      state.cropScale = Math.min(Math.max(state.cropScale + delta, 1.0), 3.5);
      document.getElementById("cropZoomSlider").value = String(state.cropScale);
      document.getElementById("cropZoomValueLabel").textContent =
        `${state.cropScale.toFixed(1)}x`;
      applyCropTransform();
    },
    { passive: false }
  );

  document
    .getElementById("cropZoomSlider")
    ?.addEventListener("input", (e) => {
      state.cropScale = Math.min(
        Math.max(parseFloat(e.target.value) || 1.0, 1.0),
        3.5
      );
      document.getElementById("cropZoomValueLabel").textContent =
        `${state.cropScale.toFixed(1)}x`;
      applyCropTransform();
    });

  document
    .getElementById("rotateCropBtn")
    ?.addEventListener("click", () => rotateCropCanvas90());
  document
    .getElementById("resetCropBtn")
    ?.addEventListener("click", () => resetCropTransform());
  document
    .getElementById("cancelCropBtn")
    ?.addEventListener("click", () => closeCropModal());

  document
    .getElementById("confirmCropBtn")
    ?.addEventListener("click", async () => {
      const confirmBtn = document.getElementById("confirmCropBtn");
      const cancelBtn = document.getElementById("cancelCropBtn");
      const changeBtn = document.getElementById("changePhotoBtn");
      const statusLabel = document.getElementById("editStatusLabel");

      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = "Uploading...";

      try {
        const blob = await renderCroppedAvatarBlobAsync();
        if (!blob) {
          statusLabel.style.color = "#FF2D55";
          statusLabel.textContent = "Failed to process cropped photo.";
          statusLabel.style.display = "block";
          return;
        }

        closeCropModal();
        changeBtn.disabled = true;
        changeBtn.textContent = "Uploading photo...";
        statusLabel.style.display = "none";

        const { success, avatarUrl, error } =
          await FirebaseService.uploadAvatarBytesAsync(blob);

        changeBtn.disabled = false;
        changeBtn.textContent = "Change Profile Picture";

        if (success && avatarUrl) {
          propagateAvatarUpdate(avatarUrl);
          statusLabel.style.color = "#38BDF8";
          statusLabel.textContent = "Profile picture updated!";
          statusLabel.style.display = "block";
        } else {
          statusLabel.style.color = "#FF2D55";
          statusLabel.textContent = error || "Failed to upload photo.";
          statusLabel.style.display = "block";
        }
      } finally {
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.textContent = "Use Photo";
      }
    });

  document
    .getElementById("saveProfileBtn")
    ?.addEventListener("click", async () => {
      if (!FirebaseService.currentUser) return;
      const rawHandle = document.getElementById("editHandleEntry").value.trim();
      const statusLabel = document.getElementById("editStatusLabel");

      const handleCheck = validateHandle(rawHandle);
      if (!handleCheck.valid) {
        statusLabel.style.color = "#FF2D55";
        statusLabel.textContent = handleCheck.error;
        statusLabel.style.display = "block";
        return;
      }

      const cleanHandle = handleCheck.handle;
      const rawName = document
        .getElementById("editDisplayNameEntry")
        .value.trim();
      const cleanName = rawName || cleanHandle.replace(/^@/, "");

      FirebaseService.currentUser.Handle = cleanHandle;
      FirebaseService.currentUser.DisplayName = cleanName;
      FirebaseService.currentUser.Initials = getInitials(cleanName);

      const bioText = document.getElementById("editBioEditor").value.trim();
      FirebaseService.currentUser.Bio = FirebaseService.currentUser.CanPost
        ? bioText || DEFAULT_BIO
        : DEFAULT_BIO;

      const saveBtn = document.getElementById("saveProfileBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      await FirebaseService.saveUserProfileAsync(FirebaseService.currentUser);

      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      updateSidebarUserCard();
      await popSubpage();
    });

  // ==================== SEARCH PAGE EVENTS ====================
  const searchEntry = document.getElementById("searchEntry");
  const searchClearBtn = document.getElementById("searchClearBtn");
  let searchDebounceTimer = null;

  searchEntry?.addEventListener("input", () => {
    const val = searchEntry.value;
    searchClearBtn.style.display = val ? "block" : "none";
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (val && val.trim()) {
        RecommendationService.recordSearch(val.trim());
      }
      applySearchFilter(val);
    }, 180);
  });

  searchClearBtn?.addEventListener("click", () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchEntry.value = "";
    searchClearBtn.style.display = "none";
    applySearchFilter("");
    searchEntry.focus();
  });

  document
    .getElementById("searchTabAll")
    ?.addEventListener("click", () => setSearchActiveTab("All"));
  document
    .getElementById("searchTabAccounts")
    ?.addEventListener("click", () => setSearchActiveTab("Accounts"));
  document
    .getElementById("searchTabKlips")
    ?.addEventListener("click", () => setSearchActiveTab("Klips"));

  // Subscribe to Firebase service updates
  FirebaseService.onAuthStateChanged(() => {
    updateSidebarUserCard();
    syncNavigationUI();
    // Refresh owner-only delete buttons on rendered slides
    [...state.feedItems, ...state.followingItems, ...state.detailPlaylist].forEach(
      (k) => syncVideoAcrossAllViews(k)
    );
  });

  // Comments Bottom Sheet bindings
  document.getElementById("closeCommentsModalBtn")?.addEventListener("click", () => closeCommentsModal());
  document.getElementById("commentModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "commentModalOverlay") closeCommentsModal();
  });
  document.getElementById("cancelCommentReplyBtn")?.addEventListener("click", () => clearReplyTarget());
  document.getElementById("commentSendBtn")?.addEventListener("click", () => handlePostComment());
  document.getElementById("commentInputEntry")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePostComment();
    }
  });

  // Sound Picker Modal & Header bindings
  document.getElementById("openSoundPickerBtn")?.addEventListener("click", () => openSoundPickerModal());
  document.getElementById("closeSoundPickerBtn")?.addEventListener("click", () => closeSoundPickerModal());
  document.getElementById("removeSelectedSoundBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearSelectedSound();
  });
  document.getElementById("openTrimmerModalBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openSoundTrimmerModal();
  });
  document.getElementById("closeSoundTrimmerModalBtn")?.addEventListener("click", () => {
    closeSoundTrimmerModal(true);
  });
  document.getElementById("cancelSoundTrimmerBtn")?.addEventListener("click", () => {
    closeSoundTrimmerModal(false);
  });
  document.getElementById("applySoundTrimmerBtn")?.addEventListener("click", () => {
    closeSoundTrimmerModal(true);
  });
  document.getElementById("soundTrimmerModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "soundTrimmerModalOverlay") {
      closeSoundTrimmerModal(true);
    }
  });
  document.getElementById("soundPickerModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "soundPickerModalOverlay") closeSoundPickerModal();
  });

  // Sound Picker Tabs
  document.getElementById("tabCommunitySoundsBtn")?.addEventListener("click", () => switchSoundPickerTab("community"));
  document.getElementById("tabUploadSoundBtn")?.addEventListener("click", () => switchSoundPickerTab("upload"));

  // Sound Search Input
  document.getElementById("soundSearchInput")?.addEventListener("input", (e) => {
    const q = e.target.value;
    renderCommunitySoundCatalog(q);
  });

  // Rename Sound Dialog bindings
  document.getElementById("renameSoundCancelBtn")?.addEventListener("click", () => closeRenameSoundDialog());
  document.getElementById("renameSoundDialog")?.addEventListener("click", (e) => {
    if (e.target.id === "renameSoundDialog") closeRenameSoundDialog();
  });
  document.getElementById("renameSoundTitleInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("renameSoundSaveBtn")?.click();
    }
  });
  document.getElementById("renameSoundSaveBtn")?.addEventListener("click", async () => {
    if (!pendingRenameKlip) return;
    const input = document.getElementById("renameSoundTitleInput");
    const newTitle = (input?.value || "").trim();
    const errorEl = document.getElementById("renameSoundError");

    if (!newTitle) {
      if (errorEl) {
        errorEl.textContent = "Please enter an audio title.";
        errorEl.style.display = "block";
      }
      return;
    }

    const saveBtn = document.getElementById("renameSoundSaveBtn");
    if (saveBtn) saveBtn.disabled = true;

    const { success, error } = await FirebaseService.renameSoundTitleAsync(pendingRenameKlip.Id, newTitle);
    if (saveBtn) saveBtn.disabled = false;

    if (!success) {
      if (errorEl) {
        errorEl.textContent = error || "Could not update audio title.";
        errorEl.style.display = "block";
      }
      return;
    }

    // Update locally and across UI
    pendingRenameKlip.SoundTitle = newTitle;
    const heroTitle = document.getElementById("soundHeroTitle");
    const navTitle = document.getElementById("soundDetailNavTitle");
    if (heroTitle) heroTitle.textContent = newTitle;
    if (navTitle) navTitle.textContent = newTitle;

    syncVideoAcrossAllViews(pendingRenameKlip);
    closeRenameSoundDialog();
    showToast(`Audio renamed to "${newTitle}"!`);
  });

  // Custom Audio Upload Picker inside Modal
  const audioFileInput = document.getElementById("customAudioFileInput");
  document.getElementById("pickAudioFileBtn")?.addEventListener("click", () => {
    audioFileInput?.click();
  });

  audioFileInput?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|m4a|wav|aac|ogg)$/i)) {
      showToast("Please choose a valid audio file (MP3, M4A, WAV).");
      return;
    }
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_AUDIO_BYTES) {
      showToast("Audio file exceeds 25 MB limit.");
      return;
    }

    customUploadedAudioFile = file;
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const dropzone = document.getElementById("soundUploadDropzone");
    if (dropzone) dropzone.style.display = "none";
    const previewCard = document.getElementById("soundUploadPreviewCard");
    if (previewCard) previewCard.style.display = "flex";
    const fnEl = document.getElementById("soundUploadFileName");
    if (fnEl) fnEl.textContent = file.name;
    const fsEl = document.getElementById("soundUploadFileSize");
    if (fsEl) fsEl.textContent = `${mb} MB`;

    const titleInput = document.getElementById("customSoundTitleInput");
    if (titleInput && !titleInput.value) {
      const dotIdx = file.name.lastIndexOf(".");
      titleInput.value = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
    }
  });

  document.getElementById("cancelAudioUploadBtn")?.addEventListener("click", () => {
    customUploadedAudioFile = null;
    if (audioFileInput) audioFileInput.value = "";
    const dropzone = document.getElementById("soundUploadDropzone");
    if (dropzone) dropzone.style.display = "flex";
    const previewCard = document.getElementById("soundUploadPreviewCard");
    if (previewCard) previewCard.style.display = "none";
  });

  document.getElementById("applyUploadedSoundBtn")?.addEventListener("click", () => {
    if (!customUploadedAudioFile) {
      showToast("Please select an audio file first.");
      return;
    }

    const titleInput = document.getElementById("customSoundTitleInput");
    const title = (titleInput?.value || "").trim() || customUploadedAudioFile.name;
    const localAudioUrl = URL.createObjectURL(customUploadedAudioFile);

    const tempAudio = new Audio(localAudioUrl);
    tempAudio.onloadedmetadata = () => {
      const dur = Math.round(tempAudio.duration) || 60;
      closeSoundPickerModal();
      applySoundToCreation({
        id: `sound_custom_${Date.now()}`,
        title: title,
        artist: FirebaseService.currentUser?.Handle || "@user",
        audioUrl: localAudioUrl,
        audioFile: customUploadedAudioFile,
        isCustomUpload: true,
        duration: dur,
      });
    };
    tempAudio.onerror = () => {
      closeSoundPickerModal();
      applySoundToCreation({
        id: `sound_custom_${Date.now()}`,
        title: title,
        artist: FirebaseService.currentUser?.Handle || "@user",
        audioUrl: localAudioUrl,
        audioFile: customUploadedAudioFile,
        isCustomUpload: true,
        duration: 60,
      });
    };
  });

  // ==================== Trimmer: Touch Handles, Steppers & Presets ====================
  const trackEl = document.getElementById("trimmerTrackContainer");
  const handleStart = document.getElementById("trimmerHandleStart");
  const handleEnd = document.getElementById("trimmerHandleEnd");

  let isDraggingStart = false;
  let isDraggingEnd = false;

  const getTimeFromPointer = (e) => {
    if (!trackEl || !state.selectedSound) return 0;
    const rect = trackEl.getBoundingClientRect();
    if (!rect.width) return 0;
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * maxDur * 10) / 10;
  };

  // Pointer & Touch Trimmer Dragging
  const onPointerDownStart = (e) => {
    if (!state.selectedSound) return;
    isDraggingStart = true;
    isDraggingEnd = false;
    e.stopPropagation();
  };

  const onPointerDownEnd = (e) => {
    if (!state.selectedSound) return;
    isDraggingEnd = true;
    isDraggingStart = false;
    e.stopPropagation();
  };

  handleStart?.addEventListener("pointerdown", onPointerDownStart);
  handleEnd?.addEventListener("pointerdown", onPointerDownEnd);
  handleStart?.addEventListener("touchstart", onPointerDownStart, { passive: true });
  handleEnd?.addEventListener("touchstart", onPointerDownEnd, { passive: true });

  const onGlobalMove = (e) => {
    if (!state.selectedSound || (!isDraggingStart && !isDraggingEnd)) return;
    const newTime = getTimeFromPointer(e);
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
    const minDur = Math.max(0.5, state.videoDuration || 0);

    if (isDraggingStart) {
      const currentEnd = state.selectedSound.endTime || 15;
      const maxStart = Math.max(0, currentEnd - minDur);
      state.selectedSound.startTime = Math.max(0, Math.min(maxStart, newTime));
      updateTrimmerConstraints();
    } else if (isDraggingEnd) {
      const currentStart = state.selectedSound.startTime || 0;
      const minEnd = Math.min(maxDur, currentStart + minDur);
      state.selectedSound.endTime = Math.min(maxDur, Math.max(minEnd, newTime));
      updateTrimmerConstraints();
    }

    if (e.cancelable && (e.type === "touchmove" || e.type === "pointermove")) {
      e.preventDefault();
    }
  };

  const onGlobalUp = () => {
    if (isDraggingStart || isDraggingEnd) {
      isDraggingStart = false;
      isDraggingEnd = false;
      updateTrimmerConstraints();
    }
  };

  window.addEventListener("pointermove", onGlobalMove, { passive: false });
  window.addEventListener("pointerup", onGlobalUp, { passive: true });
  window.addEventListener("pointercancel", onGlobalUp, { passive: true });

  window.addEventListener("touchmove", onGlobalMove, { passive: false });
  window.addEventListener("touchend", onGlobalUp, { passive: true });
  window.addEventListener("touchcancel", onGlobalUp, { passive: true });

  // Direct track tap to reposition nearest handle
  trackEl?.addEventListener("pointerdown", (e) => {
    if (!state.selectedSound) return;
    if (e.target === handleStart || e.target === handleEnd || handleStart?.contains(e.target) || handleEnd?.contains(e.target)) return;
    const clickedTime = getTimeFromPointer(e);
    const distToStart = Math.abs(clickedTime - (state.selectedSound.startTime || 0));
    const distToEnd = Math.abs(clickedTime - (state.selectedSound.endTime || 0));
    const minDur = Math.max(0.5, state.videoDuration || 0);
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));

    if (distToStart < distToEnd) {
      const maxStart = Math.max(0, (state.selectedSound.endTime || 15) - minDur);
      state.selectedSound.startTime = Math.max(0, Math.min(maxStart, clickedTime));
    } else {
      const minEnd = Math.min(maxDur, (state.selectedSound.startTime || 0) + minDur);
      state.selectedSound.endTime = Math.min(maxDur, Math.max(minEnd, clickedTime));
    }
    updateTrimmerConstraints();
  });

  // Precision Steppers (-1s / +1s)
  document.getElementById("trimmerStartMinusBtn")?.addEventListener("click", () => {
    if (!state.selectedSound) return;
    state.selectedSound.startTime = Math.max(0, (state.selectedSound.startTime || 0) - 1);
    updateTrimmerConstraints();
  });

  document.getElementById("trimmerStartPlusBtn")?.addEventListener("click", () => {
    if (!state.selectedSound) return;
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
    const minDur = Math.max(0.5, state.videoDuration || 0);
    const currentStart = state.selectedSound.startTime || 0;
    const currentEnd = state.selectedSound.endTime || 15;

    if (currentStart + 1 <= currentEnd - minDur) {
      state.selectedSound.startTime = currentStart + 1;
    } else if (currentEnd + 1 <= maxDur) {
      state.selectedSound.startTime = currentStart + 1;
      state.selectedSound.endTime = currentEnd + 1;
    }
    updateTrimmerConstraints();
  });

  document.getElementById("trimmerEndMinusBtn")?.addEventListener("click", () => {
    if (!state.selectedSound) return;
    const minDur = Math.max(0.5, state.videoDuration || 0);
    const currentStart = state.selectedSound.startTime || 0;
    const currentEnd = state.selectedSound.endTime || 15;

    if (currentEnd - 1 >= currentStart + minDur) {
      state.selectedSound.endTime = currentEnd - 1;
    } else if (currentStart - 1 >= 0) {
      state.selectedSound.startTime = currentStart - 1;
      state.selectedSound.endTime = currentEnd - 1;
    }
    updateTrimmerConstraints();
  });

  document.getElementById("trimmerEndPlusBtn")?.addEventListener("click", () => {
    if (!state.selectedSound) return;
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
    state.selectedSound.endTime = Math.min(maxDur, (state.selectedSound.endTime || 0) + 1);
    updateTrimmerConstraints();
  });

  // Preset Buttons
  const applyPreset = (durationSec) => {
    if (!state.selectedSound) return;
    const maxDur = Math.max(15, Math.ceil(state.selectedSound.duration || 60));
    const minDur = Math.max(0.5, state.videoDuration || 0);

    if (durationSec === null) {
      state.selectedSound.startTime = 0;
      state.selectedSound.endTime = maxDur;
    } else {
      const targetLen = Math.max(minDur, Math.min(durationSec, maxDur));
      if (state.selectedSound.startTime + targetLen <= maxDur) {
        state.selectedSound.endTime = state.selectedSound.startTime + targetLen;
      } else {
        state.selectedSound.endTime = maxDur;
        state.selectedSound.startTime = Math.max(0, maxDur - targetLen);
      }
    }
    updateTrimmerConstraints();
  };

  document.getElementById("trimmerPreset15s")?.addEventListener("click", () => applyPreset(15));
  document.getElementById("trimmerPreset30s")?.addEventListener("click", () => applyPreset(30));
  document.getElementById("trimmerPreset60s")?.addEventListener("click", () => applyPreset(60));
  document.getElementById("trimmerPresetFull")?.addEventListener("click", () => applyPreset(null));

  document.getElementById("trimmerPlayPauseBtn")?.addEventListener("click", () => {
    toggleTrimmerPreview();
  });

  // Share & Download Modal bindings
  document.getElementById("closeShareModalBtn")?.addEventListener("click", () => closeShareModal());
  document.getElementById("shareCancelBottomBtn")?.addEventListener("click", () => closeShareModal());
  document.getElementById("shareModalDialog")?.addEventListener("click", (e) => {
    if (e.target.id === "shareModalDialog") closeShareModal();
  });
  document.getElementById("shareDownloadBtn")?.addEventListener("click", () => {
    if (pendingShareKlip) triggerKlipDownloadAsync(pendingShareKlip);
  });
  document.getElementById("shareCopyLinkBtn")?.addEventListener("click", async () => {
    if (!pendingShareKlip) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?klip=${encodeURIComponent(pendingShareKlip.Id)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Klip link copied to clipboard!");
    } catch {
      showToast("Link: " + shareUrl);
    }
    closeShareModal();
  });
  document.getElementById("shareWhatsAppBtn")?.addEventListener("click", () => {
    if (!pendingShareKlip) return;
    const klip = pendingShareKlip;
    const shareUrl = `${window.location.origin}${window.location.pathname}?klip=${encodeURIComponent(klip.Id)}`;
    const text = encodeURIComponent(`Watch ${klip.CreatorHandle}'s Klip: ${shareUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
    closeShareModal();
  });
  document.getElementById("shareSystemBtn")?.addEventListener("click", async () => {
    if (!pendingShareKlip) return;
    const klip = pendingShareKlip;
    const shareUrl = `${window.location.origin}${window.location.pathname}?klip=${encodeURIComponent(klip.Id)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Klip by ${klip.CreatorHandle}`,
          text: klip.Caption || `Watch ${klip.CreatorHandle} on Klip`,
          url: shareUrl,
        });
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Klip link copied to clipboard!");
      } catch {
        showToast("Link: " + shareUrl);
      }
    }
    closeShareModal();
  });

  // Auth Prompt dialog bindings
  document.getElementById("authPromptCancelBtn")?.addEventListener("click", () => closeAuthPrompt());
  document.getElementById("authPromptDialog")?.addEventListener("click", (e) => {
    if (e.target.id === "authPromptDialog") closeAuthPrompt();
  });
  document.getElementById("authPromptLoginBtn")?.addEventListener("click", () => {
    closeAuthPrompt();
    if (activeCommentKlip) closeCommentsModal();
    switchRootTab("ProfilePage");
  });

  // Delete confirm dialog
  document
    .getElementById("deleteCancelBtn")
    ?.addEventListener("click", () => closeDeleteConfirm(true));
  document
    .getElementById("deleteConfirmBtn")
    ?.addEventListener("click", () => confirmDeletePendingKlip());
  document
    .getElementById("deleteConfirmDialog")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "deleteConfirmDialog" && !document.getElementById("deleteConfirmBtn").disabled) {
        closeDeleteConfirm(true);
      }
    });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAuthPrompt();
      if (activeCommentKlip) closeCommentsModal();
      if (pendingShareKlip) closeShareModal();
      if (pendingDeleteKlip) closeDeleteConfirm(true);
    }
  });
  window.addEventListener("pagehide", () => {
    if (state.currentKlipInView && getActivePageId() === "MainPage") {
      const watchDurationSec = (Date.now() - state.videoStartTime) / 1000;
      if (watchDurationSec < 2.2) {
        RecommendationService.recordInteraction(
          state.currentKlipInView,
          VideoInteractionType.SwipedImmediately,
          watchDurationSec
        );
      } else if (watchDurationSec >= 7.0) {
        RecommendationService.recordInteraction(
          state.currentKlipInView,
          VideoInteractionType.WatchedMost,
          watchDurationSec
        );
      }
    }
  });
  document.getElementById("globalUploadDismissBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissGlobalUploadPill();
  });
  document.getElementById("globalUploadPill")?.addEventListener("click", (e) => {
    if (e.target.id === "globalUploadDismissBtn") return;
    const pill = document.getElementById("globalUploadPill");
    if (pill && pill.classList.contains("upload-error") && currentUploadJob) {
      startBackgroundKlipUpload(currentUploadJob);
    }
  });

  FirebaseService.onFeedUpdated(() => {
    if (getActivePageId() === "MainPage") {
      refreshFeedsAsync();
    }
  });
}

// ==================== BOOTSTRAP ====================
function openLegalModal(type) {
  const overlay = document.getElementById("legalModalOverlay");
  const titleEl = document.getElementById("legalModalTitle");
  const contentEl = document.getElementById("legalModalContent");
  if (!overlay || !titleEl || !contentEl) return;

  if (type === "terms") {
    titleEl.textContent = "Terms of Service";
    contentEl.innerHTML = `
      <p><strong>Last Updated: November 2026</strong></p>
      <p>Welcome to <strong>Klip</strong> (kliponline.com). Klip is an independent kosher Jewish video and photo-sharing platform designed for sharing Torah, Jewish simchas, music, and kosher entertainment.</p>
      <h4>1. Acceptance of Terms</h4>
      <p>By creating an account or using Klip, you agree to comply with and be bound by these Terms. If you do not agree, do not use the service.</p>
      <h4>2. Community Guidelines &amp; Content Standards</h4>
      <p>Klip strictly enforces kosher community values. All posted content must respect Jewish modesty, avoid vulgarity, hate speech, or harassment, and comply with all applicable copyright laws.</p>
      <h4>3. User Accounts</h4>
      <p>You are responsible for maintaining the confidentiality of your account credentials. All accounts created on Klip are strictly for personal use within the Klip platform.</p>
      <h4>4. Contact</h4>
      <p>For questions or support, contact the Klip team at <a href="mailto:supportatklip@gmail.com" style="color: #38BDF8;">supportatklip@gmail.com</a> or via WhatsApp at <a href="https://wa.me/19024490799" target="_blank" style="color: #38BDF8;">+1 902 449 0799</a>.</p>
    `;
  } else if (type === "privacy") {
    titleEl.textContent = "Privacy Policy";
    contentEl.innerHTML = `
      <p><strong>Last Updated: November 2026</strong></p>
      <p>Your privacy is important to us. This Privacy Policy explains how <strong>Klip</strong> collects, uses, and protects your information.</p>
      <h4>1. Information We Collect</h4>
      <p>When you register, we collect your email address, chosen handle, display name, and profile information. When you upload media, your videos, photos, and sounds are stored securely on Cloudflare infrastructure.</p>
      <h4>2. How We Use Information</h4>
      <p>We use your information exclusively to operate the Klip platform, provide authentication, deliver video feeds, and notify you of interactions (likes, bookmarks, comments).</p>
      <h4>3. Data Protection</h4>
      <p>We do not sell, rent, or share your personal data with third-party advertisers or data brokers. All credentials are encrypted using industry-standard protocols.</p>
      <h4>4. Contact</h4>
      <p>For privacy inquiries, contact us at <a href="mailto:supportatklip@gmail.com" style="color: #38BDF8;">supportatklip@gmail.com</a>.</p>
    `;
  } else {
    titleEl.textContent = "About Klip";
    contentEl.innerHTML = `
      <p><strong>Klip — Kosher Clips &amp; Simchas</strong></p>
      <p>Klip is an authentic, independent kosher Jewish short-video and photo community platform. Built for the global Jewish community to share and discover wholesome simchas, niggunim, Torah thoughts, and creative kosher media in a family-friendly environment.</p>
      <p>Developed with pride for the community. For inquiries, creator verification, or feedback, WhatsApp us at <a href="https://wa.me/19024490799" target="_blank" style="color: #38BDF8;">+1 902 449 0799</a>.</p>
    `;
  }

  overlay.style.display = "flex";
}

function closeLegalModal() {
  const overlay = document.getElementById("legalModalOverlay");
  if (overlay) overlay.style.display = "none";
}

async function initApp() {
  registerUserGestureUnlock();
  updateSoundIcons();
  setupEventListeners();
  updateSidebarUserCard();
  syncNavigationUI();

  // Start session restoration and initial feed load in parallel so auth refresh
  // never delays the first video from loading!
  const restorePromise = FirebaseService.tryRestoreSessionAsync().then(() => {
    updateSidebarUserCard();
    syncNavigationUI();
    refreshInboxBadgeCountAsync();
    if (FirebaseService.currentUser && FirebaseService.currentUser.AvatarUrl) {
      propagateAvatarUpdate(FirebaseService.currentUser.AvatarUrl);
    }
  });

  const closeLegalBtn = document.getElementById("closeLegalModalBtn");
  if (closeLegalBtn) closeLegalBtn.onclick = closeLegalModal;
  const legalOverlay = document.getElementById("legalModalOverlay");
  if (legalOverlay) {
    legalOverlay.onclick = (e) => {
      if (e.target === legalOverlay) closeLegalModal();
    };
  }

  const termsLinks = [document.getElementById("openTermsLink"), document.getElementById("sidebarTermsBtn")];
  termsLinks.forEach(el => { if (el) el.onclick = (e) => { e.preventDefault(); openLegalModal("terms"); }; });

  const privacyLinks = [document.getElementById("openPrivacyLink"), document.getElementById("sidebarPrivacyBtn")];
  privacyLinks.forEach(el => { if (el) el.onclick = (e) => { e.preventDefault(); openLegalModal("privacy"); }; });

  const aboutBtn = document.getElementById("sidebarAboutBtn");
  if (aboutBtn) aboutBtn.onclick = (e) => { e.preventDefault(); openLegalModal("about"); };

  await Promise.all([onMainPageAppearing(), restorePromise]);

  // Check URL deep-links (?klip=... or ?creator=...)
  const params = new URLSearchParams(window.location.search);
  const deepKlipId = params.get("klip");
  const deepCreatorUid = params.get("creator");

  if (deepCreatorUid) {
    pushSubpage("CreatorProfilePage", { uid: deepCreatorUid });
  } else if (deepKlipId) {
    const match = state.feedItems.find((k) => k.Id === deepKlipId);
    if (match) {
      pushSubpage("VideoDetailPage", {
        playlist: state.feedItems,
        selected: match,
      });
    }
  }
}

document.addEventListener("DOMContentLoaded", initApp);

