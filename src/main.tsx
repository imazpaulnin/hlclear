import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./styles.css";

(
  window as Window & {
    __hlclearBooted?: boolean;
  }
).__hlclearBooted = true;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();
