/* DHOWN — site analytics.
   ────────────────────────────────────────────────────────────────────────
   TO SWITCH ON: replace the empty string below with your GA4 Measurement ID
   (it looks like "G-XXXXXXXXXX", from Google Analytics → Admin → Data Streams).
   Until then this file does nothing and loads no third-party scripts.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  var MEASUREMENT_ID = "";

  if (!MEASUREMENT_ID) return;

  // Honour the browser's Do Not Track setting.
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, { anonymize_ip: true });

  /* Track the things that actually matter for a B2B fabric site:
     who reaches out, and through which channel. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a || !a.href) return;

    if (a.href.indexOf("wa.me") > -1) {
      gtag("event", "contact_whatsapp", { link_url: a.href });
    } else if (a.href.indexOf("tel:") === 0) {
      gtag("event", "contact_phone", { link_url: a.href });
    } else if (a.href.indexOf("mailto:") === 0) {
      gtag("event", "contact_email", { link_url: a.href });
    }
  }, true);

  var form = document.getElementById("enquiry-form");
  if (form) {
    form.addEventListener("submit", function () {
      gtag("event", "generate_lead", {
        fabric: (form.querySelector("#fabric") || {}).value || "",
      });
    });
  }
})();
