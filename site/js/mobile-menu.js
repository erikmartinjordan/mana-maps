(function () {
  if (window.__manaMobileMenu) return;
  window.__manaMobileMenu = true;

  var MOBILE_MAX = 760;
  var CLOSE_MS = 300;
  var OPEN_CLASS = "mana-menu-open";
  var CLOSING_CLASS = "mana-menu-closing";
  var closeTimer = null;
  var isOpen = false;
  var activeDetails = null;
  var overlay = null;
  var backdrop = null;
  var list = null;
  var cta = null;

  function build() {
    backdrop = document.createElement("div");
    backdrop.className = "mana-menu-backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    overlay = document.createElement("nav");
    overlay.className = "mana-menu";
    overlay.id = "mana-mobile-menu";
    overlay.setAttribute("aria-label", "Menu");
    overlay.setAttribute("aria-hidden", "true");

    list = document.createElement("ul");
    list.className = "mana-menu__list";
    overlay.appendChild(list);

    cta = document.createElement("a");
    cta.className = "mana-menu__cta";
    overlay.appendChild(cta);

    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);

    backdrop.addEventListener("click", function () {
      close(false);
    });
    overlay.addEventListener("click", function (event) {
      if (event.target.closest("a")) close(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen) close(false);
    });
    window.addEventListener("resize", function () {
      if (isOpen && window.innerWidth > MOBILE_MAX) close(true);
    });
  }

  function menuDetails() {
    return document.querySelectorAll(".masthead__more, .site-navbar__more, .topbar-more");
  }

  function panelFor(details) {
    return details.querySelector(".masthead__panel, .site-navbar__panel, .topbar-panel");
  }

  function ctaFor(details) {
    var scope = details.closest(".masthead, .site-navbar, .topbar");
    if (!scope) return null;
    return scope.querySelector(".masthead__cta, .site-navbar__cta, .topbar-actions .btn-primary");
  }

  function summaryFor(details) {
    return details.querySelector("summary");
  }

  function setSummary(details, openState) {
    var summary = summaryFor(details);
    if (!summary) return;
    summary.setAttribute("aria-expanded", openState ? "true" : "false");
    summary.setAttribute("aria-label", openState ? "Cerrar menú" : "Abrir menú");
  }

  function open(details) {
    if (isOpen || !details) return;
    if (!overlay) build();

    activeDetails = details;

    var panel = panelFor(details);
    var links = panel ? Array.from(panel.querySelectorAll("a")) : [];

    list.innerHTML = "";
    links.forEach(function (source, index) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.className = "mana-menu__link";
      link.href = source.getAttribute("href") || "#";
      link.textContent = (source.textContent || "").trim();
      if (source.target) link.target = source.target;
      if (source.rel) link.rel = source.rel;
      link.style.setProperty("--mm-delay", index * 40 + "ms");
      item.appendChild(link);
      list.appendChild(item);
    });

    var sourceCta = ctaFor(details);
    var href = sourceCta ? sourceCta.getAttribute("href") || "" : "";
    var label = sourceCta ? (sourceCta.textContent || "").trim() : "";
    var duplicate = links.some(function (link) {
      return (link.getAttribute("href") || "") === href;
    });

    if (sourceCta && href && label && !duplicate) {
      cta.href = href;
      cta.textContent = label;
      cta.style.display = "";
      cta.style.setProperty("--mm-delay", links.length * 40 + "ms");
    } else {
      cta.style.display = "none";
    }

    details.open = true;
    setSummary(details, true);

    document.body.classList.remove(CLOSING_CLASS);
    void overlay.offsetHeight;
    document.body.classList.add(OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "false");
    isOpen = true;
  }

  function close(immediate) {
    if (!isOpen) return;
    isOpen = false;

    document.body.classList.remove(OPEN_CLASS);
    if (!immediate) document.body.classList.add(CLOSING_CLASS);
    if (overlay) overlay.setAttribute("aria-hidden", "true");

    if (activeDetails) {
      activeDetails.open = false;
      setSummary(activeDetails, false);
    }

    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      document.body.classList.remove(CLOSING_CLASS);
    }, immediate ? 0 : CLOSE_MS);
    activeDetails = null;
  }

  menuDetails().forEach(function (details) {
    var summary = summaryFor(details);
    if (!summary) return;
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-haspopup", "true");
    summary.setAttribute("aria-controls", "mana-mobile-menu");
    summary.addEventListener("click", function (event) {
      event.preventDefault();
      if (isOpen) {
        close(false);
      } else {
        open(details);
      }
    });
  });
})();
