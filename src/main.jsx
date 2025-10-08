// src/main.js
import React from "react";
import ReactDOM from "react-dom/client";
import IUEC_Platform from "./IUEC_Platform.jsx"; // or .jsx if that’s the filename
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <IUEC_Platform />
  </React.StrictMode>
);
