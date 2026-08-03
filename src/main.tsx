import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";

const startupWindow = window as Window & {
  __hlclearBooted?: boolean;
};

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    startupWindow.__hlclearBooted = true;
  });
});
