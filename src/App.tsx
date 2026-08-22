import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import Home from "@/pages/Home";
import AdversaryPage from "@/pages/AdversaryPage";
import NoiseLabPage from "@/pages/NoiseLabPage";
import ScreenerPage from "@/pages/ScreenerPage";
import PipelinePage from "@/pages/PipelinePage";
import BackTesterPage from "@/pages/BackTesterPage";
import FomoPage from "@/pages/FomoPage";
import StrategyLabPage from "@/pages/StrategyLabPage";
import JournalPage from "@/pages/JournalPage";
import SignUp from "@/pages/SignUp";

import { GoogleOAuthProvider } from '@react-oauth/google';

export default function App() {
  return (
    <GoogleOAuthProvider clientId="863840310583-jnu1917hidgacd6gc6c1u21v8i4ap5n9.apps.googleusercontent.com">
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/signal-room" element={<PipelinePage />} />
            <Route path="/back-tester" element={<BackTesterPage />} />
            <Route path="/adversary" element={<AdversaryPage />} />
            <Route path="/noise-lab" element={<NoiseLabPage />} />
            <Route path="/screener" element={<ScreenerPage />} />
            <Route path="/strategy-lab" element={<StrategyLabPage />} />
            <Route path="/fomo" element={<FomoPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/signup" element={<SignUp />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
