/* index-home.js — melhorias da homepage LiveTagus
   · reveal on scroll  · spotlight do cursor
   (O comboio-scrollbar passou para o ficheiro standalone train-scrollbar.js.)
   CSP: ficheiro externo (script-src 'self'); sem handlers inline. */
(() => {
  "use strict";

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("lt-js");

  /* ---------------- REVEAL ON SCROLL ---------------- */
  (function reveal() {
    const items = document.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((el) => io.observe(el));
  })();

  /* ---------------- SPOTLIGHT DO CURSOR (só rato fino) ---------------- */
  (function spotlight() {
    if (!matchMedia("(pointer:fine)").matches) return;
    document.querySelectorAll(".lt-spot").forEach((c) => {
      c.addEventListener("pointermove", (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty(
          "--mx",
          ((e.clientX - r.left) / r.width) * 100 + "%",
        );
        c.style.setProperty(
          "--my",
          ((e.clientY - r.top) / r.height) * 100 + "%",
        );
      });
    });
  })();
})();
