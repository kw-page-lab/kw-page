import React from 'react';
import logoImage from '../assets/logo_temp.png';

interface BottomSectionProps {
  className?: string;
}

const BottomSection: React.FC<BottomSectionProps> = ({ className = '' }) => {
  return (
    <div className={`bottom-section ${className}`}>
      <a href="https://www.youtube.com/@Kimeraware" target="_blank" rel="noopener noreferrer">
        <img
          src={logoImage}
          alt="Kimeraware Logo"
          className="logo-img"
        />
      </a>
      <div className="coming-soon-text">proximamente...</div>
    </div>
  );
};

export default BottomSection;