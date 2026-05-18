import React, { useState, useEffect } from 'react';
import './App.css';
import PadreImage from './components/PadreImage';
import BottomSection from './components/BottomSection';

const App = (): React.JSX.Element => {
  const [allAssetsLoaded, setAllAssetsLoaded] = useState(false);
  const [showMainContent, setShowMainContent] = useState(false);
  const [fadeLoading, setFadeLoading] = useState(false);

  useEffect(() => {
    let loadedCount = 0;
    const totalAssets = 3;

    const incrementLoadedCount = (): void => {
      loadedCount++;
      if (loadedCount === totalAssets) {
        setTimeout(() => {
          setAllAssetsLoaded(true);
          setFadeLoading(true);
          setTimeout(() => {
            setShowMainContent(true);
          }, 500);
        }, 500);
      }
    };

    const video = document.createElement('video');
    video.src = '/background_video.mp4';
    video.onloadeddata = incrementLoadedCount;
    video.load();

    const padreImg = new Image();
    padreImg.src = '/padre_transparente.png';
    padreImg.onload = incrementLoadedCount;

    const logoImg = new Image();
    logoImg.src = '/logo_temp.png';
    logoImg.onload = incrementLoadedCount;

    return () => {
      video.onloadeddata = null;
      padreImg.onload = null;
      logoImg.onload = null;
    };
  }, []);

  return (
    <div className="app-container">
      {!showMainContent && (
        <div className={`loading-screen ${fadeLoading ? 'fade-out' : ''}`}>
          <div className="loading-text">Cargando...</div>
        </div>
      )}
      
      {allAssetsLoaded && (
        <div className={`App ${showMainContent ? 'fade-in' : 'hidden'}`}>
          <video
            autoPlay
            loop
            muted
            className="background-video"
            src="/background_video.mp4"
          />

          <div className="overlay">
            <PadreImage />
            <BottomSection />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
