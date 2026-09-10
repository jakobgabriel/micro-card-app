import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { StoreProvider } from "./lib/store";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ToastProvider>
  </React.StrictMode>,
);
