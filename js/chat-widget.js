/* DHOWN AI chat widget — floating "Chat with us" bubble that opens the MES
   customer chatbot (same AI, same CRM inbox) in an iframe. Self-contained. */
(function () {
  var MES_URL = "https://mes.dhownhosiery.com";
  var open = false, frame, btn;

  btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Chat with us");
  btn.textContent = "Chat with us";
  btn.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#ffd400;" +
    "color:#171200;border:none;border-radius:999px;padding:13px 20px;" +
    "font:600 15px system-ui,-apple-system,Segoe UI,sans-serif;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer";

  frame = document.createElement("iframe");
  frame.src = MES_URL + "/webchat";
  frame.title = "Chat with us";
  frame.style.cssText =
    "position:fixed;right:20px;bottom:80px;z-index:2147483647;width:380px;" +
    "height:min(600px,80vh);max-width:calc(100vw - 40px);border:1px solid #2a2a31;" +
    "border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);display:none;background:#09090b";

  btn.addEventListener("click", function () {
    open = !open;
    frame.style.display = open ? "block" : "none";
    btn.textContent = open ? "Close chat" : "Chat with us";
  });

  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
