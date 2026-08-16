import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { requestFont } from "./fonts";

// The interface borrows two faces from the same catalog the labels use.
requestFont("Archivo Narrow");
requestFont("IBM Plex Mono");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
