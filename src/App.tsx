import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import Home from "@/pages/Home";
import AdversaryPage from "@/pages/AdversaryPage";
import NoiseLabPage from "@/pages/NoiseLabPage";
import ScreenerPage from "@/pages/ScreenerPage";
import PipelinePage from "@/pages/PipelinePage";
import BackTesterPage from "@/pages/BackTesterPage";
import FomoPage from "@/pages/FomoPage";
import JournalPage from "@/pages/JournalPage";
import SignUp from "@/pages/SignUp";

import { GoogleOAuthProvider } from '@react-oauth/google';
import { Analytics } from "@vercel/analytics/react";

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
            <Route path="/fomo" element={<FomoPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/signup" element={<SignUp />} />
          </Routes>
        </HashRouter>
        {/*
          Page-view counting only. It is mounted inside the router so hash route
          changes register as separate views — without that every visit would
          record as one hit on "/" no matter how far the user got.

          Nothing identifying is collected, which matters here: the whole app
          runs in the browser precisely so no market data or account detail
          reaches a server, and analytics must not be the thing that breaks it.
        */}
        <Analytics />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
