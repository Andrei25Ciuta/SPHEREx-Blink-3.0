const STORAGE_KEY = "spherex-blink-high-contrast";
const root = document.documentElement;

let enabled = false;
try { enabled = localStorage.getItem(STORAGE_KEY) === "on"; } catch { /* The toggle still works for this page session. */ }
root.dataset.contrast = enabled ? "high" : "normal";

const themeControl = document.querySelector(".theme-switch, .theme-picker, #theme-select");
if (themeControl) {
  const label = document.createElement("label");
  label.className = "contrast-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = enabled;
  input.setAttribute("aria-label", "High contrast");
  input.addEventListener("change", () => {
    root.dataset.contrast = input.checked ? "high" : "normal";
    try { localStorage.setItem(STORAGE_KEY, input.checked ? "on" : "off"); } catch { /* Keep the selected contrast for this page session. */ }
  });
  label.append(input, document.createTextNode(" High contrast"));
  themeControl.after(label);
}
