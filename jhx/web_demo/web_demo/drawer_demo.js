const drawer = document.getElementById("adviceDrawer");
const toggle = document.getElementById("drawerToggle");
const collapse = document.getElementById("drawerCollapse");

function setDrawer(open) {
  drawer.classList.toggle("is-open", open);
  toggle.textContent = open ? "隐藏建议" : "展开建议";
}

toggle.addEventListener("click", () => {
  setDrawer(!drawer.classList.contains("is-open"));
});

collapse.addEventListener("click", () => setDrawer(false));
