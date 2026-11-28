// Supabase Google OAuth, session, and profile UI.

import { byId, setText, setOpen, showToast } from "./dom.js";
import { renderOwnedDatabases } from "./ownedDatabases.js";
import { requireSupabase, supabase } from "./supabaseClient.js";

export const authState = {
  user: null,
  accessToken: null,
  refreshToken: null,
};

function mapUser(user) {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || "",
    name: metadata.full_name || metadata.name || user.email?.split("@")[0] || "User",
    avatarUrl: metadata.avatar_url || metadata.picture || null,
    provider: user.app_metadata?.provider || "google",
    createdAt: user.created_at,
  };
}

function applySession(session) {
  authState.user = mapUser(session?.user);
  authState.accessToken = session?.access_token || null;
  authState.refreshToken = session?.refresh_token || null;
  updateAuthUI();
  if (authState.user) {
    window.dispatchEvent(new CustomEvent("datz:auth-ready"));
    // If returning from an OAuth callback or user is signed in, transition past the welcome screen
    const url = new URL(window.location.href);
    if (url.searchParams.has("code") || url.hash.includes("access_token=") || url.searchParams.has("access_token")) {
      enterAppShell();
      // Clean up OAuth tokens from URL bar without reload
      url.searchParams.delete("code");
      url.searchParams.delete("access_token");
      url.searchParams.delete("refresh_token");
      url.searchParams.delete("expires_at");
      url.searchParams.delete("expires_in");
      url.searchParams.delete("token_type");
      url.searchParams.delete("type");
      const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + (url.hash && !url.hash.includes("access_token") ? url.hash : "");
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }
}

export function openProfile() {
  const user = authState.user;
  if (!user) {
    void startGoogleAuth();
    return;
  }

  setText("profileCardName", user.name || "User");
  setText("profileCardEmail", user.email || "Google Account");
  setText("profileOverviewEmail", user.email || "—");
  setText("profileUserId", user.id || "—");
  renderOwnedDatabases();

  const avatarImg = byId("profileCardAvatar");
  const initialsDiv = byId("profileCardInitials");
  if (avatarImg && initialsDiv) {
    if (user.avatarUrl) {
      avatarImg.src = user.avatarUrl;
      avatarImg.style.display = "block";
      initialsDiv.style.display = "none";
    } else {
      avatarImg.style.display = "none";
      initialsDiv.style.display = "flex";
      initialsDiv.textContent = (user.name?.[0] || user.email?.[0] || "U").toUpperCase();
    }
  }

  document.querySelectorAll(".profile-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.profileTab === "overview");
  });
  document.querySelectorAll(".profile-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.id === "profileTabOverview");
  });
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.remove("active"));
  byId("navProfileLink")?.classList.add("active");
  setOpen("profileDrawer", true);
}

export function closeProfile() {
  setOpen("profileDrawer", false);
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.remove("active"));
  document.querySelector('.nav-link[data-section="marketplace"]')?.classList.add("active");
}

export function updateAuthUI() {
  const user = authState.user;
  const userPill = byId("userPill");
  const headerSignInBtn = byId("headerSignInBtn");
  const profileTopButton = byId("profileTopButton");
  const profileTopAvatar = byId("profileTopAvatar");
  const welcomeSignInBtn = byId("welcomeSignInButton");
  const navProfileLink = byId("navProfileLink");
  const navDatabasesLink = byId("navDatabasesLink");
  const userAvatar = byId("userAvatar");
  const userName = byId("userName");

  if (user) {
    if (userPill) userPill.hidden = false;
    if (headerSignInBtn) headerSignInBtn.hidden = true;
    profileTopButton?.classList.add("signed-in");
    if (profileTopAvatar) {
      profileTopAvatar.textContent = (user.name?.[0] || user.email?.[0] || "U").toUpperCase();
      if (/^https?:\/\//i.test(String(user.avatarUrl || ""))) {
        profileTopAvatar.style.backgroundImage = `url(${user.avatarUrl})`;
        profileTopAvatar.classList.add("has-image");
      }
    }
    if (navProfileLink) navProfileLink.style.display = "inline-block";
    if (navDatabasesLink) navDatabasesLink.style.display = "inline-block";
    if (welcomeSignInBtn) welcomeSignInBtn.textContent = `Signed in (${user.name.split(" ")[0]})`;
    if (userAvatar) {
      userAvatar.src = user.avatarUrl || "";
      userAvatar.hidden = !user.avatarUrl;
    }
    if (userName) userName.textContent = user.name || user.email || "Account";
    const checkoutEmail = byId("checkoutEmail");
    if (checkoutEmail && !checkoutEmail.value) checkoutEmail.value = user.email;
  } else {
    if (userPill) userPill.hidden = true;
    if (headerSignInBtn) headerSignInBtn.hidden = false;
    profileTopButton?.classList.remove("signed-in");
    if (profileTopAvatar) {
      profileTopAvatar.textContent = "U";
      profileTopAvatar.style.backgroundImage = "";
      profileTopAvatar.classList.remove("has-image");
    }
    if (navProfileLink) navProfileLink.style.display = "none";
    if (navDatabasesLink) navDatabasesLink.style.display = "none";
    if (welcomeSignInBtn) welcomeSignInBtn.innerHTML = "Sign in with Google <span>↗</span>";
  }
}

export async function startGoogleAuth() {
  try {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    if (error) throw error;
  } catch (error) {
    showToast(error?.message || "Google sign-in is unavailable.");
  }
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  applySession(null);
  closeProfile();
  showToast("You have been signed out.");
}

export function enterAppShell() {
  byId("welcomeScreen")?.classList.add("done");
  const shell = byId("appShell");
  shell?.classList.add("entered");
  shell?.setAttribute("aria-hidden", "false");
  window.scrollTo(0, 0);
}

export async function initAuth() {
  if (!supabase) {
    updateAuthUI();
    return;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("Could not restore Supabase session:", error.message);
  applySession(data?.session || null);
  supabase.auth.onAuthStateChange((_event, session) => applySession(session));
}

export function bindAuthControls() {
  byId("profileTopButton")?.addEventListener("click", openProfile);
  byId("getStartedButton")?.addEventListener("click", enterAppShell);
  byId("welcomeExploreBottom")?.addEventListener("click", enterAppShell);
  byId("welcomeCustomRequest")?.addEventListener("click", enterAppShell);
  byId("welcomeSignInButton")?.addEventListener("click", () => {
    if (authState.user) enterAppShell();
    else void startGoogleAuth();
  });
  byId("welcomeSignInBottom")?.addEventListener("click", () => {
    if (authState.user) enterAppShell();
    else void startGoogleAuth();
  });
  byId("headerSignInBtn")?.addEventListener("click", () => void startGoogleAuth());
  byId("userPill")?.addEventListener("click", (event) => {
    if (!event.target.closest("#userSignOutBtn")) openProfile();
  });
  byId("navProfileLink")?.addEventListener("click", openProfile);
  byId("closeProfile")?.addEventListener("click", closeProfile);
  byId("closeProfileDrawer")?.addEventListener("click", closeProfile);
  byId("profileBackdrop")?.addEventListener("click", closeProfile);
  byId("profileDrawer")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeProfile();
  });
  byId("userSignOutBtn")?.addEventListener("click", () => void signOut());
  byId("profileSignOutBtn")?.addEventListener("click", () => void signOut());
  byId("profileCardSignOutBtn")?.addEventListener("click", () => void signOut());
  byId("profileSecSignOutBtn")?.addEventListener("click", () => void signOut());
  document.querySelectorAll(".profile-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".profile-nav button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".profile-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.id === `profileTab${button.dataset.profileTab[0].toUpperCase()}${button.dataset.profileTab.slice(1)}`);
      });
    });
  });
}
