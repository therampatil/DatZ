// Scroll-reveal for the landing page. The welcome screen is its own scroll container.

export function initLanding() {
  const items = document.querySelectorAll(".lp-reveal");
  if (!items.length) return;

  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((item) => item.classList.add("in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );
  items.forEach((item, index) => {
    item.style.transitionDelay = `${(index % 4) * 70}ms`;
    observer.observe(item);
  });

  const motionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => entry.target.classList.toggle("lp-paused", !entry.isIntersecting));
    },
    { threshold: 0 }
  );
  document.querySelectorAll(".lp-aurora, .lp-orbit, .lp-ticker, .lp-flow").forEach((item) => motionObserver.observe(item));
}
