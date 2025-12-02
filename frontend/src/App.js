import React from 'react';
import './styles/index.css';
import './styles/design-system.css';
import Header from './components/Header';
import SocialMediaSwot from './components/SocialMediaSwot';
import Footer from './components/Footer';
import LandingPage from "./LandingPage";
import RegisterPage from "./RegisterPage";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<SocialMediaSwot />} />
      </Routes>
    </Router>
  );
}

export default App;
